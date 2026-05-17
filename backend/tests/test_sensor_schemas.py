"""Интеграционные тесты библиотеки подтипов датчиков и их полей.

Двух-уровневая структура: класс (литерал SensorType) → подтипы → поля.
Тесты покрывают сидинг + CRUD на подтипах + CRUD на полях + валидацию URL↔body.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── Subtypes ──────────────────────────────────────────────────────────


def test_seed_creates_classes_with_subtypes(client):
    r = client.get("/api/sensor-subtypes")
    assert r.status_code == 200
    classes = r.json()
    by_class = {c["class_id"]: c for c in classes}
    # Все классы из SensorType литерала засеяны.
    assert {"p", "t", "flow", "noise", "detector", "fiber", "air"}.issubset(by_class.keys())
    # У detector — много подтипов (видеодетекторы из ORM).
    detector_subs = {s["subtype_id"] for s in by_class["detector"]["subtypes"]}
    assert "vd-anpr" in detector_subs
    assert "vd-person" in detector_subs
    assert "vd-trash-bin" in detector_subs
    # У fiber — DAS-подтипы (vibration / temperature).
    fiber_subs = {s["subtype_id"] for s in by_class["fiber"]["subtypes"]}
    assert "fiber-vibration" in fiber_subs
    assert "fiber-temperature" in fiber_subs


def test_seed_includes_generic_subtype_per_class(client):
    """Для каждого класса есть «generic» подтип с subtype_id = class_id —
    он наследует поля, что были до миграции."""
    r = client.get("/api/sensor-subtypes").json()
    by_class = {c["class_id"]: c for c in r}
    for cls in ("p", "t", "flow", "noise", "detector", "fiber", "air"):
        ids = {s["subtype_id"] for s in by_class[cls]["subtypes"]}
        assert cls in ids, f"Generic-подтип '{cls}' отсутствует в классе '{cls}'"


def test_create_subtype_works(client):
    payload = {
        "subtype_id": "vd-helmet-strict",
        "class_id": "detector",
        "label": "PPE: каска + жилет + ботинки",
        "description": "Полная проверка СИЗ на стройке",
        "position": 0,
    }
    r = client.post("/api/sensor-subtypes", json=payload)
    assert r.status_code == 200
    result = r.json()
    assert result["subtype_id"] == "vd-helmet-strict"
    assert result["position"] > 0  # положен в конец класса


def test_create_duplicate_subtype_returns_409(client):
    payload = {
        "subtype_id": "vd-anpr",  # уже существует из seed
        "class_id": "detector",
        "label": "Дубль",
    }
    r = client.post("/api/sensor-subtypes", json=payload)
    assert r.status_code == 409


def test_delete_subtype_removes_fields_too(client):
    # У vd-anpr из seed есть несколько полей.
    r = client.get("/api/sensor-schemas/vd-anpr")
    assert len(r.json()["fields"]) > 0
    # Удаляем подтип — поля должны исчезнуть тоже.
    r = client.delete("/api/sensor-subtypes/vd-anpr")
    assert r.status_code == 200
    r = client.get("/api/sensor-schemas/vd-anpr")
    assert r.json()["fields"] == []


# ── Fields ────────────────────────────────────────────────────────────


def test_seed_anpr_subtype_includes_orm_fields(client):
    """vd-anpr поля строго по ORM EventNumberPlate (videodetectors/grz_postgresql.py).
    ORM — источник правды; PDF — второстепенный (может содержать старое наименование)."""
    r = client.get("/api/sensor-schemas/vd-anpr").json()
    field_names = {f["field_name"] for f in r["fields"]}
    # ORM-поля (snake_case + ANPR-specific именно как в ORM Mapped)
    for required_field in (
        "event_type", "camera_id", "camera_name", "timestamp",
        "image_path", "box_image_path", "confidence", "class_id", "track_id", "bbox",
        "numberPlate", "vehicleTypeId", "color", "brand", "model", "direction",
    ):
        assert required_field in field_names, f"Поле {required_field} из ORM не засеяно"


def test_seed_person_subtype_includes_orm_fields(client):
    """vd-person — общая обвязка из ORM EventPerson + 9 агрегированных атрибутов."""
    r = client.get("/api/sensor-schemas/vd-person").json()
    field_names = {f["field_name"] for f in r["fields"]}
    # ORM-обвязка (snake_case как в EventPerson Mapped):
    for orm_field in (
        "event_type", "camera_id", "camera_name", "timestamp",
        "image_path", "image_base64", "box_image_path",
        "confidence", "class_id", "track_id", "bbox",
    ):
        assert orm_field in field_names, f"ORM-поле {orm_field} не засеяно"
    # 9 агрегированных атрибутов (вывод классификатора, описан в PDF):
    for attr in ("gender", "age", "headwear", "top_color", "bottom_color",
                 "top_type", "bottom_type", "handbag", "backpack"):
        assert attr in field_names, f"Атрибут {attr} не засеян"


def test_pdf_netris_detectors_seeded(client):
    """Все 10 детекторов из PDF #13 Нетрис присутствуют."""
    r = client.get("/api/sensor-subtypes").json()
    detector_subs = {s["subtype_id"] for c in r if c["class_id"] == "detector" for s in c["subtypes"]}
    netris = {
        "vd-face", "vd-person", "vd-fall", "vd-anpr", "vd-smoke",
        "vd-fire", "vd-weapon", "vd-motion", "vd-boost", "vd-aggressive",
    }
    assert netris.issubset(detector_subs), f"Missing Нетрис: {netris - detector_subs}"


