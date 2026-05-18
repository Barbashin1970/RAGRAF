"""Интерпретатор flow-графа — режим «Исполнение регламента».

Назначение
==========
Прогнать регламент с конкретным набором входных значений и вернуть вердикт:
сработали ли пороги, какой уровень критичности (priority output-ноды), какие
рекомендации триггернулись. Используется в:

  - UI «Запустить» / «Симуляция» — аналитик играет сценарии до публикации
  - Боевом endpoint POST /regulations/{sid}/execute — СИГМА присылает
    ETL-payload с реальных датчиков, RAGRAF возвращает level + recommendation

Поддержаны типы узлов: input, threshold, sensor, formula, compare, switch,
output, shacl_constraint.

Семантика
=========
1. Сенсоры → инжект значений в input-ноды (через FlowNode.bindsTo).
2. input-нода хранит value в `node_values`.
3. threshold-нода считает |value − refValue| > deviation → флаг out_of_range.
4. formula-нода вычисляет произвольное выражение через `formula_eval`
   (безопасный AST-evaluator, см. там docstring). Если результат truthy —
   «срабатывает» (зажигает downstream); если число — пробрасывается как
   значение для downstream threshold/output.
5. compare/switch на MVP проходятся как pass-through (значение не меняется).
6. shacl_constraint валидирует значение upstream-ноды против Constraint
   из regulation.constraints — если нарушено, пишет в trace severity и
   фиксирует violation в результате.
7. output-нода считается fired если её достиг сработавший сигнал;
   level := max(priority среди fired-output-нод), recommendation — конкат.

Безопасность
============
formula evaluator — изолированный AST-walker (formula_eval.py), без raw
eval/exec. validator при сохранении flow дополнительно проверяет синтаксис.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.domain import (
    Constraint,
    FlowNode,
    Parameter,
    Regulation,
    RuleDSL,
    SensorType,
)
from app.services.formula_eval import (
    FormulaContext,
    FormulaError,
    SampleHistory,
    evaluate as eval_formula,
)


# ── Payload models ────────────────────────────────────────────────────────


class SensorReading(BaseModel):
    """Одно измерение для исполнения.

    Способы привязки (любой один):
      sensor_id  — id sensor-ноды в этом конкретном flow'е
      param_id   — id параметра регламента (universal fallback — если sensor-
                   нод нет, executor подсунет значение прямо в input-ноду
                   с этим paramRef)
      sensor_type — тип датчика; матчится с FlowNode.sensorType. Полезно
                    когда из ETL прилетает только `{type: "p", value: ...}`
                    без знания о структуре flow'а.
    Поля external_id и edge_id передаются «насквозь» в trace для UI/логов,
    на логику исполнения не влияют (это идентификаторы СИГМЫ).
    """

    value: float
    sensor_id: str | None = None
    param_id: str | None = None
    sensor_type: SensorType | None = None
    external_id: str | None = None
    edge_id: int | None = None


class NodeTrace(BaseModel):
    """Снимок состояния одного узла после прогона."""

    node_id: str
    node_type: str
    fired: bool
    value: float | None = None
    # Человекочитаемое объяснение: «20.5 ± 1.5 → попадание в норму»
    # или «25.0 вне [19.0, 22.0] → out_of_range». Для UI/логов СИГМЫ.
    explanation: str | None = None


class ExecutionResult(BaseModel):
    """Финальный ответ executor'а — форма зеркалит «обогащённые данные ETL»."""

    # Уровень критичности: 0 = норма, 1..3 = priority сработавшего output'а
    # (1 — критический). Если фолбэк не определён, возвращаем 0.
    level: int = 0
    regulation_id: str
    regulation_name: str
    recommendation: str | None = None
    # Подсказка UI: какие ноды/рёбра подсветить как «сработавшие». Имена полей
    # совпадают с Set<string> в FlowEditorScreen.
    fired_nodes: list[str] = Field(default_factory=list)
    fired_edges: list[str] = Field(default_factory=list)
    # Полный trace для отладки и аудита. Аналитик в режиме симуляции видит
    # пошагово что произошло.
    trace: list[NodeTrace] = Field(default_factory=list)
    # Что мы подложили в input-узлы — на случай если СИГМА хочет понять
    # «по какому именно сэмплу пришёл вердикт».
    inputs_resolved: dict[str, float] = Field(default_factory=dict)


