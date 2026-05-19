"""Тесты POST /api/regulations/{id}/duplicate — копия рядом с оригиналом.

Регресс-история: в первой версии endpoint писал в `model_copy(update=...)`
ключ `"source_id"`, которого в `Regulation` нет (поле называется `id`).
Pydantic тихо игнорил неизвестный ключ → копия сохранялась с id оригинала
→ `regulation_store.save()` перезаписывал оригинал её содержимым. Аналитик
видел только «(копия)», оригинал исчезал.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_duplicate_creates_separate_regulation(client):
    """Главный кейс: после дублирования и оригинал, и копия видны в /api/datasets."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Оригинал"})
    assert r.status_code == 201
    orig_id = r.json()["id"]
    orig_name = r.json()["name"]

    r2 = client.post(f"/api/regulations/{orig_id}/duplicate", json={})
    assert r2.status_code == 201, r2.text
    copy = r2.json()
    copy_id = copy["id"]

    # У копии — другой id и другое имя
    assert copy_id != orig_id
    assert copy["name"] == f"{orig_name} (копия)"
    assert copy["status"] == "draft"
    assert copy["version"] == "1.0"

    # Оригинал жив и не затёрт
    r_orig = client.get(f"/api/regulations/{orig_id}")
    assert r_orig.status_code == 200
    assert r_orig.json()["name"] == orig_name
    assert r_orig.json()["id"] == orig_id

    # Копия достаётся отдельно
    r_copy = client.get(f"/api/regulations/{copy_id}")
    assert r_copy.status_code == 200
    assert r_copy.json()["name"] == f"{orig_name} (копия)"

    # Оба видны в листинге
    datasets = client.get("/api/datasets").json()
    ids = {item["id"] for item in datasets if isinstance(item, dict)}
    assert orig_id in ids, f"оригинал исчез из /api/datasets: {ids}"
    assert copy_id in ids, f"копия не появилась в /api/datasets: {ids}"


def test_duplicate_copies_parameters_deeply(client):
    """Изменение параметров копии не задевает оригинал (deep=True)."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Базовый"})
    orig_id = r.json()["id"]
    orig_params = r.json()["parameters"]
    assert len(orig_params) >= 1

    r2 = client.post(f"/api/regulations/{orig_id}/duplicate", json={})
    copy = r2.json()
    copy_id = copy["id"]

    # Копия унаследовала параметры
    assert len(copy["parameters"]) == len(orig_params)

    # Меняем параметр копии — оригинал не должен затронуться
    copy["parameters"][0]["referenceValue"] = 999.0
    r_put = client.put(f"/api/regulations/{copy_id}", json=copy)
    assert r_put.status_code == 200

    orig_after = client.get(f"/api/regulations/{orig_id}").json()
    assert orig_after["parameters"][0]["referenceValue"] != 999.0


def test_duplicate_with_explicit_name(client):
    """Параметр `name` в теле — переопределяет дефолтный '(копия)' суффикс."""
    r = client.post("/api/regulations", json={"domain": "safety", "name": "Инцидент"})
    orig_id = r.json()["id"]

    r2 = client.post(
        f"/api/regulations/{orig_id}/duplicate",
        json={"name": "Инцидент v2"},
    )
    assert r2.status_code == 201
    assert r2.json()["name"] == "Инцидент v2"
    # id всё равно отличается от оригинала
    assert r2.json()["id"] != orig_id


def test_duplicate_with_explicit_source_id(client):
    """Параметр `source_id` в теле — берёт переданный slug (если свободен)."""
    r = client.post("/api/regulations", json={"domain": "safety", "name": "Источник"})
    orig_id = r.json()["id"]

    r2 = client.post(
        f"/api/regulations/{orig_id}/duplicate",
        json={"source_id": "my-explicit-copy"},
    )
    assert r2.status_code == 201
    assert r2.json()["id"] == "my-explicit-copy"


def test_duplicate_copies_flow(client):
    """Flow копируется — у новой регламента такие же ноды, как у источника."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "С потоком"})
    orig_id = r.json()["id"]
    orig_flow = client.get(f"/api/regulations/{orig_id}/flow").json()
    assert len(orig_flow["nodes"]) > 0

    r2 = client.post(f"/api/regulations/{orig_id}/duplicate", json={})
    copy_id = r2.json()["id"]

    copy_flow = client.get(f"/api/regulations/{copy_id}/flow").json()
    assert len(copy_flow["nodes"]) == len(orig_flow["nodes"])


def test_duplicate_status_resets_to_draft(client):
    """Даже если оригинал active, копия стартует draft (требует пере-подтверждения)."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Активный"})
    orig_id = r.json()["id"]
    client.post(f"/api/regulations/{orig_id}/publish")
    orig_after_publish = client.get(f"/api/regulations/{orig_id}").json()
    assert orig_after_publish["status"] == "active"

    r2 = client.post(f"/api/regulations/{orig_id}/duplicate", json={})
    assert r2.json()["status"] == "draft"


def test_duplicate_does_not_overwrite_original_history(client):
    """История оригинала не загрязняется записями из копии."""
    r = client.post("/api/regulations", json={"domain": "heating", "name": "С историей"})
    orig_id = r.json()["id"]
    hist_before = client.get(f"/api/regulations/{orig_id}/regulation-history").json()

    r2 = client.post(f"/api/regulations/{orig_id}/duplicate", json={})
    copy_id = r2.json()["id"]

    hist_after = client.get(f"/api/regulations/{orig_id}/regulation-history").json()
    assert len(hist_after) == len(hist_before), "история оригинала затронута дублированием"

    hist_copy = client.get(f"/api/regulations/{copy_id}/regulation-history").json()
    assert len(hist_copy) == 1
    assert "копир" in hist_copy[0]["comment"].lower() or orig_id in hist_copy[0]["comment"]


def test_duplicate_unknown_regulation_does_not_clobber(client):
    """Несуществующий id не должен трогать другие регламенты.

    Note: fallback на upstream/fixture в get_data() возвращает "" вместо 404,
    что создаёт stub-копию (отдельный мелкий баг). Здесь проверяем главное —
    что эта ситуация не повредила другие регламенты.
    """
    r = client.post("/api/regulations", json={"domain": "heating", "name": "Невредимый"})
    safe_id = r.json()["id"]

    client.post("/api/regulations/no-such-regulation/duplicate", json={})

    # Невредимый регламент остался цел
    r2 = client.get(f"/api/regulations/{safe_id}")
    assert r2.status_code == 200
    assert r2.json()["name"] == "Невредимый"
