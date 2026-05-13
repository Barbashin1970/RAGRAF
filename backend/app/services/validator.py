"""Rule DSL validation — implements the 7 rules from regulation-viz-skill.md § Validation Rules.

Independent of upstream API so it can run on the editor draft before save.
"""
from __future__ import annotations

import networkx as nx

from app.schemas.domain import Parameter, RuleDSL, ValidationError, ValidationResult


def validate_dsl(dsl: RuleDSL, parameters: list[Parameter] | None = None) -> ValidationResult:
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

    # 1. Graph connectivity — no isolated non-IO nodes
    for n in dsl.nodes:
        deg = g.degree(n.id)
        if deg == 0 and n.type not in ("input", "output"):
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

    # 3. Type safety — `compare` requires decimal on both inputs (heuristic)
    # Implementation: ensure compare has at least 2 inbound edges
    for n in dsl.nodes:
        if n.type == "compare":
            in_deg = g.in_degree(n.id) if n.id in g else 0
            if in_deg < 2:
                errors.append(
                    ValidationError(
                        nodeId=n.id,
                        code="COMPARE_INSUFFICIENT_INPUTS",
                        message="Узел сравнения требует 2 входа (value + range)",
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

    # 5. Threshold bounds — refValue ± deviation must be within param bounds
    for n in dsl.nodes:
        if n.type == "threshold" and n.refValue is not None and n.deviation is not None:
            lo = n.refValue - n.deviation
            hi = n.refValue + n.deviation
            # find connected input → param
            for e in dsl.edges:
                if e.target == n.id:
                    src = node_by_id.get(e.source)
                    if src and src.type == "input" and src.paramRef in params_by_id:
                        p = params_by_id[src.paramRef]
                        if p.minInclusive is not None and lo < p.minInclusive:
                            errors.append(
                                ValidationError(
                                    nodeId=n.id,
                                    code="THRESHOLD_OUT_OF_BOUNDS",
                                    message=(
                                        f"Нижний порог {lo} ниже допустимого минимума параметра "
                                        f"{p.name} ({p.minInclusive})"
                                    ),
                                    severity="warning",
                                )
                            )
                        if p.maxInclusive is not None and hi > p.maxInclusive:
                            errors.append(
                                ValidationError(
                                    nodeId=n.id,
                                    code="THRESHOLD_OUT_OF_BOUNDS",
                                    message=(
                                        f"Верхний порог {hi} выше допустимого максимума параметра "
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
    # (just check the field is non-empty here — actual existence check needs constraint list)
    for n in dsl.nodes:
        if n.type == "shacl_constraint" and not n.constraintRef:
            errors.append(
                ValidationError(
                    nodeId=n.id,
                    code="MISSING_CONSTRAINT_REF",
                    message="SHACL-узел не ссылается ни на одно ограничение",
                )
            )

    has_error = any(e.severity == "error" for e in errors)
    return ValidationResult(valid=not has_error, errors=errors)