# ── Public API ────────────────────────────────────────────────────────────


def execute_flow(
    dsl: RuleDSL,
    regulation: Regulation,
    readings: list[SensorReading],
) -> ExecutionResult:
    """Прогнать flow с конкретными значениями.

    Алгоритм:
      1. Разрешить readings → input-ноды (через sensor → bindsTo, либо
         напрямую по param_id, либо через sensor_type → паттерн-матч).
      2. Прокинуть значения в input.
      3. Пройтись по threshold-нодам, посчитать out_of_range.
      4. От каждого «сработавшего» threshold обойти DAG вперёд (через
         pass-through compare/formula/switch), собрать достигнутые output'ы.
      5. Сформировать вердикт.
    """
    nodes_by_id: dict[str, FlowNode] = {n.id: n for n in dsl.nodes}
    params_by_id: dict[str, Parameter] = {p.id: p for p in regulation.parameters}

    out_edges: dict[str, list[str]] = {n.id: [] for n in dsl.nodes}
    for e in dsl.edges:
        if e.source in out_edges and e.target in nodes_by_id:
            out_edges[e.source].append(e.target)

    # ── (1) Резолвим входы ────────────────────────────────────────────
    inputs_resolved: dict[str, float] = {}
    for reading in readings:
        target_input_id = _resolve_input_for_reading(reading, dsl, nodes_by_id)
        if target_input_id is None:
            continue
        inputs_resolved[target_input_id] = reading.value

    # ── (2) Прогон по узлам ───────────────────────────────────────────
    trace: list[NodeTrace] = []
    fired_nodes: set[str] = set()
    fired_edges: set[str] = set()
    # Какие узлы «получили сработавший сигнал» (вход в downstream).
    # Sensor-узел всегда «активен» если у него есть значение, но это
    # неинтересно — UI и так знает что мы стартанули с него.
    activated: set[str] = set()

    # Sensor-ноды: помечаем как fired если у них есть резолвенное значение.
    for n in dsl.nodes:
        if n.type == "sensor":
            bound = n.bindsTo
            if bound and bound in inputs_resolved:
                fired_nodes.add(n.id)
                activated.add(n.id)
                trace.append(NodeTrace(
                    node_id=n.id, node_type="sensor", fired=True,
                    value=inputs_resolved[bound],
                    explanation=_sensor_label(n, inputs_resolved[bound]),
                ))
                # Ребро sensor → input помечаем сработавшим.
                for tgt in out_edges.get(n.id, []):
                    fired_edges.add(_edge_id(n.id, tgt))

    # Input-ноды: если у нас есть резолвенное значение — fired.
    for n in dsl.nodes:
        if n.type == "input":
            val = inputs_resolved.get(n.id)
            if val is not None:
                fired_nodes.add(n.id)
                activated.add(n.id)
                trace.append(NodeTrace(
                    node_id=n.id, node_type="input", fired=True, value=val,
                    explanation=_input_label(n, val, params_by_id),
                ))

    # Threshold-ноды: тут «решение» — value out-of-range или нет.
    threshold_out_of_range: dict[str, bool] = {}
    for n in dsl.nodes:
        if n.type != "threshold":
            continue
        # Найти источник значения (вход к threshold'у — input-нода).
        feeding_value = _value_from_predecessors(n.id, dsl, inputs_resolved)
        if feeding_value is None:
            trace.append(NodeTrace(
                node_id=n.id, node_type="threshold", fired=False,
                explanation="нет входного значения",
            ))
            continue
        ref = n.refValue
        dev = n.deviation
        if ref is None or dev is None:
            # Порог не настроен — считаем что не срабатывает.
            trace.append(NodeTrace(
                node_id=n.id, node_type="threshold", fired=False, value=feeding_value,
                explanation="порог не настроен (refValue/deviation = null)",
            ))
            continue
        is_out = abs(feeding_value - ref) > dev
        threshold_out_of_range[n.id] = is_out
        if is_out:
            fired_nodes.add(n.id)
            activated.add(n.id)
        trace.append(NodeTrace(
            node_id=n.id, node_type="threshold", fired=is_out, value=feeding_value,
            explanation=_threshold_label(feeding_value, ref, dev, n.unit, is_out),
        ))

    # ── (3) Распространяем «сработавший» сигнал по DAG ───────────────
    # BFS из активированных нод (sensor/input/threshold) через compare/
    # formula/switch/shacl_constraint к output'ам. Formula реально
    # вычисляет выражение; результат фильтрует ребро (truthy → дальше).
    # Constraints формы regulation.constraints доступны SHACL-нодам.
    constraints_by_id: dict[str, Constraint] = {c.id: c for c in regulation.constraints}
    # Numeric values по нодам — нужны formula/SHACL чтобы взять upstream
    # значение из input/sensor/threshold/formula. Для compare/switch — копия
    # из единственного upstream.
    node_values: dict[str, float | bool | None] = {}
    for nid, val in inputs_resolved.items():
        node_values[nid] = val
    for tid in threshold_out_of_range.keys():
        node_values[tid] = _value_from_predecessors(tid, dsl, inputs_resolved)

    formula_scope = _build_formula_scope(dsl, params_by_id, inputs_resolved)
    formula_history = _build_formula_history(readings)

    queue: list[str] = sorted(activated)
    while queue:
        nid = queue.pop(0)
        for tgt in out_edges.get(nid, []):
            target_node = nodes_by_id.get(tgt)
            if target_node is None:
                continue
            edge_key = _edge_id(nid, tgt)
            fired_edges.add(edge_key)
            if tgt in fired_nodes:
                continue
            # threshold — fired только если он сам out_of_range
            if target_node.type == "threshold":
                if threshold_out_of_range.get(tgt, False):
                    fired_nodes.add(tgt)
                    queue.append(tgt)
                continue
            # formula — реально вычисляем
            if target_node.type == "formula":
                fired, value, explanation = _eval_formula_node(
                    target_node, formula_scope, formula_history
                )
                trace.append(NodeTrace(
                    node_id=tgt, node_type="formula", fired=fired,
                    value=value if isinstance(value, (int, float)) else None,
                    explanation=explanation,
                ))
                if fired:
                    fired_nodes.add(tgt)
                    queue.append(tgt)
                    if isinstance(value, (int, float)):
                        node_values[tgt] = float(value)
                continue
            # shacl_constraint — валидируем upstream-значение
            if target_node.type == "shacl_constraint":
                upstream_value = node_values.get(nid)
                ok, msg, severity = _check_shacl(
                    target_node, upstream_value, constraints_by_id
                )
                trace.append(NodeTrace(
                    node_id=tgt, node_type="shacl_constraint",
                    fired=not ok,  # «сработал» = нарушение
                    value=upstream_value if isinstance(upstream_value, (int, float)) else None,
                    explanation=msg,
                ))
                if not ok:
                    fired_nodes.add(tgt)
                    # Не подключаем downstream — SHACL обычно лист.
                    # Но если у пользователя есть outgoing edge, проброс
                    # сигнала корректен — нарушение = причина дальнейшей
                    # эскалации.
                    queue.append(tgt)
                continue
            # compare/switch — pass-through (MVP)
            fired_nodes.add(tgt)
            queue.append(tgt)
            if target_node.type in ("compare", "switch"):
                trace.append(NodeTrace(
                    node_id=tgt, node_type=target_node.type, fired=True,
                    explanation="pass-through",
                ))
            elif target_node.type == "output":
                trace.append(NodeTrace(
                    node_id=tgt, node_type="output", fired=True,
                    explanation=_output_label(target_node),
                ))

    # ── (4) Вердикт ───────────────────────────────────────────────────
    fired_outputs = [
        nodes_by_id[nid] for nid in fired_nodes
        if nodes_by_id[nid].type == "output"
    ]
    level = max((o.priority or 0) for o in fired_outputs) if fired_outputs else 0
    rec_texts = [o.text for o in fired_outputs if o.text]
    recommendation = "\n".join(rec_texts) if rec_texts else None

    return ExecutionResult(
        level=level,
        regulation_id=regulation.id,
        regulation_name=regulation.name,
        recommendation=recommendation,
        fired_nodes=sorted(fired_nodes),
        fired_edges=sorted(fired_edges),
        trace=trace,
        inputs_resolved=inputs_resolved,
    )


