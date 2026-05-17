"""Интерпретатор flow-графа — режим «Исполнение регламента».

Назначение
==========
Прогнать регламент с конкретным набором входных значений и вернуть вердикт:
сработали ли пороги, какой уровень критичности (priority output-ноды), какие
рекомендации триггернулись. Используется в:

  - UI «Запустить» / «Симуляция» — аналитик играет сценарии до публикации
  - Боевом endpoint POST /regulations/{sid}/execute — СИГМА присылает
    ETL-payload с реальных датчиков, RAGRAF возвращает level + recommendation

Это RAGRAF-runtime, не интерпретатор всего DSL: реализованы только те типы
узлов, которые типично встречаются в фикстурах (input/threshold/output).
formula/compare/switch на MVP проходятся как pass-through (значение не
меняется, ветвление по edge.condition не интерпретируется). Расширим, когда
появятся фикстуры, реально использующие их.

Семантика
=========
1. Сенсоры → инжект значений в input-ноды (через FlowNode.bindsTo).
2. input-нода хранит value в `node_values`.
3. threshold-нода считает |value − refValue| > deviation → флаг out_of_range.
4. Распространение «сработавшего сигнала» вперёд по DAG: edge от threshold
   с out_of_range=True «зажигает» цепочку downstream-узлов.
5. output-нода считается fired если её достиг сработавший сигнал;
   level := max(priority среди fired-output-нод), recommendation — конкат.

Несработавшие пороги дают level=0 («норма»), что соответствует семантике
ETL-payload'а СИГМЫ (`level: 0` для in-range значений).

Безопасность
============
В отличие от validator'а, executor НЕ парсит произвольные expression'ы
(formula-нода). Если решим добавить — только через изолированный AST-walker
(см. ast.parse(mode='eval') + whitelist), никакого raw eval/exec.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.domain import FlowNode, Parameter, Regulation, RuleDSL, SensorType


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
    # BFS из активированных threshold'ов через pass-through compare/formula/
    # switch к output'ам. Sensor → input уже размечены в шаге выше.
    queue: list[str] = sorted(activated)
    while queue:
        nid = queue.pop(0)
        for tgt in out_edges.get(nid, []):
            target_node = nodes_by_id.get(tgt)
            if target_node is None:
                continue
            edge_key = _edge_id(nid, tgt)
            # Ребро sensor → input уже размечено выше, но повторное add OK.
            fired_edges.add(edge_key)
            if tgt in fired_nodes:
                continue
            # output / pass-through узлы — fired'аются по факту достижения.
            # threshold же мы помечаем только если он сам out_of_range.
            if target_node.type == "threshold":
                if threshold_out_of_range.get(tgt, False):
                    fired_nodes.add(tgt)
                    queue.append(tgt)
                continue
            fired_nodes.add(tgt)
            queue.append(tgt)
            if target_node.type in ("compare", "formula", "switch"):
                trace.append(NodeTrace(
                    node_id=tgt, node_type=target_node.type, fired=True,
                    explanation="pass-through (executor MVP)",
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