def test_pdf_voicelink_detectors_seeded(client):
    """Все 6 детекторов из PDF #14 Войслинк присутствуют."""
    r = client.get("/api/sensor-subtypes").json()
    detector_subs = {s["subtype_id"] for c in r if c["class_id"] == "detector" for s in c["subtypes"]}
    voicelink = {
        "vd-vehicle-brand", "vd-accident", "vd-stop-in-lane",
        "vd-dropped-cargo", "vd-pedestrian", "vd-driver-violation",
    }
    assert voicelink.issubset(detector_subs), f"Missing Войслинк: {voicelink - detector_subs}"


def test_voicelink_accident_fields(client):
    """vd-accident — Войслинк event-style payload (event + IDs)."""
    r = client.get("/api/sensor-schemas/vd-accident").json()
    names = {f["field_name"] for f in r["fields"]}
    for f in ("event", "vehicle1_id", "vehicle2_id", "accuracy", "timestamp"):
        assert f in names, f"Поле {f} из PDF #14 сценарий 2 не засеяно"


def test_subtype_has_description(client):
    """Каждый seeded подтип имеет осмысленное description (info-поле)."""
    r = client.get("/api/sensor-subtypes").json()
    for c in r:
        for s in c["subtypes"]:
            assert s.get("description"), f"У подтипа {s['subtype_id']} пустое description"


def test_put_field_under_specific_subtype(client):
    payload = {
        "subtype_id": "vd-anpr",
        "field_name": "country_code",
        "datatype": "string",
        "unit": None,
        "description": "ISO-код страны выдачи номера",
        "required": False,
        "example_value": "\"RU\"",
        "position": 0,
    }
    r = client.put("/api/sensor-schemas/vd-anpr/country_code", json=payload)
    assert r.status_code == 200, r.text


def test_get_unknown_subtype_returns_empty_group(client):
    r = client.get("/api/sensor-schemas/nonexistent-subtype")
    assert r.status_code == 200
    assert r.json() == {"subtype_id": "nonexistent-subtype", "fields": []}


def test_put_url_body_mismatch_returns_400(client):
    payload = {
        "subtype_id": "vd-person",
        "field_name": "foo",
        "datatype": "decimal",
    }
    r = client.put("/api/sensor-schemas/vd-anpr/foo", json=payload)
    assert r.status_code == 400


def test_delete_unknown_field_returns_404(client):
    r = client.delete("/api/sensor-schemas/vd-anpr/phantom")
    assert r.status_code == 404


def test_reseed_restores_subtypes_and_fields(client):
    # Удаляем подтип, потом reseed возвращает.
    client.delete("/api/sensor-subtypes/fiber-vibration")
    r = client.post("/api/sensor-schemas/reseed")
    assert r.status_code == 200
    payload = r.json()
    assert payload["subtypes_seeded"] > 0
    assert payload["fields_seeded"] > 0
    r = client.get("/api/sensor-subtypes").json()
    fiber_subs = {s["subtype_id"] for c in r if c["class_id"] == "fiber" for s in c["subtypes"]}
    assert "fiber-vibration" in fiber_subs


def test_list_all_fields_groups_by_subtype(client):
    r = client.get("/api/sensor-schemas").json()
    by_subtype = {g["subtype_id"]: g["fields"] for g in r}
    # И generic-подтипы, и специфические — все должны быть.
    assert "p" in by_subtype          # generic
    assert "vd-anpr" in by_subtype    # специфический
    assert "fiber-vibration" in by_subtype  # DAS специфический
