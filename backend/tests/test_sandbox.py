"""Sandbox demos — semantic search + parameter extraction в mock-режиме.

Не зависят от RAGU / LLM ключей — должны работать out-of-the-box.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── Status ─────────────────────────────────────────────────────────────


def test_sandbox_status(client):
    r = client.get("/api/sandbox/status")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] in ("mock", "real")
    # При выключенном RAGU должен быть mock
    assert body["mode"] == "mock"
    assert "semantic-search" in body["demos"]
    assert "extract-parameters" in body["demos"]


# ── Semantic search ────────────────────────────────────────────────────


def test_search_finds_relevant_regulation_by_name(client):
    r = client.post("/api/sandbox/search", json={"query": "давление трубопровод водоснабжение"})
    body = r.json()
    assert r.status_code == 200
    results = body["results"]
    assert len(results) > 0
    # Топ-1 должен быть pressure-diameter (он самый «совпадающий» по терминам)
    assert results[0]["regulation_id"] == "pressure-diameter"
    assert results[0]["score"] > 0
    assert results[0]["matched_terms"]


def test_search_returns_snippet(client):
    r = client.post("/api/sandbox/search", json={"query": "герметичность утечка"})
    results = r.json()["results"]
    assert results
    # snippet должен содержать хотя бы один matched-term
    top = results[0]
    snippet_lower = top["snippet"].lower()
    assert any(t in snippet_lower for t in top["matched_terms"])


def test_search_empty_query_returns_empty(client):
    r = client.post("/api/sandbox/search", json={"query": ""})
    assert r.json()["results"] == []


def test_search_unrelated_query_returns_empty_or_low(client):
    r = client.post("/api/sandbox/search", json={"query": "квантовая физика струн черные дыры"})
    results = r.json()["results"]
    # Возможно 0 либо очень низкие скоры — главное, не падает
    if results:
        assert all(r["score"] >= 0 for r in results)


def test_search_top_k_limit(client):
    r = client.post("/api/sandbox/search", json={"query": "температура давление", "top_k": 2})
    assert r.status_code == 200
    assert len(r.json()["results"]) <= 2


def test_search_matches_recommendation_text(client):
    # Текст из рекомендации, не из имени
    r = client.post("/api/sandbox/search", json={"query": "герметичность"})
    results = r.json()["results"]
    assert any(item["regulation_id"] == "pressure-diameter" for item in results)


# ── Parameter extraction ──────────────────────────────────────────────


def test_extract_finds_pressure_param(client):
    text = "Давление в системе должно составлять 20.5 ± 1.5 атм по нормативу."
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    assert r.status_code == 200
    body = r.json()
    extracted = body["extracted"]
    assert len(extracted) == 1
    p = extracted[0]
    assert p["value"] == 20.5
    assert p["deviation"] == 1.5
    assert p["unit"] == "атм"
    assert p["suggested_name"] == "pressure"
    assert p["confidence"] >= 0.8


def test_extract_finds_multiple_params(client):
    text = (
        "Эксплуатационные параметры теплосети: "
        "температура подачи 70 ± 10 °C, давление 4 атм, "
        "расход 1.5 м³/ч в нормальном режиме."
    )
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    extracted = r.json()["extracted"]
    assert len(extracted) >= 3
    names = {e["suggested_name"] for e in extracted}
    assert "temperature" in names
    assert "pressure" in names
    assert "flowRate" in names


def test_extract_pm25_with_unit(client):
    text = "Норма ВОЗ по PM2.5 составляет 35 мкг/м³ за сутки."
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    extracted = r.json()["extracted"]
    assert extracted
    assert extracted[0]["value"] == 35
    assert extracted[0]["unit"] == "мкг/м³"
    assert extracted[0]["suggested_name"] == "pm25Concentration"


def test_extract_without_context_uses_fallback_name(client):
    text = "Норматив 100 мин для пересменка."
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    extracted = r.json()["extracted"]
    assert extracted
    # Контекстное слово ("время"/"реакц") не найдено — будет fallback param_N с низкой confidence
    if extracted[0]["suggested_name"].startswith("param_"):
        assert extracted[0]["confidence"] < 0.5


def test_extract_empty_text_returns_empty(client):
    r = client.post("/api/sandbox/extract-parameters", json={"text": ""})
    assert r.json()["extracted"] == []


def test_extract_source_text_contains_original(client):
    text = "Скорость ветра 1.5 м/с указывает на штиль."
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    extracted = r.json()["extracted"]
    assert extracted
    # source_text должен включать саму цифру или единицу
    assert "1.5" in extracted[0]["source_text"] or "м/с" in extracted[0]["source_text"]


# ── Create regulation from extracted params ──────────────────────────


def test_create_from_params_builds_regulation(client):
    payload = {
        "name": "Тестовый регламент из песочницы",
        "domain": "heating",
        "params": [
            {"suggested_name": "pressure", "value": 20.5, "deviation": 1.5, "unit": "атм"},
            {"suggested_name": "temperature", "value": 70.0, "deviation": 10.0, "unit": "°C"},
        ],
    }
    r = client.post("/api/sandbox/create-from-params", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["regulation_id"]
    assert body["domain"] == "heating"
    assert body["parameters_count"] == 2

    # Регламент реально лежит в DuckDB store — GET должен его отдать.
    r2 = client.get(f"/api/regulations/{body['regulation_id']}")
    assert r2.status_code == 200
    reg = r2.json()
    assert reg["name"] == payload["name"]
    assert reg["domain"] == "heating"
    names = {p["name"] for p in reg["parameters"]}
    assert {"pressure", "temperature"}.issubset(names)
    # Параметры пришли с ref/dev из extracted
    by_name = {p["name"]: p for p in reg["parameters"]}
    assert by_name["pressure"]["referenceValue"] == 20.5
    assert by_name["pressure"]["deviationAllowed"] == 1.5
    assert by_name["pressure"]["unit"] == "атм"


def test_create_from_params_rejects_unknown_domain(client):
    r = client.post(
        "/api/sandbox/create-from-params",
        json={
            "name": "X",
            "domain": "no-such-domain",
            "params": [{"suggested_name": "x", "value": 1.0, "unit": "ед"}],
        },
    )
    assert r.status_code == 400


def test_create_from_params_rejects_empty_params(client):
    r = client.post(
        "/api/sandbox/create-from-params",
        json={"name": "X", "domain": "heating", "params": []},
    )
    # pydantic min_length=1 → 422
    assert r.status_code == 422


def test_create_from_params_deduplicates_param_ids(client):
    # Два одинаковых suggested_name — оба должны попасть, второй с суффиксом.
    r = client.post(
        "/api/sandbox/create-from-params",
        json={
            "name": "Diameter Duo",
            "domain": "heating",
            "params": [
                {"suggested_name": "diameter", "value": 5.0, "deviation": 0.2, "unit": "см"},
                {"suggested_name": "diameter", "value": 8.0, "deviation": 0.3, "unit": "см"},
            ],
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["parameters_count"] == 2
    reg = client.get(f"/api/regulations/{body['regulation_id']}").json()
    ids = [p["id"] for p in reg["parameters"]]
    assert "diameter" in ids
    assert any(i.startswith("diameter") and i != "diameter" for i in ids)


def test_extract_real_pdf_excerpt(client):
    """Текст похож на формулировку из Rules-Management.pdf."""
    text = (
        "Регламент устанавливает: номинальный диаметр 5.0 см с максимальным "
        "отклонением 0.2 см. Давление в трубопроводе поддерживается на уровне "
        "20.5 атм при допустимом отклонении 1.5 атм."
    )
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    extracted = r.json()["extracted"]
    names = {e["suggested_name"] for e in extracted}
    assert "diameter" in names
    assert "pressure" in names
