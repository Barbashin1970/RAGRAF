"""Тесты интерпретатора flow-графа (режим «Исполнение регламента»).

Сценарии моделируют типичный flow `input → threshold → output`:
  - норма  : value внутри [refValue-deviation, refValue+deviation]
  - превышение / критика: value снаружи диапазона

Регламент pressure-diameter (фикстура): pressure ref=20.5 ± 1.5, output priority=2.
"""
from __future__ import annotations

import pytest

from app.schemas.domain import (
    FlowEdge,
    FlowNode,
    Parameter,
    Regulation,
    RuleDSL,
)
from app.services.flow_executor import (
    ExecutionResult,
    SensorReading,
    execute_flow,
)


# ── Fixtures ──────────────────────────────────────────────────────────────


def _build_pressure_regulation() -> Regulation:
    return Regulation(
        id="pressure-diameter",
        name="Регламент на допустимые параметры давления",
        domain="heating",
        parameters=[
            Parameter(id="pressure", name="Давление", referenceValue=20.5, deviationAllowed=1.5, unit="атм"),
            Parameter(id="diameter", name="Диаметр",  referenceValue=5.0,  deviationAllowed=0.2, unit="мм"),
        ],
    )


def _build_flow_with_sensor(
    *,
    include_diameter: bool = False,
    with_sensor: bool = True,
) -> RuleDSL:
    """Канонический поток: sensor_p → input_pressure → threshold → output.

    При with_sensor=False — обходимся без sensor-ноды (executor должен
    уметь резолвить reading по param_id напрямую).
    """
    nodes: list[FlowNode] = []
    edges: list[FlowEdge] = []

    if with_sensor:
        nodes.append(FlowNode(
            id="sens_p", type="sensor", sensorType="p", bindsTo="in_pressure",
            externalId="edge_1",
        ))
        edges.append(FlowEdge(source="sens_p", target="in_pressure"))

    nodes.extend([
        FlowNode(id="in_pressure", type="input", paramRef="pressure"),
        FlowNode(id="thr_p", type="threshold", refValue=20.5, deviation=1.5, unit="атм"),
        FlowNode(id="out_warn", type="output",
                 action="notify", text="Проверьте давление", priority=2),
    ])
    edges.extend([
        FlowEdge(source="in_pressure", target="thr_p"),
        FlowEdge(source="thr_p", target="out_warn"),
    ])

    if include_diameter:
        nodes.extend([
            FlowNode(id="in_diam", type="input", paramRef="diameter"),
            FlowNode(id="thr_d", type="threshold", refValue=5.0, deviation=0.2, unit="мм"),
            FlowNode(id="out_crit", type="output",
                     action="alert", text="Несоответствие диаметра", priority=1),
        ])
        edges.extend([
            FlowEdge(source="in_diam", target="thr_d"),
            FlowEdge(source="thr_d", target="out_crit"),
        ])

    return RuleDSL(rule_id="rule_pressure", regulation_id="pressure-diameter", nodes=nodes, edges=edges)


# ── Scenarios ──────────────────────────────────────────────────────────────


def test_in_range_value_returns_level_zero() -> None:
    """Значение в норме — ни одно out_of_range не срабатывает, level=0."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=20.5, sensor_id="sens_p")])
    assert isinstance(res, ExecutionResult)
    assert res.level == 0
    assert res.recommendation is None
    # Sensor и input «сработали» (получили значение), но threshold не fire'нул.
    assert "thr_p" not in res.fired_nodes
    assert "out_warn" not in res.fired_nodes
    assert res.inputs_resolved == {"in_pressure": 20.5}


def test_value_outside_tolerance_fires_output() -> None:
    """value сильно выше ref+deviation → threshold out_of_range → output fired."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=25.0, sensor_id="sens_p")])
    assert res.level == 2  # priority output'а
    assert res.recommendation == "Проверьте давление"
    assert {"thr_p", "out_warn"}.issubset(set(res.fired_nodes))
    # Подсветка рёбер для UI: sensor → input → threshold → output.
    assert "sens_p__in_pressure" in res.fired_edges
    assert "in_pressure__thr_p" in res.fired_edges
    assert "thr_p__out_warn" in res.fired_edges


