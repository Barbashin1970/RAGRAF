"""Тесты Twin.wiring — авторитативного источника композиции регламентов.

Принцип «Двух уровней» (2026-05-19):
  • Регламент — атомарное правило.
  • Twin (Process) хранит wiring между членами в Process.wiring.
  • На save Twin'а wiring проецируется в flow.json членов (sensor с
    sourceKind='regulation' получает sourceRegulationId/sourceOutputAction).

Тесты проверяют:
  - Twin.wiring round-trip (POST/PUT/GET).
  - Проекция в flow: после save Twin'а sensor в target регламенте получает
    конкретный source.
  - Снятие wiring (удалили из Twin → sensor становится placeholder).
  - Delete Twin → wiring очищается.
  - Конфликт-детект: 2 Twin'а на один и тот же target → 409.
  - /api/regulations/{id}/in-twins — reverse-lookup.
  - Backwards compat: процессы без wiring продолжают работать.
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
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _create_twin(client, *, name: str, regulation_ids: list[str], wiring: list[dict] | None = None) -> dict:
    r = client.post("/api/processes", json={
        "id": "",
        "name": name,
        "description": None,
        "regulation_ids": regulation_ids,
        "wiring": wiring or [],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _flow_with_input(client, reg_id: str, param_ref: str) -> None:
    """Записываем во flow.json только input-ноду с paramRef — нужен для wiring target."""
    flow = {
        "rule_id": f"rule_{reg_id}",
        "regulation_id": reg_id,
        "nodes": [
            {"id": "n_in", "type": "input", "paramRef": param_ref, "label": param_ref}
        ],
        "edges": [],
    }
    r = client.put(f"/api/regulations/{reg_id}/flow", json=flow)
    assert r.status_code == 200, r.text


# ── Round-trip ────────────────────────────────────────────────────────


def test_create_twin_with_wiring_persists(client):
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")

    twin = _create_twin(client, name="Цепочка", regulation_ids=[a, b], wiring=[
        {
            "target_regulation": a,
            "target_param_ref": "pressure",
            "source_regulation": b,
            "source_output": "verdict",
        }
    ])
    assert len(twin["wiring"]) == 1

    # GET после рестарта объекта возвращает то же.
    refetched = client.get(f"/api/processes/{twin['id']}").json()
    assert refetched["wiring"] == twin["wiring"]


def test_update_twin_wiring_replaces(client):
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник_1")
    c = _create_reg(client, name="Источник_2")
    _flow_with_input(client, a, "pressure")

    twin = _create_twin(client, name="t", regulation_ids=[a, b, c], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b, "source_output": None},
    ])

    # Меняем источник на c.
    twin["wiring"] = [
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": c, "source_output": "alert"},
    ]
    r = client.put(f"/api/processes/{twin['id']}", json=twin)
    assert r.status_code == 200, r.text
    fresh = client.get(f"/api/processes/{twin['id']}").json()
    assert fresh["wiring"][0]["source_regulation"] == c
    assert fresh["wiring"][0]["source_output"] == "alert"


# ── Проекция wiring в flow.json членов ─────────────────────────────────


def test_twin_save_projects_wiring_into_target_flow(client):
    """После save Twin'а target.flow.json получает sensor с конкретным source."""
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")

    _create_twin(client, name="t", regulation_ids=[a, b], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b, "source_output": "verdict"},
    ])

    flow = client.get(f"/api/regulations/{a}/flow").json()
    sensors = [n for n in flow["nodes"] if n["type"] == "sensor"]
    regsource_sensors = [
        s for s in sensors
        if (s.get("sourceKind") or "sensor") == "regulation"
    ]
    assert len(regsource_sensors) == 1
    s = regsource_sensors[0]
    assert s["sourceRegulationId"] == b
    assert s["sourceOutputAction"] == "verdict"
    # bindsTo указывает на input с paramRef=pressure.
    input_node = next((n for n in flow["nodes"] if n["id"] == s["bindsTo"]), None)
    assert input_node is not None
    assert input_node["paramRef"] == "pressure"


