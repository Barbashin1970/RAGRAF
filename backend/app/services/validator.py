"""Rule DSL validation — implements the 7 rules from regulation-viz-skill.md § Validation Rules.

Independent of upstream API so it can run on the editor draft before save.
"""
from __future__ import annotations

import networkx as nx

from app.schemas.domain import Constraint, Parameter, RuleDSL, ValidationError, ValidationResult
from app.services.formula_eval import FormulaError, parse_formula


def validate_dsl(
    dsl: RuleDSL,
    parameters: list[Parameter] | None = None,
    constraints: list[Constraint] | None = None,
) -> ValidationResult:
    errors: list[ValidationError] = []
    parameters = parameters or []
    param_ids = {p.id for p in parameters}
    params_by_id = {p.id: p for p in parameters}

    node_ids = {n.id for n in dsl.nodes}
    node_by_id = {n.id: n for n in dsl.nodes}

    # Build directed graph for connectivity / cycle checks
    g = nx.DiGraph()
    for n in dsl.nodes:
        g.add_node(n.id)
    for e in dsl.edges:
        if e.source not in node_ids or e.target not in node_ids:
            errors.append(
                ValidationError(
                    edgeId=f"{e.source}__{e.target}",
                    code="DANGLING_EDGE",
                    message=f"Ребро ссылается на несуществующий узел: {e.source} → {e.target}",
                )
            )
            continue
        g.add_edge(e.source, e.target)

    # 1. Graph connectivity — no isolated non-IO nodes.
    # Sensor — это «виртуальный» вход (точка привязки к ETL); может быть
    # положен на канвас и пока не связан с input-нодой — не флагаем как изоляцию.
    for n in dsl.nodes:
        deg = g.degree(n.id)
        if deg == 0 and n.type not in ("input", "output", "sensor"):
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="ISOLATED_NODE",
                    message=f"Изолированный узел: {n.type}",
                )
            )

    # 2. Completeness — at least one input → output path
    inputs = [n.id for n in dsl.nodes if n.type == "input"]
    outputs = [n.id for n in dsl.nodes if n.type == "output"]
    if not inputs:
        errors.append(ValidationError(code="MISSING_INPUT", message="Нет входного узла"))
    if not outputs:
        errors.append(ValidationError(code="MISSING_OUTPUT", message="Нет выходного узла"))
    if inputs and outputs:
        reachable = False
        for inp in inputs:
            for out in outputs:
                if nx.has_path(g, inp, out):
                    reachable = True
                    break
            if reachable:
                break
        if not reachable:
            errors.append(
                ValidationError(
                    code="NO_IO_PATH",
                    message="Нет пути от входа к выходу — правило не сработает",
                )
            )

    # 3. Type safety — `compare` нужен либо 2 входа, либо 1 вход от
    # threshold-узла (threshold уже несёт `value` + `refValue ± deviation`,
    # это самодостаточный «значение+диапазон» комплект — таков паттерн
    # всех 11 фикстур RAGRAF: input → threshold → compare → output).
    # Раньше правило безусловно требовало in_degree ≥ 2 — это давало
    # ложные warning'и на каждом регламенте.
    #
    # Стратегия: warn только если предшественников 0, ИЛИ их 1 и это
    # НЕ threshold. Двойной legit-кейс остаётся: явные value+range из двух
    # input-нод или формул.
    for n in dsl.nodes:
        if n.type != "compare":
            continue
        in_deg = g.in_degree(n.id) if n.id in g else 0
        if in_deg == 0:
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="COMPARE_INSUFFICIENT_INPUTS",
                    message="Узел сравнения не подключён к источнику данных",
                    severity="warning",
                )
            )
            continue
        if in_deg >= 2:
            continue
        # Ровно один предшественник — допустимо если это threshold.
        pred_id = next(iter(g.predecessors(n.id)))
        pred = node_by_id.get(pred_id)
        if pred is None or pred.type != "threshold":
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="COMPARE_INSUFFICIENT_INPUTS",
                    message=(
                        "Узел сравнения с одним входом ожидает threshold "
                        "(value+range внутри). Подключите threshold или добавьте "
                        "второй вход."
                    ),
                    severity="warning",
                )
            )

    # 4. Reference integrity — paramRef must exist
    for n in dsl.nodes:
        if n.type == "input" and n.paramRef and parameters:
            if n.paramRef not in param_ids:
                errors.append(
                    ValidationError(
                        nodeId=n.id,
                        code="UNKNOWN_PARAM_REF",
                        message=f"Параметр '{n.paramRef}' не найден в регламенте",
                    )
                )

    # 5. Threshold bounds — сам refValue должен быть в SHACL bounds.
    # Раньше требовали `refValue ± deviation ⊆ [min, max]`. Это давало
    # ложные warning'и для счётчиков типа `pdkExceedanceHours` ref=0 dev=4:
    # нижний порог -4 < 0, но физически 0 — это нормальный baseline шумящего
    # измерителя, его «отклонение» — это просто допустимый разброс вокруг
    # baseline'а, не запрет на нижнюю границу.
    #
    # Семантика правильная: refValue (= точка калибровки) обязан быть в
    # допустимом физическом диапазоне; deviation — окно срабатывания,
    # его выход за SHACL bounds означает «измерения могут попасть за края,
    # тогда сработает out_of_range» — это нормальное поведение.
    for n in dsl.nodes:
        if n.type != "threshold" or n.refValue is None:
            continue
        for e in dsl.edges:
            if e.target != n.id:
                continue
            src = node_by_id.get(e.source)
            if src is None or src.type != "input" or src.paramRef not in params_by_id:
                continue
            p = params_by_id[src.paramRef]
            if p.minInclusive is not None and n.refValue < p.minInclusive:
                errors.append(
                    ValidationError(
                        nodeId=n.id,
                        code="THRESHOLD_OUT_OF_BOUNDS",
                        message=(
                            f"refValue {n.refValue} ниже допустимого минимума параметра "
                            f"{p.name} ({p.minInclusive})"
                        ),
                        severity="warning",
                    )
                )
            if p.maxInclusive is not None and n.refValue > p.maxInclusive:
                errors.append(
                    ValidationError(
                        nodeId=n.id,
                        code="THRESHOLD_OUT_OF_BOUNDS",
                        message=(
                            f"refValue {n.refValue} выше допустимого максимума параметра "
                            f"{p.name} ({p.maxInclusive})"
                        ),
                        severity="warning",
                    )
                )

    # 6. Cycle detection — DAG required
    try:
        cycles = list(nx.simple_cycles(g))
        if cycles:
            errors.append(
                ValidationError(
                    code="CYCLE_DETECTED",
                    message=f"Обнаружен цикл в правиле: {' → '.join(cycles[0])}",
                )
            )
    except Exception:
        pass

    # 7. SHACL consistency — shacl_constraint nodes must reference an existing constraint
    constraint_ids = {c.id for c in (constraints or [])}
    for n in dsl.nodes:
        if n.type != "shacl_constraint":
            continue
        if not n.constraintRef:
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="MISSING_CONSTRAINT_REF",
                    message="SHACL-узел не ссылается ни на одно ограничение",
                )
            )
            continue
        if constraint_ids and n.constraintRef not in constraint_ids:
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="UNKNOWN_CONSTRAINT_REF",
                    message=(
                        f"constraintRef '{n.constraintRef}' не существует в SHACL-shapes "
                        "регламента. Откройте «Ограничения», добавьте или выберите другой."
                    ),
                )
            )

    # 8. Formula syntax — выражение должно проходить безопасный AST-walker
    # (formula_eval.parse_formula). Иначе пользователь сохранит «битую» формулу,
    # и при /execute получит вердикт fired=false без объяснения. Валидируем
    # до сохранения — ошибка подсветится на узле.
    for n in dsl.nodes:
        if n.type != "formula":
            continue
        expr = (n.expression or "").strip()
        if not expr:
            # Пустая формула — допустимая черновая операция, не ошибка
            # (предупреждение, но severity у нас error/info; пропускаем).
            continue
        try:
            parse_formula(expr)
        except FormulaError as e:
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="FORMULA_SYNTAX",
                    message=f"Синтаксис формулы: {e}",
                )
            )

    has_error = any(e.severity == "error" for e in errors)
    return ValidationResult(valid=not has_error, errors=errors)
