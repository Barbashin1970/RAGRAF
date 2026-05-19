"""Тесты Turtle-экспорта двойника — должен нести wiring/композицию.

Регресс: первая версия экспорта `GET /api/processes/{id}/turtle` склеивала
N регламентов подряд без какого-либо упоминания самого двойника или связей
между членами. Потребитель (Apache Jena, Protégé, SIGMA-ядро) не мог
отличить «3 регламента случайно» от «3 регламента в составе процесса A→B→C».

Теперь Turtle содержит:
  • Header-блок `:Twin_<id> a :DigitalTwin` с :hasMember и :hasWiring.
  • Per-wiring :Wiring блоки с :sourceRegulation/:sourceOutput/:targetRegulation/:targetInput.
  • Декларации OWL-классов :DigitalTwin / :Wiring + ObjectProperties.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def _create_reg(client, *, domain: str = "heating", name: str = "R") -> str:
    r = client.post("/api/regulations", json={"domain": domain, "name": name})
    assert r.status_code == 201
    return r.json()["id"]


def _flow_with_input(client, reg_id: str, param: str) -> None:
    client.put(f"/api/regulations/{reg_id}/flow", json={
        "rule_id": f"rule_{reg_id}",
        "regulation_id": reg_id,
        "nodes": [{"id": "n_in", "type": "input", "paramRef": param, "label": param}],
        "edges": [],
    })


def test_turtle_includes_twin_header_and_wiring(client):
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")
    twin = client.post("/api/processes", json={
        "id": "", "name": "Цепочка", "description": "тестовая",
        "regulation_ids": [a, b],
        "wiring": [{
            "target_regulation": a, "target_param_ref": "pressure",
            "source_regulation": b, "source_output": "verdict",
        }],
    }).json()

    r = client.get(f"/api/processes/{twin['id']}/turtle")
    assert r.status_code == 200
    text = r.text

    # 1. Twin-header.
    assert ":DigitalTwin" in text
    assert f":Twin_{twin['id']}" in text
    assert "Цепочка" in text
    assert ":hasMember" in text
    assert ":hasWiring" in text

    # 2. Wiring block присутствует с корректными ссылками.
    assert ":Wiring" in text
    assert ":sourceRegulation" in text
    assert ":targetRegulation" in text
    assert ":sourceOutput" in text
    assert ":targetInput" in text
    assert '"verdict"' in text
    assert '"pressure"' in text

    # 3. Per-regulation Turtle всё ещё на месте.
    assert "PotrebitelRegulation" in text or "PotrebitelRegulation".lower() in text.lower()


def test_turtle_no_wiring_block_when_empty_wiring(client):
    a = _create_reg(client, name="A")
    twin = client.post("/api/processes", json={
        "id": "", "name": "Пустой", "description": None,
        "regulation_ids": [a], "wiring": [],
    }).json()

    text = client.get(f"/api/processes/{twin['id']}/turtle").text
    assert ":DigitalTwin" in text
    # Wiring-block не должен появиться когда wiring пуст — иначе мусор в Turtle.
    assert ":Wiring " not in text  # пробел гарантирует что это класс :Wiring, не подстрока


def test_verify_turtle_passes_on_valid_twin(client):
    """`/verify-turtle` парсит Turtle двойника через rdflib без ошибок."""
    a = _create_reg(client, name="A")
    b = _create_reg(client, name="B")
    _flow_with_input(client, a, "pressure")
    twin = client.post("/api/processes", json={
        "id": "", "name": "Чистая цепочка", "description": None,
        "regulation_ids": [a, b],
        "wiring": [{
            "target_regulation": a, "target_param_ref": "pressure",
            "source_regulation": b, "source_output": None,
        }],
    }).json()

    r = client.get(f"/api/processes/{twin['id']}/verify-turtle")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["triples"] > 0
    # Должны быть видны хотя бы один DigitalTwin, одно Wiring, два регламента.
    assert data["stats"]["digital_twins"] == 1
    assert data["stats"]["wirings"] == 1
    assert data["stats"]["regulations"] == 2


def test_verify_turtle_empty_twin(client):
    """Пустой двойник тоже валиден (только Twin-блок, ничего не падает)."""
    a = _create_reg(client, name="A")
    twin = client.post("/api/processes", json={
        "id": "", "name": "Пустой", "description": None,
        "regulation_ids": [a], "wiring": [],
    }).json()
    r = client.get(f"/api/processes/{twin['id']}/verify-turtle")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["stats"]["wirings"] == 0


def test_turtle_escapes_quotes_in_name(client):
    a = _create_reg(client, name="A")
    twin = client.post("/api/processes", json={
        "id": "", "name": 'Двойник "со скобками"', "description": None,
        "regulation_ids": [a], "wiring": [],
    }).json()
    text = client.get(f"/api/processes/{twin['id']}/turtle").text
    # Кавычки должны быть экранированы как \", иначе Turtle не парсится.
    assert '\\"со скобками\\"' in text
