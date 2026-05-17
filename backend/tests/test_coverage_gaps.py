"""Тесты на endpoints, которые не были покрыты основными suite'ами.

Заполняет очевидные пробелы по результатам аудита покрытия:
  - /api/domains POST + DELETE
  - /api/regulations/{id}/raw
  - /api/regulations/{id}/regulation-restore/{vid}
  - /api/regulations/{id}/flow/history + flow/restore/{vid}
  - /api/regulations/{id}/constraints PUT
  - /api/regulations/{id}/shacl/export
  - /api/graph + /api/graph/regulation/{id}
  - /api/sandbox/llm-info

LLM-зависимые endpoints (/api/sandbox/chat, /api/ragu/*) намеренно
не покрываем — там нужен живой Ollama, а не unit-инфраструктура.
Документ-pipeline (/api/sandbox/documents/*) — отдельная тема, в бэклоге.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── Domains CRUD ───────────────────────────────────────────────────────


def test_create_user_domain(client):
    r = client.post("/api/domains", json={
        "label": "Тестовый домен",
        "hint": "Для тестов",
        "suggested_id": "test-domain",
    })
    # 201 Created (FastAPI default для POST'а с resource creation).
    assert r.status_code in (200, 201)
    body = r.json()
    assert body["id"] == "test-domain"
    assert body["label"] == "Тестовый домен"

    # Появился в /api/domains.
    domains = client.get("/api/domains").json()
    assert any(d["id"] == "test-domain" for d in domains)


def test_delete_user_domain(client):
    client.post("/api/domains", json={"label": "X", "suggested_id": "x-domain"})
    r = client.delete("/api/domains/x-domain")
    assert r.status_code == 200
    assert client.delete("/api/domains/x-domain").status_code == 404


# ── Regulation raw / restore ───────────────────────────────────────────


def test_regulation_raw_returns_turtle(client):
    r = client.get("/api/regulations/pressure-diameter/raw")
    assert r.status_code == 200
    body = r.text
    # Turtle-формат должен содержать prefixes и сам :Regulation.
    assert "@prefix" in body
    assert "Regulation" in body


def test_regulation_restore_round_trips(client):
    # 1. Берём свежий регламент
    base = client.get("/api/regulations/pressure-diameter").json()
    initial_name = base["name"]

    # 2. Редактируем → получаем новую версию в history
    edited = dict(base)
    edited["name"] = "MUTATED-NAME"
    client.put("/api/regulations/pressure-diameter", json=edited)

    # 3. Берём id предыдущей версии (она была initial)
    hist = client.get("/api/regulations/pressure-diameter/regulation-history").json()
    assert len(hist) >= 2
    # самая старая — initial; восстанавливаем её
    initial_vid = hist[-1]["version_id"]
    r = client.post(f"/api/regulations/pressure-diameter/regulation-restore/{initial_vid}")
    assert r.status_code == 200
    restored = r.json()
    assert restored["name"] == initial_name


# ── Flow history / restore ─────────────────────────────────────────────


def test_flow_history_and_restore(client):
    # Получаем стартовый flow и сохраняем версию.
    flow = client.get("/api/regulations/pressure-diameter/flow").json()
    flow["nodes"].append({
        "id": "ext_test", "type": "formula", "label": "test",
        "expression": "1+1", "position": {"x": 100, "y": 100},
    })
    r = client.put("/api/regulations/pressure-diameter/flow", json=flow)
    assert r.status_code == 200
    version_id = r.json()["version"]
    # История содержит хотя бы одну версию.
    hist = client.get("/api/regulations/pressure-diameter/flow/history").json()
    assert len(hist) >= 1
    assert any(v["version_id"] == version_id for v in hist)
    # Restore читает snapshot и сохраняет как НОВУЮ версию — поэтому
    # возвращённый version_id отличается от того, что мы передали. Главное:
    # вызов прошёл, и в истории теперь больше записей.
    r = client.post(f"/api/regulations/pressure-diameter/flow/restore/{version_id}")
    assert r.status_code == 200
    restored = r.json()
    assert "version_id" in restored
    new_hist = client.get("/api/regulations/pressure-diameter/flow/history").json()
    assert len(new_hist) > len(hist)


# ── Constraints PUT (сохранение) ───────────────────────────────────────


def test_constraints_save_persists(client):
    # Получаем текущие constraints
    cs = client.get("/api/regulations/pressure-diameter/constraints").json()
    initial_count = len(cs)
    new_constraint = {
        "id": "c_test",
        "targetClass": "Regulation",
        "path": "pressure",
        "datatype": "decimal",
        "minInclusive": 0.0,
        "maxInclusive": 50.0,
        "severity": "warning",
        "message": "Тестовое ограничение",
    }
    payload = cs + [new_constraint]
    r = client.put("/api/regulations/pressure-diameter/constraints", json=payload)
    # 502 — upstream SIGMA не доступен в test-окружении (writeback пытается
    # запушить shapes наверх). В test-моде ожидаем 200, либо 502 если включён
    # writeback и нет stub'а. Главное — endpoint существует и обрабатывает payload.
    assert r.status_code in (200, 502)
    if r.status_code == 200:
        cs2 = client.get("/api/regulations/pressure-diameter/constraints").json()
        assert len(cs2) == initial_count + 1


# ── SHACL export ───────────────────────────────────────────────────────


def test_shacl_export_returns_turtle(client):
    r = client.get("/api/regulations/pressure-diameter/shacl/export")
    assert r.status_code == 200
    body = r.text
    assert "@prefix" in body
    assert "sh:" in body or "NodeShape" in body


# ── Graph ──────────────────────────────────────────────────────────────


def test_graph_full(client):
    r = client.get("/api/graph")
    assert r.status_code == 200
    body = r.json()
    assert "nodes" in body
    assert "edges" in body
    # Хотя бы регламенты-узлы должны быть.
    types = {n["data"]["type"] for n in body["nodes"]}
    assert "Regulation" in types or "regulation" in types or len(body["nodes"]) > 0


def test_graph_filtered_by_domain(client):
    r = client.get("/api/graph?domain=heating")
    assert r.status_code == 200
    body = r.json()
    # Все ноды-Regulation в этом подграфе должны быть heating.
    for n in body["nodes"]:
        if n["data"].get("domain"):
            # допускаем только heating или null (не Regulation-узлы)
            assert n["data"]["domain"] in (None, "heating")


def test_graph_for_one_regulation(client):
    r = client.get("/api/graph/regulation/pressure-diameter")
    assert r.status_code == 200
    body = r.json()
    assert "nodes" in body
    ids = {n["data"]["id"] for n in body["nodes"]}
    # Хотя бы сам регламент-узел и его параметры.
    assert any("pressure-diameter" in i for i in ids)


# ── Sandbox llm-info ───────────────────────────────────────────────────


def test_sandbox_llm_info_returns_mode(client):
    r = client.get("/api/sandbox/llm-info")
    assert r.status_code == 200
    body = r.json()
    # Поле mode обязательно — мы по нему делаем UI-индикатор.
    assert "mode" in body
