"""Тесты валидатора Rule DSL — 7 правил из спеки."""
from __future__ import annotations

from app.schemas.domain import FlowEdge, FlowNode, Parameter, RuleDSL
from app.services.validator import validate_dsl


def _dsl(nodes, edges) -> RuleDSL:
    return RuleDSL(rule_id="r1", regulation_id="reg1", nodes=nodes, edges=edges)


def test_isolated_node_warning():
    dsl = _dsl(
        nodes=[
            FlowNode(id="n1", type="input"),
            FlowNode(id="n2", type="threshold"),
            FlowNode(id="n3", type="output"),
            FlowNode(id="orphan", type="formula"),
        ],
        edges=[
            FlowEdge(source="n1", target="n2"),
            FlowEdge(source="n2", target="n3"),
        ],
    )
    r = validate_dsl(dsl)
    codes = {e.code for e in r.errors}
    assert "ISOLATED_NODE" in codes


def test_missing_input_or_output():
    r1 = validate_dsl(_dsl(nodes=[FlowNode(id="x", type="threshold")], edges=[]))
    assert any(e.code == "MISSING_INPUT" for e in r1.errors)
    assert any(e.code == "MISSING_OUTPUT" for e in r1.errors)


def test_dangling_edge():
    dsl = _dsl(
        nodes=[FlowNode(id="n1", type="input"), FlowNode(id="n2", type="output")],
        edges=[FlowEdge(source="n1", target="missing_node")],
    )
    r = validate_dsl(dsl)
    assert any(e.code == "DANGLING_EDGE" for e in r.errors)


def test_unknown_param_ref():
    dsl = _dsl(
        nodes=[
            FlowNode(id="n1", type="input", paramRef="bogus_param"),
            FlowNode(id="n2", type="output"),
        ],
        edges=[FlowEdge(source="n1", target="n2")],
    )
    params = [Parameter(id="pressure", name="pressure")]
    r = validate_dsl(dsl, parameters=params)
    assert any(e.code == "UNKNOWN_PARAM_REF" for e in r.errors)


def test_cycle_detection():
    dsl = _dsl(
        nodes=[
            FlowNode(id="a", type="input"),
            FlowNode(id="b", type="formula"),
            FlowNode(id="c", type="formula"),
            FlowNode(id="d", type="output"),
        ],
        edges=[
            FlowEdge(source="a", target="b"),
            FlowEdge(source="b", target="c"),
            FlowEdge(source="c", target="b"),  # cycle
            FlowEdge(source="c", target="d"),
        ],
    )
    r = validate_dsl(dsl)
    assert any(e.code == "CYCLE_DETECTED" for e in r.errors)


def test_threshold_bounds_against_param():
    """refValue + deviation выходящий за sh:minInclusive — warning."""
    dsl = _dsl(
        nodes=[
            FlowNode(id="i", type="input", paramRef="pressure"),
            FlowNode(id="t", type="threshold", refValue=5.0, deviation=10.0),
            FlowNode(id="o", type="output"),
        ],
        edges=[
            FlowEdge(source="i", target="t"),
            FlowEdge(source="t", target="o"),
        ],
    )
    params = [
        Parameter(id="pressure", name="pressure", minInclusive=0.0, maxInclusive=20.0)
    ]
    r = validate_dsl(dsl, parameters=params)
    codes = {e.code for e in r.errors}
    assert "THRESHOLD_OUT_OF_BOUNDS" in codes


def test_shacl_constraint_missing_ref():
    dsl = _dsl(
        nodes=[
            FlowNode(id="i", type="input"),
            FlowNode(id="s", type="shacl_constraint"),  # constraintRef=None
            FlowNode(id="o", type="output"),
        ],
        edges=[
            FlowEdge(source="i", target="s"),
            FlowEdge(source="s", target="o"),
        ],
    )
    r = validate_dsl(dsl)
    assert any(e.code == "MISSING_CONSTRAINT_REF" for e in r.errors)


def test_valid_chain_passes():
    dsl = _dsl(
        nodes=[
            FlowNode(id="i", type="input", paramRef="pressure"),
            FlowNode(id="t", type="threshold", refValue=20.0, deviation=2.0),
            FlowNode(id="c1", type="compare"),  # 1 вход — warning, но не error
            FlowNode(id="c2", type="compare"),
            FlowNode(id="o", type="output"),
        ],
        edges=[
            FlowEdge(source="i", target="t"),
            FlowEdge(source="t", target="c1"),
            FlowEdge(source="t", target="c2"),
            FlowEdge(source="c1", target="o"),
            FlowEdge(source="c2", target="o"),
        ],
    )
    params = [Parameter(id="pressure", name="pressure", minInclusive=0.0, maxInclusive=50.0)]
    r = validate_dsl(dsl, parameters=params)
    errors_only = [e for e in r.errors if e.severity == "error"]
    assert errors_only == []
    assert r.valid is True
