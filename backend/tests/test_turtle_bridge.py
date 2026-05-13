"""Round-trip и edge-case тесты для парсинга/серилизации Turtle.

Если этот файл сломается — значит хранилище или upstream начнут отдавать
непонятный регламент. Критичная регрессия.
"""
from __future__ import annotations

import pytest

from app.services.turtle_bridge import (
    constraints_to_shacl_turtle,
    parse_regulation_turtle,
    parse_shapes_turtle,
    regulation_to_turtle,
)


def test_empty_turtle_returns_minimal_regulation():
    reg = parse_regulation_turtle("", source_id="x")
    assert reg.id == "x"
    assert reg.name == "x"
    assert reg.parameters == []


def test_round_trip_regulation_preserves_params(sample_regulation):
    ttl = regulation_to_turtle(sample_regulation)
    reparsed = parse_regulation_turtle(ttl, source_id="test-reg")
    assert reparsed.name == sample_regulation.name
    assert reparsed.date == sample_regulation.date
    # параметры
    names = {p.name for p in reparsed.parameters}
    assert names == {"pressure", "diameter"}
    by_name = {p.name: p for p in reparsed.parameters}
    assert by_name["pressure"].referenceValue == 20.5
    assert by_name["pressure"].deviationAllowed == 1.5
    assert by_name["diameter"].referenceValue == 5.0


def test_round_trip_preserves_recommendation(sample_regulation):
    ttl = regulation_to_turtle(sample_regulation)
    reparsed = parse_regulation_turtle(ttl, source_id="test-reg")
    assert len(reparsed.recommendations) == 1
    assert reparsed.recommendations[0].text == sample_regulation.recommendations[0].text


def test_turtle_uses_correct_instance_uri(sample_regulation):
    ttl = regulation_to_turtle(sample_regulation)
    # `test-reg` → PascalCase + Regulation = TestRegRegulation
    assert ":TestRegRegulation" in ttl
    assert "a :Regulation" in ttl


def test_shacl_bounds_propagate_to_parameters():
    """Когда передан shapes_turtle, параметры получают границы из SHACL."""
    data = """
        @prefix : <http://regulations.local/ontology#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        :Regulation a owl:Class .
        :pressure a owl:DatatypeProperty .
        :TestRegulation a :Regulation ; :pressure 10.0 .
    """
    shapes = """
        @prefix : <http://regulations.local/ontology#> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        :TestShape a sh:NodeShape ;
            sh:targetClass :Regulation ;
            sh:property [
                sh:path :pressure ;
                sh:datatype xsd:decimal ;
                sh:minInclusive 0.0 ;
                sh:maxInclusive 100.0
            ] .
    """
    reg = parse_regulation_turtle(data, "test", shapes_turtle=shapes)
    p = next(x for x in reg.parameters if x.name == "pressure")
    assert p.minInclusive == 0.0
    assert p.maxInclusive == 100.0


def test_parse_shapes_extracts_severity_and_message():
    shapes = """
        @prefix : <http://regulations.local/ontology#> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        :S a sh:NodeShape ;
          sh:targetClass :Regulation ;
          sh:property [
            sh:path :temperature ;
            sh:datatype xsd:decimal ;
            sh:minCount 1 ;
            sh:message "Температура воздуха"@ru ;
            sh:severity sh:Warning
          ] .
    """
    cs = parse_shapes_turtle(shapes)
    assert len(cs) == 1
    assert cs[0].message == "Температура воздуха"
    assert cs[0].severity == "warning"
    assert cs[0].minCount == 1


def test_constraints_round_trip():
    from app.schemas.domain import Constraint
    cs = [
        Constraint(
            id="pressure", targetClass="Regulation", path="pressure",
            datatype="decimal", minCount=1, minInclusive=0.0, maxInclusive=50.0,
            message="Давление в норме", severity="violation",
        )
    ]
    ttl = constraints_to_shacl_turtle(cs)
    parsed = parse_shapes_turtle(ttl)
    assert len(parsed) == 1
    assert parsed[0].path == "pressure"
    assert parsed[0].minInclusive == 0.0
    assert parsed[0].maxInclusive == 50.0


def test_pascal_case_for_dashed_source_id():
    """Регрессия: source_id с дефисами должен превратиться в PascalCase."""
    from app.schemas.domain import Regulation
    reg = Regulation(id="roof-snow-fencing", name="X")
    ttl = regulation_to_turtle(reg)
    assert ":RoofSnowFencingRegulation" in ttl