def test_resolution_by_param_id_without_sensor_node() -> None:
    """Бэк должен уметь принимать reading с param_id напрямую — даже когда
    в потоке нет sensor-ноды. Это покрывает legacy-фикстуры и быстрый dry-run."""
    dsl = _build_flow_with_sensor(with_sensor=False)
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=30.0, param_id="pressure")])
    assert res.level == 2
    assert res.inputs_resolved == {"in_pressure": 30.0}


def test_resolution_by_sensor_type_matches_first_matching_sensor() -> None:
    """ETL-payload `{type: 'p', value: ...}` без знания об id ноды → executor
    находит sensor с sensorType='p' и инжектит value через bindsTo."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=25.0, sensor_type="p")])
    assert res.level == 2
    assert res.inputs_resolved == {"in_pressure": 25.0}


def test_multiple_outputs_take_max_priority() -> None:
    """Если сработали несколько output'ов разных priorities — берём max
    (1 — самый критичный, см. ТЗ/SIGMA §4.1.3 шкалу critical/important/normal)."""
    dsl = _build_flow_with_sensor(include_diameter=True)
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [
        SensorReading(value=25.0, param_id="pressure"),  # priority=2 fire
        SensorReading(value=10.0, param_id="diameter"),  # priority=1 fire
    ])
    assert res.level == 2  # max(1, 2) = 2 (priority 1 — критический, но шкала
    # «больше число = строже»; см. шаблоны Recommendation.priority в schemas.)
    assert "Проверьте давление" in (res.recommendation or "")
    assert "Несоответствие диаметра" in (res.recommendation or "")


def test_unresolved_reading_is_silently_ignored() -> None:
    """Reading с непривязанным sensor_id не должен крашить executor."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [
        SensorReading(value=99.0, sensor_id="phantom_sensor"),
        SensorReading(value=20.5, sensor_id="sens_p"),
    ])
    assert res.level == 0
    assert res.inputs_resolved == {"in_pressure": 20.5}


def test_unconfigured_threshold_does_not_fire() -> None:
    """Если у threshold'а нет refValue или deviation — он не fire'ит даже
    при экстремальных значениях. UI должен показать «настройте порог»."""
    dsl = RuleDSL(
        rule_id="r", regulation_id="r",
        nodes=[
            FlowNode(id="i", type="input", paramRef="pressure"),
            FlowNode(id="t", type="threshold", refValue=None, deviation=None),
            FlowNode(id="o", type="output", text="x", priority=2),
        ],
        edges=[FlowEdge(source="i", target="t"), FlowEdge(source="t", target="o")],
    )
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=999.0, param_id="pressure")])
    assert res.level == 0
    assert "o" not in res.fired_nodes


def test_explanation_strings_are_human_readable() -> None:
    """Trace должен возвращать поясняющие строки — это видит аналитик в
    режиме симуляции и СИГМА в логах."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=25.0, sensor_id="sens_p", external_id="edge_1")])
    by_id = {t.node_id: t for t in res.trace}
    assert "sens_p" in by_id
    assert "edge_1" in (by_id["sens_p"].explanation or "")
    assert "Давление = 25.0" in (by_id["in_pressure"].explanation or "")
    assert "out_of_range" in (by_id["thr_p"].explanation or "")


@pytest.mark.parametrize(
    "value,expected_level",
    [
        (20.5, 0),  # точно ref
        (19.0, 0),  # на нижней границе
        (22.0, 0),  # на верхней границе
        (18.9, 2),  # чуть ниже tolerance
        (22.1, 2),  # чуть выше tolerance
        (50.0, 2),  # катастрофа
    ],
)
def test_boundary_values_for_pressure(value: float, expected_level: int) -> None:
    """Проверка границ tolerance'а: 20.5 ± 1.5 → диапазон [19.0, 22.0]."""
    dsl = _build_flow_with_sensor()
    reg = _build_pressure_regulation()
    res = execute_flow(dsl, reg, [SensorReading(value=value, sensor_id="sens_p")])
    assert res.level == expected_level