# ── Helpers ───────────────────────────────────────────────────────────────


def _edge_id(source: str, target: str) -> str:
    """Тот же формат что dslToFlow в frontend (см. rulesDsl.ts)."""
    return f"{source}__{target}"


def _resolve_input_for_reading(
    reading: SensorReading,
    dsl: RuleDSL,
    nodes_by_id: dict[str, FlowNode],
) -> str | None:
    """Вернуть id input-ноды, в которую закидываем reading.value.

    Приоритет:
      1. sensor_id → bindsTo
      2. param_id → input-нода с этим paramRef
      3. sensor_type → sensor-нода с этим типом → bindsTo
    """
    if reading.sensor_id:
        sensor = nodes_by_id.get(reading.sensor_id)
        if sensor and sensor.type == "sensor" and sensor.bindsTo:
            return sensor.bindsTo

    if reading.param_id:
        for n in dsl.nodes:
            if n.type == "input" and n.paramRef == reading.param_id:
                return n.id

    if reading.sensor_type:
        for n in dsl.nodes:
            if n.type == "sensor" and n.sensorType == reading.sensor_type and n.bindsTo:
                return n.bindsTo

    return None


def _value_from_predecessors(
    threshold_id: str,
    dsl: RuleDSL,
    inputs_resolved: dict[str, float],
) -> float | None:
    """Подняться от threshold'а к input-ноде и взять её значение.

    Реалистичный путь: input → threshold (прямое ребро). Если между ними
    есть pass-through узлы, мы их MVP не разворачиваем — просто проверяем
    что какая-то достижимая input-нода имеет значение.
    """
    # 1-hop сначала (типичный кейс).
    for e in dsl.edges:
        if e.target == threshold_id:
            src = next((n for n in dsl.nodes if n.id == e.source), None)
            if src and src.type == "input" and src.id in inputs_resolved:
                return inputs_resolved[src.id]
    # 2-hop fallback (если редактор поставил compare/formula между input
    # и threshold — пока что executor пробрасывает значение «насквозь»).
    for e in dsl.edges:
        if e.target == threshold_id:
            for e2 in dsl.edges:
                if e2.target == e.source:
                    src = next((n for n in dsl.nodes if n.id == e2.source), None)
                    if src and src.type == "input" and src.id in inputs_resolved:
                        return inputs_resolved[src.id]
    return None


