"""Безопасное удаление регламента: confirm-flag, чистка истории, fixture-warning."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── Confirm-flag protection ───────────────────────────────────────────


def test_delete_without_confirm_rejected(client):
    """DELETE без `?confirm=true` должен возвращать 400, не трогая данные."""
    # Создаём что-нибудь чтобы было что не удалять
    client.post("/api/regulations", json={"domain": "heating", "name": "Тест"})
    listing_before = client.get("/api/datasets").json()

    r = client.delete("/api/regulations/test")
    assert r.status_code == 400
    assert "подтверждения" in r.json()["detail"].lower()

    listing_after = client.get("/api/datasets").json()
    # Ничего не должно было удалиться
    assert len(listing_before) == len(listing_after)


def test_delete_with_confirm_removes(client):
    create_r = client.post("/api/regulations", json={"domain": "heating", "name": "К удалению"})
    rid = create_r.json()["id"]

    # Перед удалением — есть в листинге.
    ids_before = {r["id"] for r in client.get("/api/datasets").json()}
    assert rid in ids_before

    r = client.delete(f"/api/regulations/{rid}?confirm=true")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["regulation_id"] == rid
    assert body["deleted_from_store"] is True

    # После удаления — исчезает из листинга /api/datasets.
    ids_after = {r["id"] for r in client.get("/api/datasets").json()}
    assert rid not in ids_after


def test_delete_404_for_unknown(client):
    r = client.delete("/api/regulations/no-such-regulation?confirm=true")
    assert r.status_code == 404


# ── Сброс истории при удалении ────────────────────────────────────────


def test_delete_removes_history(client):
    create_r = client.post("/api/regulations", json={"domain": "heating", "name": "С историей"})
    rid = create_r.json()["id"]
    # Делаем ещё пару правок чтобы накопить историю
    reg = client.get(f"/api/regulations/{rid}").json()
    for new_name in ["v2", "v3"]:
        reg["name"] = new_name
        client.put(f"/api/regulations/{rid}", json=reg)

    hist = client.get(f"/api/regulations/{rid}/regulation-history").json()
    assert len(hist) >= 3

    # Удаляем
    client.delete(f"/api/regulations/{rid}?confirm=true")

    # Создаём заново с тем же slug — старая история не должна «всплыть».
    # Используем тот же name → тот же slug. POST сам добавит uuid-суффикс
    # если slug занят; после удаления он свободен → slug чистый.
    new_r = client.post("/api/regulations", json={"domain": "heating", "name": "С историей"})
    new_id = new_r.json()["id"]
    assert new_id == rid  # slug свободен, без суффикса
    new_hist = client.get(f"/api/regulations/{new_id}/regulation-history").json()
    assert len(new_hist) == 1  # ровно одна запись — от свежего create


# ── Чистка flow-файлов ────────────────────────────────────────────────


def test_delete_removes_flow_files(client):
    """После DELETE — стартовый flow и папка версий регламента удалены."""
    # Используем приватный путь самого flow_storage, чтобы не гадать про cached settings.
    from app.services.flow_storage import _data_root, _flow_path

    create_r = client.post("/api/regulations", json={"domain": "heating", "name": "С flow"})
    rid = create_r.json()["id"]

    flow_path = _flow_path(rid)
    versions_dir = _data_root() / "versions" / rid

    # Стартовый flow создаётся при POST /regulations через templates._simple_flow.
    assert flow_path.exists(), f"flow не создался по пути {flow_path}"

    client.delete(f"/api/regulations/{rid}?confirm=true")

    assert not flow_path.exists()
    assert not versions_dir.exists()


# ── Fixture-warning ──────────────────────────────────────────────────


def test_delete_fixture_returns_note(client):
    """Удаление регламента из фикстуры должно вернуть предупреждение."""
    # pressure-diameter — один из фикстурных
    r = client.delete("/api/regulations/pressure-diameter?confirm=true")
    assert r.status_code == 200
    body = r.json()
    assert body["fixture_backed"] is True
    assert body["note"] is not None
    assert "seed" in body["note"].lower() or "фикстур" in body["note"].lower()
