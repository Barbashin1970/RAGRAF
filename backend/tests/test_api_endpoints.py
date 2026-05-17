"""Интеграционные тесты HTTP API через FastAPI TestClient.

Проверяют главный сквозной сценарий: GET список → GET один → PUT правка → GET history →
GET diff → publish → archive. Это страховка от любых регрессий в роутерах.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    # импорт после monkeypatch DATA_DIR, чтобы lifespan создавал DB в tmp
    from app.main import app

    # lifespan вызывается при первом запросе
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_domains_list(client):
    r = client.get("/api/domains")
    assert r.status_code == 200
    ids = {d["id"] for d in r.json()}
    assert {"heating", "housing", "safety", "environment"}.issubset(ids)


def test_datasets_after_seed_have_six(client):
    r = client.get("/api/datasets")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 6
    # каждый дoлжен иметь domain
    assert all("domain" in item for item in items)


def test_get_specific_regulation(client):
    r = client.get("/api/regulations/pressure-diameter")
    assert r.status_code == 200
    data = r.json()
    assert data["domain"] == "heating"
    assert len(data["parameters"]) == 2
    names = {p["name"] for p in data["parameters"]}
    assert names == {"pressure", "diameter"}


def test_put_regulation_persists(client):
    # начальное состояние
    initial = client.get("/api/regulations/pressure-diameter").json()
    pressure_param = next(p for p in initial["parameters"] if p["name"] == "pressure")
    assert pressure_param["referenceValue"] == 20.5

    # правка
    new = dict(initial)
    new["parameters"] = [
        {**p, "referenceValue": 25.0} if p["name"] == "pressure" else p
        for p in new["parameters"]
    ]
    r = client.put("/api/regulations/pressure-diameter", json=new)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] == "true"
    assert "version" in body

    # перезагружаем — должны увидеть новое значение
    reloaded = client.get("/api/regulations/pressure-diameter").json()
    p = next(p for p in reloaded["parameters"] if p["name"] == "pressure")
    assert p["referenceValue"] == 25.0


def test_history_with_diff_summary(client):
    # делаем 2 правки чтобы было что diff'ать
    base = client.get("/api/regulations/pressure-diameter").json()

    edit1 = {**base, "parameters": [{**p, "referenceValue": 22.0} if p["name"] == "pressure" else p for p in base["parameters"]]}
    client.put("/api/regulations/pressure-diameter", json=edit1)

    edit2 = {**edit1, "name": edit1["name"] + " (отредактировано)"}
    client.put("/api/regulations/pressure-diameter", json=edit2)

    hist = client.get("/api/regulations/pressure-diameter/regulation-history").json()
    assert len(hist) >= 2
    latest = hist[0]
    assert "diff_summary" in latest
    assert "diff_counts" in latest
    # хотя бы одна правка должна быть detected
    assert latest["diff_counts"].get("changed", 0) >= 1


def test_diff_endpoint_returns_structured_changes(client):
    base = client.get("/api/regulations/pressure-diameter").json()
    edit = {**base, "parameters": [{**p, "referenceValue": 30.0} if p["name"] == "pressure" else p for p in base["parameters"]]}
    client.put("/api/regulations/pressure-diameter", json=edit)

    hist = client.get("/api/regulations/pressure-diameter/regulation-history").json()
    latest_id = hist[0]["version_id"]
    diff = client.get(f"/api/regulations/pressure-diameter/regulation-diff/{latest_id}").json()
    assert "changes" in diff
    assert any(c["path"] == "param.pressure.referenceValue" for c in diff["changes"])


def test_publish_archive_workflow(client):
    # начальное состояние — какой бы ни был статус, переводим
    r = client.post("/api/regulations/pressure-diameter/publish")
    assert r.status_code == 200
    assert r.json()["status"] == "active"

    r = client.post("/api/regulations/pressure-diameter/archive")
    assert r.status_code == 200
    assert r.json()["status"] == "archived"


def test_publish_unknown_regulation_returns_404(client):
    r = client.post("/api/regulations/does-not-exist/publish")
    assert r.status_code == 404


def test_flow_endpoint_returns_starter_dsl(client):
    """Без сохранённых flow редактор должен получить стартовый DSL из фикстуры."""
    r = client.get("/api/regulations/pressure-diameter/flow")
    assert r.status_code == 200
    dsl = r.json()
    assert dsl["regulation_id"] == "pressure-diameter"
    # в стартере должны быть узлы
    assert len(dsl["nodes"]) > 0


def test_constraints_endpoint(client):
    r = client.get("/api/regulations/pressure-diameter/constraints")
    assert r.status_code == 200
    cs = r.json()
    assert len(cs) > 0


def test_validate_endpoint(client):
    r = client.get("/api/regulations/pressure-diameter/flow")
    dsl = r.json()
    v = client.post("/api/regulations/pressure-diameter/validate", json=dsl)
    assert v.status_code == 200
    assert "errors" in v.json()
    assert "valid" in v.json()


def test_execute_endpoint_runs_flow(client):
    """Боевой endpoint: ETL-payload → вердикт.

    Шлём DSL inline (без save), чтобы тест не зависел от состояния хранилища
    флоу. Сэмпл моделирует «pressure=25 атм при ref=20.5±1.5» → out_of_range
    → output с priority=2.
    """
    dsl = {
        "rule_id": "rule_exec_test",
        "regulation_id": "pressure-diameter",
        "nodes": [
            {"id": "s", "type": "sensor", "sensorType": "p", "bindsTo": "i"},
            {"id": "i", "type": "input", "paramRef": "pressure"},
            {"id": "t", "type": "threshold", "refValue": 20.5, "deviation": 1.5},
            {"id": "o", "type": "output", "text": "Проверьте давление", "priority": 2},
        ],
        "edges": [
            {"source": "s", "target": "i"},
            {"source": "i", "target": "t"},
            {"source": "t", "target": "o"},
        ],
    }
    body = {"dsl": dsl, "readings": [{"value": 25.0, "sensor_id": "s"}]}
    r = client.post("/api/regulations/pressure-diameter/execute", json=body)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["level"] == 2
    assert result["recommendation"] == "Проверьте давление"
    assert "t" in result["fired_nodes"]
    assert "o" in result["fired_nodes"]


def test_execute_endpoint_returns_level_zero_for_in_range(client):
    dsl = {
        "rule_id": "rule_exec_test",
        "regulation_id": "pressure-diameter",
        "nodes": [
            {"id": "s", "type": "sensor", "sensorType": "p", "bindsTo": "i"},
            {"id": "i", "type": "input", "paramRef": "pressure"},
            {"id": "t", "type": "threshold", "refValue": 20.5, "deviation": 1.5},
            {"id": "o", "type": "output", "text": "x", "priority": 2},
        ],
        "edges": [
            {"source": "s", "target": "i"},
            {"source": "i", "target": "t"},
            {"source": "t", "target": "o"},
        ],
    }
    body = {"dsl": dsl, "readings": [{"value": 20.0, "sensor_id": "s"}]}
    r = client.post("/api/regulations/pressure-diameter/execute", json=body)
    assert r.status_code == 200
    assert r.json()["level"] == 0


def test_execute_endpoint_404_for_unknown_regulation(client):
    body = {"readings": [{"value": 25.0, "param_id": "pressure"}]}
    r = client.post("/api/regulations/does-not-exist/execute", json=body)
    assert r.status_code == 404