def _sensor_label(n: FlowNode, value: float) -> str:
    parts = [f"датчик {n.sensorType or '?'}", f"value={value}"]
    if n.externalId:
        parts.append(f"id={n.externalId}")
    return ", ".join(parts)


def _input_label(n: FlowNode, value: float, params: dict[str, Parameter]) -> str:
    p = params.get(n.paramRef or "")
    name = p.name if p else (n.paramRef or "?")
    unit = (p.unit if p else None) or ""
    return f"{name} = {value} {unit}".strip()


def _threshold_label(value: float, ref: float, dev: float, unit: str | None, is_out: bool) -> str:
    lo = ref - dev
    hi = ref + dev
    u = (unit or "").strip()
    bracket = f"[{lo}, {hi}]" + (f" {u}" if u else "")
    if is_out:
        return f"{value} вне {bracket} → out_of_range"
    return f"{value} в норме {bracket}"


def _output_label(n: FlowNode) -> str:
    prio = n.priority or 0
    name = n.text or n.action or n.label or "output"
    return f"уровень {prio}: {name}"


def _build_formula_scope(
    dsl: RuleDSL,
    params_by_id: dict[str, Parameter],
    inputs_resolved: dict[str, float],
) -> dict[str, float | bool | None]:
    """Собрать scope для formula evaluator: paramRef → current value.

    Стратегия:
      • Для каждой input-ноды берём resolved value (если есть).
      • Ключ scope'а — paramRef (= param.id) ИЛИ p.name для traceability,
        либо node.label (если пользователь явно его задал).
    Это даёт пользователю писать формулы как
      `pressure > 20 && temperature > 50`
    с переменными = id'ам параметров регламента.
    """
    scope: dict[str, float | bool | None] = {}
    for n in dsl.nodes:
        if n.type != "input" or not n.paramRef:
            continue
        val = inputs_resolved.get(n.id)
        if val is None:
            continue
        # По paramRef и по человекочитаемому имени.
        scope[n.paramRef] = val
        param = params_by_id.get(n.paramRef)
        if param and param.name and param.name != n.paramRef:
            scope[param.name] = val
        if n.label and n.label != n.paramRef:
            scope[n.label] = val
    return scope


