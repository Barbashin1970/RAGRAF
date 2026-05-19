"""Регресс: PUT /regulations/{id} с новым name — следующий GET возвращает новое.

Воспроизводим жалобу пользователя:
  «при внесении изменений в название регламента в режиме Редактирование —
  при нажатии сохранить — название возвращается к первому варианту»

Если этот тест зелёный, баг во фронте (stale state / cache). Если красный —
backend стрипит/перетирает name на save или на get.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_put_name_then_get_returns_new_name(client):
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Старое"})
    sid = r.json()["id"]

    reg = client.get(f"/api/regulations/{sid}").json()
    assert reg["name"] == "Старое"

    reg["name"] = "Новое"
    r2 = client.put(f"/api/regulations/{sid}", json=reg)
    assert r2.status_code == 200, r2.text

    reg2 = client.get(f"/api/regulations/{sid}").json()
    assert reg2["name"] == "Новое", "PUT с новым name не сохранил его"


def test_put_name_twice(client):
    """Двойной PUT — повторный save не возвращает старое имя."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "A"})
    sid = r.json()["id"]

    reg = client.get(f"/api/regulations/{sid}").json()
    reg["name"] = "B"
    client.put(f"/api/regulations/{sid}", json=reg)

    reg_after = client.get(f"/api/regulations/{sid}").json()
    assert reg_after["name"] == "B"

    reg_after["name"] = "C"
    client.put(f"/api/regulations/{sid}", json=reg_after)

    reg_final = client.get(f"/api/regulations/{sid}").json()
    assert reg_final["name"] == "C"


def test_put_then_raw_then_get(client):
    """GET /raw НЕ возвращает старый name после PUT (raw_turtle invalidation)."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "OldName"})
    sid = r.json()["id"]

    reg = client.get(f"/api/regulations/{sid}").json()
    reg["name"] = "NewName"
    client.put(f"/api/regulations/{sid}", json=reg)

    raw = client.get(f"/api/regulations/{sid}/raw").text
    assert "NewName" in raw, "GET /raw отдал не свежий name"
    assert "OldName" not in raw

    reg_after = client.get(f"/api/regulations/{sid}").json()
    assert reg_after["name"] == "NewName"
