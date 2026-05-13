"""Тесты POST /api/regulations — создание нового регламента из шаблона."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_create_heating_uses_template(client):
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Мой тепловой регламент"})
    assert r.status_code == 201
    data = r.json()
    assert data["domain"] == "heating"
    assert data["name"] == "Мой тепловой регламент"
    # шаблон heating дал 3 параметра
    names = {p["name"] for p in data["parameters"]}
    assert {"temperature", "pressure", "flowRate"}.issubset(names)
    # status — draft (новый), не active
    assert data["status"] == "draft"
    # рекомендация есть
    assert len(data["recommendations"]) == 1
    assert "теплосет" in data["recommendations"][0]["text"].lower() or "контур" in data["recommendations"][0]["text"].lower()


def test_create_returns_id_slug(client):
    r = client.post("/api/regulations", json={"domain": "housing", "name": "Тест слаг"})
    assert r.status_code == 201
    data = r.json()
    # Кириллица должна транслитерироваться в kebab-case ASCII
    assert data["id"].replace("-", "").isascii()
    assert "test" in data["id"].lower() or "tes" in data["id"].lower()


def test_create_then_get_persists(client):
    r = client.post("/api/regulations", json={"domain": "safety", "name": "Эскалация инцидента"})
    sid = r.json()["id"]
    # GET должен отдать ровно тот же
    r2 = client.get(f"/api/regulations/{sid}")
    assert r2.status_code == 200
    assert r2.json()["domain"] == "safety"
    assert len(r2.json()["parameters"]) >= 3


def test_create_then_listed_in_datasets(client):
    r = client.post("/api/regulations", json={"domain": "environment", "name": "Свежий регламент"})
    sid = r.json()["id"]
    ds = client.get("/api/datasets").json()
    ids = {item["id"] for item in ds if isinstance(item, dict)}
    assert sid in ids


def test_create_seeds_starter_flow(client):
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Starter Flow Test"})
    sid = r.json()["id"]
    flow = client.get(f"/api/regulations/{sid}/flow").json()
    # шаблон heating даёт линейный flow по 3 параметрам: 3 input + 3 threshold + 3 compare + 1 output = 10 узлов
    assert len(flow["nodes"]) == 10
    types = {n["type"] for n in flow["nodes"]}
    assert types == {"input", "threshold", "compare", "output"}


def test_create_creates_history_entry(client):
    r = client.post("/api/regulations", json={"domain": "housing", "name": "С историей"})
    sid = r.json()["id"]
    hist = client.get(f"/api/regulations/{sid}/regulation-history").json()
    assert len(hist) == 1
    assert "Создан" in hist[0]["comment"] or "POST" in hist[0]["comment"]


def test_create_collision_appends_uuid_suffix(client):
    # Создаём дважды с тем же именем — slug должен расходиться
    r1 = client.post("/api/regulations", json={"domain": "heating", "name": "Дубликат имени"})
    r2 = client.post("/api/regulations", json={"domain": "heating", "name": "Дубликат имени"})
    assert r1.json()["id"] != r2.json()["id"]
    # У второго должен быть -<6hex> суффикс
    assert len(r2.json()["id"]) > len(r1.json()["id"])


def test_create_invalid_domain_rejected(client):
    r = client.post("/api/regulations", json={"domain": "moon-colony", "name": "Регламент Луны"})
    assert r.status_code == 400
    assert "Неизвестный домен" in r.text


def test_create_without_template_gives_empty(client):
    r = client.post("/api/regulations", json={
        "domain": "heating",
        "name": "Минимальный",
        "use_template": False,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["parameters"] == []
    # Empty flow тоже не создаётся (только meta-record в DuckDB)
    flow = client.get(f"/api/regulations/{data['id']}/flow").json()
    assert flow["nodes"] == []


def test_create_explicit_source_id(client):
    r = client.post("/api/regulations", json={
        "domain": "safety",
        "name": "С явным id",
        "source_id": "my-custom-reg-id",
    })
    assert r.status_code == 201
    assert r.json()["id"] == "my-custom-reg-id"


def test_all_four_domains_have_templates(client):
    for domain in ["heating", "housing", "safety", "environment"]:
        r = client.post("/api/regulations", json={"domain": domain})
        assert r.status_code == 201, f"failed for {domain}: {r.text}"
        data = r.json()
        # каждый шаблон должен дать >=3 параметра
        assert len(data["parameters"]) >= 3, f"{domain} template has too few params"
        assert data["recommendations"], f"{domain} template has no recommendation"