def _build_formula_history(
    readings: list[SensorReading],
) -> dict[str, SampleHistory]:
    """Извлечь history из readings — пока что MVP с одним сэмплом на параметр.

    Когда ETL пришлёт `series: [{ts, value}]` в SensorReading, тут будет
    парсинг. Сейчас readings — single-shot, history заполняется единственным
    сэмплом «сейчас». Time-series функции (rate/delta) в этом случае
    вернут None — формула должна корректно обработать (например через
    `rate(\"p\", \"1h\") or 0`).
    """
    # MVP — пустая история. Time-series функции вернут None, формула может
    # обработать через `is not None`. Полноценный history нужен от ETL.
    # См. SensorReading.series — пока этого поля нет.
    return {}


def _eval_formula_node(
    node: FlowNode,
    scope: dict[str, float | bool | None],
    history: dict[str, SampleHistory],
) -> tuple[bool, float | bool | None, str]:
    """Вычислить formula-ноду.

    Возвращает:
      fired       — true если результат truthy (зажигает downstream)
      value       — само значение (число/bool/None)
      explanation — человекочитаемое объяснение для trace
    """
    expr = (node.expression or "").strip()
    if not expr:
        return False, None, "пустое выражение (formula expression не задан)"
    ctx = FormulaContext(variables=scope, history=history)
    try:
        result = eval_formula(expr, ctx)
    except FormulaError as e:
        return False, None, f"ошибка формулы: {e}"
    except Exception as e:
        return False, None, f"ошибка вычисления: {type(e).__name__}: {e}"
    fired = bool(result)
    short = repr(result)
    if len(short) > 60:
        short = short[:57] + "..."
    return fired, result, f"{expr} → {short}"


def _check_shacl(
    node: FlowNode,
    value: float | bool | None,
    constraints_by_id: dict[str, Constraint],
) -> tuple[bool, str, str]:
    """Валидация значения upstream-ноды против SHACL-ограничения.

    Возвращает (ok, message, severity). severity — "violation" / "warning"
    / "info" — из Constraint.severity.
    """
    if not node.constraintRef:
        return True, "constraintRef не указан — пропуск", "info"
    constraint = constraints_by_id.get(node.constraintRef)
    if constraint is None:
        return True, f"constraintRef '{node.constraintRef}' не найден в shapes — пропуск", "info"

    severity = constraint.severity or "violation"
    if value is None:
        return True, f"нет значения для проверки {constraint.path}", severity

    # Числовые значения проверяем по min/max.
    if isinstance(value, (int, float)):
        lo = constraint.minInclusive
        hi = constraint.maxInclusive
        if lo is not None and value < lo:
            return False, f"{constraint.path}: {value} < min {lo} — {constraint.message or 'violation'}", severity
        if hi is not None and value > hi:
            return False, f"{constraint.path}: {value} > max {hi} — {constraint.message or 'violation'}", severity
        bracket_parts = []
        if lo is not None:
            bracket_parts.append(f"≥{lo}")
        if hi is not None:
            bracket_parts.append(f"≤{hi}")
        bracket = ", ".join(bracket_parts) if bracket_parts else "ограничение"
        return True, f"{constraint.path}: {value} соответствует {bracket}", severity

    return True, f"{constraint.path}: проверено (не число)", severity