def test_remove_wiring_clears_target_flow_source(client):
    """Удаление wiring-записи из Twin'а — sensor в target становится placeholder."""
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")

    twin = _create_twin(client, name="t", regulation_ids=[a, b], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b, "source_output": None},
    ])

    # Удаляем wiring — оставляем регламенты в составе.
    twin["wiring"] = []
    r = client.put(f"/api/processes/{twin['id']}", json=twin)
    assert r.status_code == 200, r.text

    flow = client.get(f"/api/regulations/{a}/flow").json()
    regsource_sensors = [
        s for s in flow["nodes"]
        if s["type"] == "sensor" and (s.get("sourceKind") or "sensor") == "regulation"
    ]
    # Сенсор остаётся, но source-поля очищены.
    assert len(regsource_sensors) == 1
    s = regsource_sensors[0]
    assert s.get("sourceRegulationId") is None
    assert s.get("sourceOutputAction") is None


def test_delete_twin_clears_wiring_from_member(client):
    """DELETE Twin'а — wiring снимается из flow.json членов."""
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")

    twin = _create_twin(client, name="t", regulation_ids=[a, b], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b, "source_output": "x"},
    ])

    r = client.delete(f"/api/processes/{twin['id']}")
    assert r.status_code == 200, r.text

    flow = client.get(f"/api/regulations/{a}/flow").json()
    regsource_sensors = [
        s for s in flow["nodes"]
        if s["type"] == "sensor" and (s.get("sourceKind") or "sensor") == "regulation"
    ]
    if regsource_sensors:
        s = regsource_sensors[0]
        assert s.get("sourceRegulationId") is None


# ── Конфликт-детект ───────────────────────────────────────────────────


def test_conflict_two_twins_same_target_param_rejected(client):
    """Два Twin'а на одну пару (target_regulation, target_param) → 409 Conflict."""
    a = _create_reg(client, name="Потребитель")
    b1 = _create_reg(client, name="Источник_1")
    b2 = _create_reg(client, name="Источник_2")
    _flow_with_input(client, a, "pressure")

    _create_twin(client, name="Twin_1", regulation_ids=[a, b1], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b1, "source_output": None},
    ])

    # Второй twin пытается wiring'ить тот же target.
    twin2 = _create_twin(client, name="Twin_2", regulation_ids=[a, b2], wiring=[])
    twin2["wiring"] = [
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b2, "source_output": None},
    ]
    r = client.put(f"/api/processes/{twin2['id']}", json=twin2)
    assert r.status_code == 409, r.text
    assert "уже подключён" in r.text or "Twin_1" in r.text


def test_no_conflict_self_update(client):
    """Twin может править свой собственный wiring без 409."""
    a = _create_reg(client, name="Потребитель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")

    twin = _create_twin(client, name="t", regulation_ids=[a, b], wiring=[
        {"target_regulation": a, "target_param_ref": "pressure",
         "source_regulation": b, "source_output": "v1"},
    ])

    # Обновляем source_output — не конфликт со своим же wiring.
    twin["wiring"][0]["source_output"] = "v2"
    r = client.put(f"/api/processes/{twin['id']}", json=twin)
    assert r.status_code == 200, r.text


# ── Reverse-lookup ────────────────────────────────────────────────────


def test_in_twins_reverse_lookup(client):
    a = _create_reg(client, name="A")
    b = _create_reg(client, name="B")
    c = _create_reg(client, name="C")

    twin1 = _create_twin(client, name="T1", regulation_ids=[a, b], wiring=[])
    twin2 = _create_twin(client, name="T2", regulation_ids=[a, c], wiring=[])

    r = client.get(f"/api/regulations/{a}/in-twins")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 2
    ids = {t["id"] for t in data["twins"]}
    assert ids == {twin1["id"], twin2["id"]}

    # c — только в T2.
    r_c = client.get(f"/api/regulations/{c}/in-twins").json()
    assert r_c["count"] == 1
    assert r_c["twins"][0]["id"] == twin2["id"]


def test_in_twins_empty_for_atomic_regulation(client):
    """Регламент не в Twin'е — count=0 (атомарный)."""
    a = _create_reg(client, name="Atomic")
    r = client.get(f"/api/regulations/{a}/in-twins").json()
    assert r["count"] == 0
    assert r["twins"] == []


# ── Backward compat ────────────────────────────────────────────────────


def test_old_twin_without_wiring_field_loads(client):
    """Twin без wiring (старый формат) — wiring=[] по умолчанию."""
    a = _create_reg(client, name="A")
    # Намеренно не передаём wiring.
    r = client.post("/api/processes", json={
        "id": "",
        "name": "Old",
        "description": None,
        "regulation_ids": [a],
    })
    assert r.status_code == 201, r.text
    assert r.json()["wiring"] == []
