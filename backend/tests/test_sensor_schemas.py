"""Интеграционные тесты библиотеки полей датчиков.

Покрывает CRUD-цикл + idempotent сидинг + правила валидации URL↔body.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_seed_creates_all_sensor_types(client):
    r = client.get("/api/sensor-schemas")
    assert r.status_code == 200
    data = r.json()
    types = {item["sensor_type"] for item in data}
    # Все типы из SensorType literal должны быть засеяны.
    assert types == {"p", "t", "flow", "noise", "detector", "fiber", "air"}


def test_seed_includes_known_required_fields(client):
    r = client.get("/api/sensor-schemas/p")
    fields = r.json()["fields"]
    by_name = {f["field_name"]: f for f in fields}
    assert "pressure" in by_name
    assert by_name["pressure"]["required"] is True
    assert by_name["pressure"]["unit"] == "атм"
    assert by_name["pressure"]["datatype"] == "decimal"


def test_get_unknown_type_returns_empty_group(client):
    r = client.get("/api/sensor-schemas/nonexistent")
    assert r.status_code == 200
    assert r.json() == {"sensor_type": "nonexistent", "fields": []}


def test_put_creates_new_field(client):
    payload = {
        "sensor_type": "air",
        "field_name": "humidity",
        "datatype": "decimal",
        "unit": "%RH",
        "description": "Относительная влажность",
        "required": False,
        "example_value": "55.0",
        "position": 0,
    }
    r = client.put("/api/sensor-schemas/air/humidity", json=payload)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["field_name"] == "humidity"
    assert result["unit"] == "%RH"
    # position должен быть проставлен автоматически — после последнего seed-поля.
    assert result["position"] > 0


def test_put_updates_existing_field(client):
    # Меняем описание сидового поля.
    payload = {
        "sensor_type": "p",
        "field_name": "pressure",
        "datatype": "decimal",
        "unit": "бар",  # было атм — меняем на бар
        "description": "Манометрическое давление (обновлено)",
        "required": True,
        "example_value": "5.0",
        "position": 0,
    }
    r = client.put("/api/sensor-schemas/p/pressure", json=payload)
    assert r.status_code == 200
    # Повторный GET должен видеть обновлённое значение.
    r = client.get("/api/sensor-schemas/p")
    pressure = next(f for f in r.json()["fields"] if f["field_name"] == "pressure")
    assert pressure["unit"] == "бар"
    assert "обновлено" in pressure["description"]


def test_put_url_body_mismatch_returns_400(client):
    payload = {
        "sensor_type": "t",  # не совпадает с URL
        "field_name": "humidity",
        "datatype": "decimal",
    }
    r = client.put("/api/sensor-schemas/air/humidity", json=payload)
    assert r.status_code == 400
    assert "sensor_type" in r.json()["detail"]


def test_delete_field_removes_it(client):
    # Удаляем сидовое поле — больше не возвращается в GET.
    r = client.delete("/api/sensor-schemas/fiber/event")
    assert r.status_code == 200
    r = client.get("/api/sensor-schemas/fiber")
    names = {f["field_name"] for f in r.json()["fields"]}
    assert "event" not in names


def test_delete_unknown_field_returns_404(client):
    r = client.delete("/api/sensor-schemas/p/phantom")
    assert r.status_code == 404


def test_reseed_restores_default_set(client):
    # Удалили поле и пересеяли — поле должно вернуться.
    client.delete("/api/sensor-schemas/fiber/event")
    r = client.post("/api/sensor-schemas/reseed")
    assert r.status_code == 200
    seeded = r.json()["fields_seeded"]
    assert seeded > 0
    r = client.get("/api/sensor-schemas/fiber")
    names = {f["field_name"] for f in r.json()["fields"]}
    assert "event" in names
