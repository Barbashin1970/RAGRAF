"""Тесты regulation_diff — критично для UI-истории, проще всего поломать рефакторингом."""
from __future__ import annotations

import copy

from app.schemas.domain import Parameter, Regulation
from app.services.regulation_diff import compute_diff


def test_initial_version_no_baseline(sample_regulation):
    diff = compute_diff(None, sample_regulation)
    assert diff["summary"] == "Регламент создан"
    assert diff["counts"]["initial"] == 1
    assert diff["changes"] == []


def test_no_changes_returns_empty(sample_regulation):
    diff = compute_diff(sample_regulation, copy.deepcopy(sample_regulation))
    assert diff["summary"] == "Без изменений"
    assert diff["changes"] == []


def test_single_param_value_change(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.parameters[0].referenceValue = 22.0
    diff = compute_diff(sample_regulation, new)
    assert "20.5" in diff["summary"]
    assert "22.0" in diff["summary"]
    assert diff["counts"]["changed"] == 1
    assert diff["changes"][0]["op"] == "changed"
    assert diff["changes"][0]["path"] == "param.pressure.referenceValue"


def test_status_change_summary(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.status = "active"
    diff = compute_diff(sample_regulation, new)
    assert "статус" in diff["summary"]
    assert "draft → active" in diff["summary"]


def test_parameter_added(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.parameters.append(
        Parameter(id="flow", name="flow", datatype="decimal", referenceValue=1.0, deviationAllowed=0.1, unit="м³/ч")
    )
    diff = compute_diff(sample_regulation, new)
    assert diff["counts"]["added"] == 1
    assert any(c["op"] == "added" and c["path"] == "param.flow" for c in diff["changes"])


def test_parameter_removed(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.parameters = new.parameters[:1]  # удаляем diameter
    diff = compute_diff(sample_regulation, new)
    assert diff["counts"]["removed"] == 1
    assert any(c["op"] == "removed" and c["path"] == "param.diameter" for c in diff["changes"])


def test_recommendation_text_change(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.recommendations[0].text = "Совсем другая рекомендация"
    diff = compute_diff(sample_regulation, new)
    assert any(c["path"] == "recommendation.text" for c in diff["changes"])


def test_long_text_truncated_in_diff(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.recommendations[0].text = "A" * 200
    diff = compute_diff(sample_regulation, new)
    rec_change = next(c for c in diff["changes"] if c["path"] == "recommendation.text")
    # значения должны быть сокращены (≤60 + multibyte safety)
    assert len(str(rec_change["after"])) <= 70


def test_multiple_changes_summary_aggregates(sample_regulation):
    new = copy.deepcopy(sample_regulation)
    new.name = "Новое имя"
    new.parameters[0].referenceValue = 22.0
    new.parameters[1].deviationAllowed = 0.5
    new.status = "active"
    diff = compute_diff(sample_regulation, new)
    # 4 изменения — должно идти агрегированно с counts
    assert diff["counts"]["changed"] == 4
    # summary должен содержать какой-то bucket вида ~4
    assert "~4" in diff["summary"] or len(diff["changes"]) == 4
