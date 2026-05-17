"""Тесты словаря extraction_terms + предсказания домена.

Покрывают:
  - сидинг при первом запуске
  - чтение словаря в extract_parameters (горячая правка без рестарта)
  - predicted_domain по голосованию терминов
  - CRUD endpoints
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── Seed ───────────────────────────────────────────────────────────────


def test_seed_creates_terms_across_domains(client):
    r = client.get("/api/extraction-terms")
    assert r.status_code == 200
    terms = r.json()
    assert len(terms) > 30, f"Ожидалось >30 терминов в сиде, найдено {len(terms)}"
    domains = {t["domain"] for t in terms if t["domain"]}
    # Все 4 домена представлены.
    assert {"heating", "housing", "safety", "environment"}.issubset(domains)


def test_seed_includes_classic_terms(client):
    r = client.get("/api/extraction-terms").json()
    by_stem = {t["stem"]: t for t in r}
    assert "давлен" in by_stem
    assert by_stem["давлен"]["parameter_name"] == "pressure"
    assert by_stem["давлен"]["domain"] == "heating"
    assert "температур" in by_stem
    assert by_stem["температур"]["parameter_name"] == "temperature"


def test_seed_includes_new_sensor_terms(client):
    """Новые термины из подтипов датчиков должны быть в seed."""
    r = client.get("/api/extraction-terms").json()
    stems = {t["stem"] for t in r}
    # vd-anpr / vd-fire / vd-pedestrian / vd-driver-violation отражены:
    assert "грз" in stems or "номер" in stems
    assert "огон" in stems or "пожар" in stems
    assert "пешеход" in stems
    assert "ремен" in stems
    assert "копк" in stems  # fiber-vibration / digging


# ── Domain prediction ──────────────────────────────────────────────────


def test_extract_predicts_heating_domain(client):
    text = (
        "Регламент устанавливает: номинальный диаметр трубопровода 5.0 см. "
        "Давление в трубопроводе 20.5 атм при отклонении 1.5 атм. "
        "Температура подачи теплоносителя 70 ± 10 °C, расход 1.5 м³/ч."
    )
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    data = r.json()
    assert data["predicted_domain"] == "heating", f"got {data['predicted_domain']}, scores={data['domain_scores']}"


def test_extract_predicts_safety_domain(client):
    text = (
        "При обнаружении дыма (концентрация выше 5%) оператор обязан реагировать "
        "за 30 сек. Видеодетектор фиксирует копку на расстоянии до 50 м, "
        "распознавание ГРЗ работает с уверенностью 95%."
    )
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    data = r.json()
    assert data["predicted_domain"] in ("safety", "environment"), (
        f"got {data['predicted_domain']}, scores={data['domain_scores']}"
    )


def test_extract_predicts_environment_domain(client):
    text = (
        "При концентрации PM2.5 выше 35 мкг/м³ объявить НМУ. "
        "Скорость ветра менее 1.5 м/с — стагнация. "
        "Целевое снижение выбросов 17.5%."
    )
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    data = r.json()
    assert data["predicted_domain"] == "environment"


def test_extract_no_domain_when_no_matches(client):
    """Текст с числами, но без известных стемов → predicted_domain = None."""
    text = "Произвольный текст 1.5 кг, 100 шт."
    r = client.post("/api/sandbox/extract-parameters", json={"text": text})
    data = r.json()
    # KG не знает «кг»/«шт» — extractor может найти 0 параметров, тогда predicted=None.
    if data["count"] == 0:
        assert data["predicted_domain"] is None


def test_extract_returns_domain_scores_list(client):
    text = "Давление 20.5 атм, температура 70 °C, расход 1.5 м³/ч"
    r = client.post("/api/sandbox/extract-parameters", json={"text": text}).json()
    assert isinstance(r["domain_scores"], list)
    for s in r["domain_scores"]:
        assert "domain" in s
        assert "hits" in s
        assert "confidence" in s
        assert 0 <= s["confidence"] <= 1


# ── CRUD ───────────────────────────────────────────────────────────────


def test_put_creates_user_term(client):
    payload = {
        "stem": "пыл",
        "parameter_name": "dustConcentration",
        "domain": "environment",
        "unit_hint": "мкг/м³",
        "source": "user",
    }
    r = client.put("/api/extraction-terms/пыл", json=payload)
    assert r.status_code == 200
    result = r.json()
    assert result["parameter_name"] == "dustConcentration"
    assert result["source"] == "user"

    # Новый термин сразу применяется в extract (unit мкг/м³ — в KNOWN_UNITS).
    text = "Запылённость в зоне 250 мкг/м³"
    extract = client.post("/api/sandbox/extract-parameters", json={"text": text}).json()
    matched = [e for e in extract["extracted"] if e["suggested_name"] == "dustConcentration"]
    assert len(matched) == 1, f"Новый термин не сработал: {extract}"


def test_put_url_body_mismatch_returns_400(client):
    r = client.put(
        "/api/extraction-terms/foo",
        json={"stem": "bar", "parameter_name": "x"},
    )
    assert r.status_code == 400


def test_put_seed_becomes_user_when_edited(client):
    """Аналитик правит seed-термин → source автоматом меняется на 'user'."""
    payload = {
        "stem": "давлен",
        "parameter_name": "gaugePressure",  # переименовали
        "domain": "heating",
        "unit_hint": "бар",
        "source": "seed",  # клиент шлёт seed, но бэк форсит user
    }
    r = client.put("/api/extraction-terms/давлен", json=payload).json()
    assert r["source"] == "user"
    assert r["parameter_name"] == "gaugePressure"


def test_delete_term(client):
    r = client.delete("/api/extraction-terms/смс")
    assert r.status_code == 200
    r = client.get("/api/extraction-terms").json()
    assert "смс" not in {t["stem"] for t in r}


def test_delete_unknown_returns_404(client):
    r = client.delete("/api/extraction-terms/zzz-phantom")
    assert r.status_code == 404


def test_reseed_restores_after_delete(client):
    client.delete("/api/extraction-terms/давлен")
    r = client.post("/api/extraction-terms/reseed").json()
    assert r["terms_seeded"] > 0
    stems = {t["stem"] for t in client.get("/api/extraction-terms").json()}
    assert "давлен" in stems
