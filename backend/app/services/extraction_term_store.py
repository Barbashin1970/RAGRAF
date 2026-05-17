"""DuckDB-хранилище словаря rules-based извлечения параметров.

Раньше словарь `CONTEXT_NAMES` жил хардкодом в `sandbox.py`. Теперь:
  - стартовый набор (35+ терминов) сидится в таблицу `extraction_terms`
  - аналитик из UI добавляет нераспознанные слова → DB растёт
  - каждый термин имеет опциональный `domain` тэг (heating / housing /
    safety / environment) — используется для предсказания домена по тексту

Алгоритм предсказания домена (см. `extract_parameters` в sandbox.py):
  1. Извлекаем числовые параметры
  2. Для каждого матча запоминаем `domain` сматчившегося термина
  3. Считаем гистограмму по доменам → `predicted_domain = argmax`
  4. confidence = top_count / total_hits

«Дообучение» движка = вставка строк в эту таблицу через UI.
"""
from __future__ import annotations

import threading
from pathlib import Path

import duckdb

from app.config import settings
from app.schemas.domain import ExtractionTerm

_LOCK = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None


def _db_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "regulations.duckdb"


def _connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        _conn = duckdb.connect(str(_db_path()))
        _init_schema(_conn)
    return _conn


def _init_schema(c: duckdb.DuckDBPyConnection) -> None:
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS extraction_terms (
            stem            VARCHAR PRIMARY KEY,
            parameter_name  VARCHAR NOT NULL,
            domain          VARCHAR,         -- NULL = cross-domain
            unit_hint       VARCHAR,
            source          VARCHAR NOT NULL DEFAULT 'seed',
            created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


# ── Seed: исходный CONTEXT_NAMES + расширения по доменам/датчикам ────────
#
# Структура: (stem, parameter_name, domain, unit_hint).
# domain=None → термин полезен в нескольких доменах (например «время», «реакц»).
# Поиск по стему — substring, регистро-нечувствительный, по левому контексту
# 80 символов перед числом. Длинные стемы выигрывают по близости (rfind).

SEED_TERMS: list[tuple[str, str, str | None, str | None]] = [
    # ── Heating: трубопроводы / теплоноситель ──
    # Внимание: НЕ добавляем «трубопровод», «котельн», «подача», «обратк»,
    # «теплоносител» как самостоятельные параметры — это места/направления,
    # а реальная измеряемая величина = pressure / temperature / flowRate.
    # При совместном употреблении («диаметр трубопровода 5 см») они дают
    # ложный матч ближе к числу. Маркеры мест держим в domain-голосовании
    # отдельно — пока не реализовано (см. BACKLOG).
    ("температур",        "temperature",          "heating",     "°C"),
    ("давлен",            "pressure",             "heating",     "атм"),
    ("диаметр",           "diameter",             "heating",     "мм"),
    ("расход",            "flowRate",             "heating",     "м³/ч"),
    ("поток",             "flowRate",             "heating",     "м³/ч"),
    ("насос",             "pumpFlow",             "heating",     "м³/ч"),
    ("задвижк",           "valvePosition",        "heating",     "%"),

    # ── Housing: ТСЖ / дома / общежития ──
    ("снег",              "snowDepth",            "housing",     "см"),
    ("сосульк",           "iceLength",            "housing",     "см"),
    ("влага",             "waterLeakLevel",       "housing",     "%"),
    ("проте",             "waterLeakLevel",       "housing",     None),
    ("утечк",             "leakDuration",         "housing",     "мин"),
    ("общежит",           "buildingOccupancy",    "housing",     None),
    ("комендант",         "responseTime",         "housing",     "мин"),
    ("стояк",             "valveResponseTime",    "housing",     "сек"),
    ("эвакуац",           "evacuationTime",       "housing",     "мин"),
    ("кровл",             "snowDepth",            "housing",     "см"),
    ("придомов",          "buildingRadius",       "housing",     "м"),

    # ── Safety: серверные / охрана / видеодетекторы ──
    ("серверн",           "serverTemperature",    "safety",      "°C"),
    ("задымлен",          "smokeConcentration",   "safety",      "%"),
    ("дым",               "smokeConcentration",   "safety",      "%"),
    ("огон",              "fireIntensity",        "safety",      None),
    ("пожар",             "fireIntensity",        "safety",      None),
    ("оруж",              "weaponConfidence",     "safety",      None),
    ("оператор",          "operatorResponseTime", "safety",      "сек"),
    ("эскалац",           "escalationTime",       "safety",      "сек"),
    ("ремен",             "seatbeltCompliance",   "safety",      "%"),
    ("каск",              "helmetCompliance",     "safety",      "%"),
    ("копк",              "diggingThreshold",     "safety",      "м"),
    ("шум",               "noiseLevel",           "safety",      "dB"),
    ("грз",               "anprConfidence",       "safety",      None),
    ("номер",             "anprConfidence",       "safety",      None),
    ("ловит",             "detectionConfidence",  "safety",      None),
    ("распознаван",       "recognitionConfidence","safety",      None),
    ("вход",              "parkingEntryRate",     "safety",      None),
    ("выезд",             "parkingExitRate",      "safety",      None),
    ("парковк",           "maxParkingHours",      "safety",      "ч"),
    ("шлагбаум",          "operatorFallbackTimeoutSec", "safety", "сек"),
    ("толп",              "crowdDensity",         "safety",      "чел/м²"),
    ("пешеход",           "pedestrianConfidence", "safety",      None),
    ("ДТП",               "accidentConfidence",   "safety",      None),
    ("столкновени",       "accidentConfidence",   "safety",      None),

    # ── Environment: качество воздуха, НМУ, шум ──
    ("ветер",             "windSpeed",            "environment", "м/с"),
    ("скорости ветра",    "windSpeed",            "environment", "м/с"),
    ("pm2.5",             "pm25Concentration",    "environment", "мкг/м³"),
    ("pm25",              "pm25Concentration",    "environment", "мкг/м³"),
    ("pm10",              "pm10Concentration",    "environment", "мкг/м³"),
    ("пдк",               "pdkExceedanceHours",   "environment", "ч/сутки"),
    ("ноль",              "no2Concentration",     "environment", "мг/м³"),
    ("co2",               "co2Concentration",     "environment", "ppm"),
    ("со2",               "co2Concentration",     "environment", "ppm"),
    ("углекислого",       "co2Concentration",     "environment", "ppm"),
    ("азот",              "no2Concentration",     "environment", "мг/м³"),
    ("загрязн",           "pollutantConcentration","environment","мкг/м³"),
    ("выброс",            "emissionReductionPercent","environment","%"),
    ("концентрац",        "pollutantConcentration","environment","мкг/м³"),
    ("вентиляц",          "ventilationRate",      "environment", "м³/ч"),
    ("влажност",          "humidity",             "environment", "%"),

    # ── Cross-domain / общие ──
    ("время",             "responseTime",         None,          "мин"),
    ("реакц",             "responseTime",         None,          "сек"),
    ("приоритет",         "priority",             None,          None),
    ("уведомлен",         "notificationLeadTime", None,          "ч"),
    ("оповещен",          "alertLeadTime",        None,          "ч"),
    ("оповещ",            "alertLeadTime",        None,          "ч"),
    ("смс",               "smsLeadTime",          None,          "ч"),
    ("sms",               "smsLeadTime",          None,          "ч"),
    ("упрежда",           "advanceLeadTime",      None,          "ч"),
    ("до прогноз",        "forecastLeadTime",     None,          "ч"),
    ("до пика",           "peakLoadLeadTime",     None,          "ч"),
    ("пик нагрузк",       "peakLoadLeadTime",     None,          "ч"),
    ("очист",             "cleaningInterval",     None,          "ч"),
    ("уборк",             "cleaningInterval",     None,          "ч"),
    ("опорожн",           "drainInterval",        None,          "ч"),
    ("штабел",            "stockpileTemperature", None,          "°C"),
    ("повтор",            "repeatCount",          None,          None),
    ("не менее одного раза", "minRepeatCount",    None,          None),
]


def init_db() -> None:
    """Lifespan-инициализация: создать таблицу + засеять если пустая."""
    with _LOCK:
        _connection()
        _seed_if_empty()


def _seed_if_empty() -> None:
    c = _connection()
    row = c.execute("SELECT COUNT(*) FROM extraction_terms").fetchone()
    if row and int(row[0]) > 0:
        return
    for stem, param, domain, unit in SEED_TERMS:
        c.execute(
            """
            INSERT INTO extraction_terms (stem, parameter_name, domain, unit_hint, source)
            VALUES (?, ?, ?, ?, 'seed')
            """,
            [stem, param, domain, unit],
        )


# ── Public API ─────────────────────────────────────────────────────────


def list_all() -> list[ExtractionTerm]:
    with _LOCK:
        c = _connection()
        rows = c.execute(
            "SELECT stem, parameter_name, domain, unit_hint, source FROM extraction_terms ORDER BY stem"
        ).fetchall()
    return [
        ExtractionTerm(stem=r[0], parameter_name=r[1], domain=r[2], unit_hint=r[3], source=r[4])
        for r in rows
    ]


def get_dict() -> dict[str, ExtractionTerm]:
    """stem → ExtractionTerm. Используется extract_parameters горячо."""
    return {t.stem: t for t in list_all()}


def upsert(term: ExtractionTerm) -> ExtractionTerm:
    """Создать или обновить термин. Source форсим в 'user' если был seed
    и аналитик правит — это даёт UI отличить кастомные правки."""
    with _LOCK:
        c = _connection()
        c.execute(
            """
            INSERT INTO extraction_terms (stem, parameter_name, domain, unit_hint, source)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (stem) DO UPDATE SET
                parameter_name = EXCLUDED.parameter_name,
                domain         = EXCLUDED.domain,
                unit_hint      = EXCLUDED.unit_hint,
                source         = EXCLUDED.source
            """,
            [term.stem, term.parameter_name, term.domain, term.unit_hint, term.source],
        )
    return term


def delete(stem: str) -> bool:
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM extraction_terms WHERE stem = ?", [stem]
        ).fetchone() is not None
        if existed:
            c.execute("DELETE FROM extraction_terms WHERE stem = ?", [stem])
    return existed


def reseed() -> int:
    """Сбросить все правки и пересеять — для UI-кнопки 'reset'."""
    with _LOCK:
        c = _connection()
        c.execute("DELETE FROM extraction_terms")
        _seed_if_empty()
    return len(SEED_TERMS)
