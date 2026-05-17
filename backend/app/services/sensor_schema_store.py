"""Registry полей payload — двух-уровневая структура (класс → подтип → поля).

Класс vs. подтип
================
**Класс** — литерал `SensorType` ('p', 't', 'flow', 'noise', 'detector',
'fiber', 'air'). Это базовое семейство, статично в коде.

**Подтип** — конкретная модель датчика внутри класса (например, под `detector`:
ANPR, person-detection, trash-bin, face-detect …; под `fiber`: DAS-vibration,
DAS-acoustic, DAS-temperature). Подтипы хранятся в `sensor_subtypes` и
пополняются из UI («Добавить подтип»).

У каждого подтипа свой набор полей в `sensor_field_schemas`. Один класс
может иметь 20+ подтипов — типично для видеодетекторов.

Таблицы
=======

  CREATE TABLE sensor_subtypes (
      subtype_id   VARCHAR PRIMARY KEY,
      class_id     VARCHAR NOT NULL,      -- один из SensorType литералов
      label        VARCHAR NOT NULL,
      description  VARCHAR,
      position     INTEGER DEFAULT 0
  )

  CREATE TABLE sensor_field_schemas (
      subtype_id     VARCHAR NOT NULL,    -- было sensor_type, ALTER'нуто
      field_name     VARCHAR NOT NULL,
      datatype       VARCHAR NOT NULL,
      unit           VARCHAR,
      description    VARCHAR,
      required       BOOLEAN,
      example_value  VARCHAR,
      position       INTEGER,
      PRIMARY KEY (subtype_id, field_name)
  )

Миграция от старой схемы (sensor_type → subtype_id) идемпотентна — выполняется
при старте, если колонка ещё называется sensor_type. Старые поля при этом
оседают под подтипом, чьё имя совпадает с классом ('p', 't', ...) — это
«generic» подтипы, которые мы засеиваем как дефолтные.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import duckdb

from app.config import settings
from app.schemas.domain import SensorField, SensorSubtype

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
    # sensor_subtypes — новая таблица.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_subtypes (
            subtype_id   VARCHAR PRIMARY KEY,
            class_id     VARCHAR NOT NULL,
            label        VARCHAR NOT NULL,
            description  VARCHAR,
            position     INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    # sensor_field_schemas — может быть в одном из двух состояний:
    #   1) Старая (sensor_type) — мигрируем RENAME COLUMN
    #   2) Новая (subtype_id)   — создаём как есть
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_field_schemas (
            subtype_id     VARCHAR NOT NULL,
            field_name     VARCHAR NOT NULL,
            datatype       VARCHAR NOT NULL DEFAULT 'decimal',
            unit           VARCHAR,
            description    VARCHAR,
            required       BOOLEAN NOT NULL DEFAULT FALSE,
            example_value  VARCHAR,
            position       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (subtype_id, field_name)
        )
        """
    )
    existing_cols = {row[1] for row in c.execute("PRAGMA table_info('sensor_field_schemas')").fetchall()}
    if "sensor_type" in existing_cols and "subtype_id" not in existing_cols:
        # Идемпотентный миграционный шаг: переименовать колонку.
        c.execute("ALTER TABLE sensor_field_schemas RENAME COLUMN sensor_type TO subtype_id")


# ── Seed: классы и их подтипы ─────────────────────────────────────────
#
# Каждая запись = (subtype_id, class_id, label, description, position).
# subtype_id == class_id для «generic» подтипа (дефолтный, мигрированный с
# старой схемы). Специфические подтипы получают свой kebab-case id.

SEED_SUBTYPES: list[tuple[str, str, str, str | None]] = [
    # ── Generic-подтипы (один на класс, чтобы старые данные приземлились) ──
    ("p",        "p",        "Манометр (общий)",         "Базовый манометр на трубопроводе"),
    ("t",        "t",        "Термопара (общий)",         "Базовый датчик температуры (TC / RTD)"),
    ("flow",     "flow",     "Расходомер (общий)",        "Электромагнитный / ультразвуковой расходомер"),
    ("noise",    "noise",    "Акустический детектор (точечный)", "Микрофон / гидрофон в точке"),
    ("detector", "detector", "CCTV-детектор (общий)",     "Стандартный видеодетектор без специализации"),
    ("fiber",    "fiber",    "DAS — акустика (общий)",    "Распределённое оптоволокно, акустический сигнал"),
    ("air",      "air",      "Качество воздуха (общий)",  "Универсальный датчик загрязнения"),

    # ── Видеодетекторы (расширенный набор; ~20 в перспективе) ──
    ("vd-person",          "detector", "Детектор человека",         "EventPerson ORM: пол, возраст, одежда, аксессуары"),
    ("vd-anpr",            "detector", "ANPR / распознавание ГРЗ",   "EventNumberPlate ORM: номер, марка, цвет, направление"),
    ("vd-trash-bin",       "detector", "Мусорный бак (fill-level)",  "IoT-объект, не детекция; mock-генератор"),
    ("vd-face",            "detector", "Распознавание лица",         "Биометрия (face ID, эмоции, маска)"),
    ("vd-vehicle-class",   "detector", "Классификация транспорта",   "Тип авто: car / truck / bus / motorcycle"),
    ("vd-fire-smoke",      "detector", "Огонь / дым",                "Раннее обнаружение возгорания"),
    ("vd-helmet",          "detector", "Каска / СИЗ-violation",      "PPE-комплаенс на стройплощадке"),
    ("vd-crowd",           "detector", "Скопление людей",            "Подсчёт плотности толпы"),
    ("vd-weapon",          "detector", "Оружие",                     "Холодное / огнестрельное в кадре"),
    ("vd-unattended-bag",  "detector", "Брошенная сумка",            "Antiterror-мониторинг в местах массового пребывания"),

    # ── DAS-подтипы (юзер упомянул: vibration / temperature / acoustic) ──
    ("fiber-vibration",  "fiber", "DAS — вибрация",                  "Виброакустический мониторинг линейных объектов"),
    ("fiber-temperature","fiber", "DTS — температура",                "Distributed Temperature Sensing — termal anomaly"),

    # ── Air — подтипы по типу загрязнителя ──
    ("air-co2",  "air", "CO2",         "Инфракрасный (NDIR) сенсор углекислого газа"),
    ("air-pm",   "air", "PM2.5 / PM10","Лазерный нефелометр взвешенных частиц"),
    ("air-no2",  "air", "NO2",         "Электрохимический датчик оксида азота"),
]


# ── Seed: поля для каждого подтипа ───────────────────────────────────
#
# Дефолтные поля «generic» подтипов взяты из текущей библиотеки
# event-data-examples/sensors/<class>/README.md. Поля специфических
# видеодетекторов и DAS-подтипов взяты из ORM-моделей
# event-data-examples/videodetectors/{person,grz}_postgresql.py и
# доменной экспертизы по DAS/PPE/face/fire.

SEED_FIELDS: dict[str, list[tuple[str, str, str | None, str, bool, Any]]] = {
    # ── Generic-подтипы: те же поля что были раньше ──
    "p": [
        ("pressure",    "decimal", "атм", "Текущее показание манометра",            True,  20.5),
        ("reference",   "decimal", "атм", "Проектное / эталонное значение",         False, 20.5),
        ("x",           "decimal", "м",   "Координата X точки замера на схеме",     False, 345.7),
        ("y",           "decimal", "м",   "Координата Y точки замера",              False, 128.2),
        ("edge_id",     "integer", None,  "ID участка трубопровода",                False, 12),
        ("temperature", "decimal", "°C",  "Совмещённое измерение температуры",      False, 92.5),
    ],
    "t": [
        ("temperature", "decimal", "°C", "Текущая температура",                     True,  65.0),
        ("reference",   "decimal", "°C", "Проектная температура",                   False, 65.0),
        ("location",    "string",  None, "supply / return / tank",                  False, "supply"),
        ("x",           "decimal", "м",  "Координата X",                            False, 120.0),
        ("y",           "decimal", "м",  "Координата Y",                            False, 64.5),
        ("edge_id",     "integer", None, "ID участка",                              False, 3),
    ],
    "flow": [
        ("flow",         "decimal", "м³/ч", "Текущий расход",                       True,  12.5),
        ("reference",    "decimal", "м³/ч", "Проектное значение",                   False, 12.0),
        ("total_volume", "decimal", "м³",   "Накопленный объём",                    False, 184523.6),
        ("direction",    "string",  None,   "forward / reverse",                    False, "forward"),
        ("x",            "decimal", "м",    "Координата X",                         False, 210.4),
        ("y",            "decimal", "м",    "Координата Y",                         False, 88.0),
        ("edge_id",      "integer", None,   "ID участка",                           False, 18),
    ],
    "noise": [
        ("event_type",   "string",  None, "noise_threshold_exceeded / vehicle_detected_by_noise",  True,  "noise_threshold_exceeded"),
        ("sensor_id",    "string",  None, "ID источника",                                          True,  "sensor_01"),
        ("threshold",    "decimal", "dB", "Норма",                                                 False, 90),
        ("current_value","decimal", "dB", "Текущий уровень",                                       False, 95),
        ("vehicle_type", "string",  None, "Тип источника по сигнатуре (train / truck / …)",        False, "train"),
        ("confidence",   "decimal", None, "Уверенность ML 0..1 для распознанного источника",       False, 0.94),
        ("ts",           "integer", "ms", "Unix-timestamp мс",                                     False, 1728961612345),
        ("pos",          "string",  None, "Координаты '<lat>N <lon>E'",                            False, "44.34532N 72.4534543E"),
    ],
    "detector": [
        # Дефолтный CCTV-детектор без специализации — общие поля.
        ("event_type",   "string",  None, "person / anpr / trash_bin / …",  True,  "person"),
        ("camera_id",    "string",  None, "ID камеры",                       True,  "Camera-3"),
        ("camera_name",  "string",  None, "Человекочитаемое имя камеры",    False, "Парковка, въезд"),
        ("track_id",     "integer", None, "Идентификатор трекинга",         False, 12345),
        ("confidence",   "decimal", None, "Уверенность детектора 0..1",     True,  0.93),
        ("bbox",         "string",  None, "x1,y1,x2,y2 в пикселях",         False, "412,256,698,521"),
        ("image_path",   "string",  None, "Путь к кадру",                    False, "/images/cam03/.../track.jpg"),
    ],
    "fiber": [
        ("event",      "string",  None, "Категория DAS-события (digging / human_step / …)",  True,  "digging"),
        ("x",          "integer", "м",  "Координата вдоль волокна, метры от нулевой точки",   True,  3946),
        ("confidence", "decimal", None, "Уверенность ML-классификатора 0..1",                 True,  0.88),
    ],
    "air": [
        ("event_type",    "string",  None,    "air_pollution / air_quality_normal / co2_threshold_exceeded", True, "air_pollution"),
        ("sensor_id",     "string",  None,    "ID источника",                                                True, "sensor_02"),
        ("pollutant",     "string",  None,    "CO2 / PM2.5 / PM10 / NO2 / CO / SO2",                         True, "CO2"),
        ("concentration", "decimal", None,    "Текущая концентрация",                                        True, 1200),
        ("threshold",     "decimal", None,    "Норма ПДК",                                                   False, 1000),
        ("unit",          "string",  None,    "ppm (CO2/CO/NO2) или µg/m³ (PM2.5/PM10)",                     True, "ppm"),
        ("ts",            "integer", "ms",    "Unix-timestamp мс",                                           False, 1728961623456),
        ("pos",           "string",  None,    "Координаты '<lat>N <lon>E'",                                  False, "44.34532N 72.4534543E"),
    ],

    # ── Видеодетектор: person (из EventPerson ORM, top-N атрибутов) ──
    "vd-person": [
        ("event_type", "string",  None, "Всегда 'person'",                            True,  "person"),
        ("camera_id",  "string",  None, "ID камеры",                                  True,  "Camera-3"),
        ("camera_name","string",  None, "Имя камеры",                                False, "Парковка"),
        ("track_id",   "integer", None, "Идентификатор трекинга через кадры",         False, 12345),
        ("confidence", "decimal", None, "Уверенность детектора объекта",              True,  0.93),
        ("bbox",       "string",  None, "x1,y1,x2,y2 в пикселях",                     False, "412,256,698,521"),
        ("image_path", "string",  None, "Путь к полному кадру",                       False, "/images/.../track.jpg"),
        # Атрибуты человека (агрегаты из 76 ORM-полей):
        ("gender",        "string",  None, "male / female (top из male/female prob)",    False, "male"),
        ("age_group",     "string",  None, "0_9 / 10_16 / 17_35 / 36_50 / 50_plus",       False, "17_35"),
        ("top_garment",   "string",  None, "jacket / coat / vest / hoodie / tshirt / …", False, "jacket"),
        ("top_color",     "string",  None, "Доминирующий цвет верхней одежды",            False, "blue"),
        ("bottom_garment","string",  None, "trousers / skirt / shorts",                   False, "trousers"),
        ("bottom_color",  "string",  None, "Доминирующий цвет нижней одежды",             False, "black"),
        ("haircut",       "string",  None, "bald / short / medium / long",                False, "short"),
        ("headwear",      "string",  None, "cap / hat / hood / baseball / none",          False, "none"),
        ("bag",           "string",  None, "backpack / shoulder / hand / none",           False, "backpack"),
        ("glasses",       "boolean", None, "Очки",                                        False, False),
        ("view",          "string",  None, "front / back / side",                         False, "front"),
        ("full_visible",  "boolean", None, "Полностью виден",                             False, True),
    ],

    # ── Видеодетектор: ANPR (из EventNumberPlate ORM) ──
    "vd-anpr": [
        ("event_type",    "string",  None, "Всегда 'anpr'",                  True,  "anpr"),
        ("camera_id",     "string",  None, "ID камеры",                       True,  "Camera-7"),
        ("camera_name",   "string",  None, "Имя камеры",                      False, "Шлагбаум"),
        ("track_id",      "integer", None, "Идентификатор трекинга",          False, 678),
        ("confidence",    "decimal", None, "Уверенность распознавания",       True,  0.95),
        ("bbox",          "string",  None, "x1,y1,x2,y2 авто в кадре",        False, "320,180,820,540"),
        ("image_path",    "string",  None, "Путь к кадру",                    False, "/images/.../anpr.jpg"),
        ("numberPlate",   "string",  None, "ГРЗ строкой",                     True,  "A123BC777"),
        ("vehicleTypeId", "integer", None, "Тип авто (внутренний ID)",        False, 1),
        ("color",         "string",  None, "Цвет авто",                       False, "red"),
        ("brand",         "string",  None, "Марка",                           False, "Toyota"),
        ("model",         "string",  None, "Модель",                          False, "Corolla"),
        ("direction",     "integer", None, "1 = въезд, -1 = выезд",           False, 1),
    ],

    # ── Видеодетектор: trash-bin (из mock-генератора) ──
    "vd-trash-bin": [
        ("event_type",   "string",  None, "Всегда 'trash_bin'",          True,  "trash_bin"),
        ("camera_id",    "string",  None, "ID камеры",                    True,  "Camera-12"),
        ("image_url",    "string",  None, "URL кадра",                    False, "/images/event.jpg"),
        ("bin_id",       "string",  None, "Инвентарный номер бака",       True,  "TB-042"),
        ("street",       "string",  None, "Адрес установки",              False, "Lenina Street"),
        ("fill_level",   "string",  None, "Заполнение, %",                True,  "95%"),
        ("lat",          "decimal", None, "Широта",                       False, 55.7612),
        ("lon",          "decimal", None, "Долгота",                      False, 37.6105),
    ],

    # ── Видеодетектор: face (биометрия) ──
    "vd-face": [
        ("event_type", "string",  None, "Всегда 'face'",                True,  "face"),
        ("camera_id",  "string",  None, "ID камеры",                    True,  "Camera-1"),
        ("track_id",   "integer", None, "Трекинг ID",                   False, 99),
        ("confidence", "decimal", None, "Уверенность детекции",          True,  0.91),
        ("bbox",       "string",  None, "Bbox лица",                    False, "200,100,280,200"),
        ("face_id",    "string",  None, "FaceID (если есть в базе)",     False, "FP-12345"),
        ("emotion",    "string",  None, "happy / sad / neutral / angry", False, "neutral"),
        ("mask",       "boolean", None, "Маска надета",                  False, False),
        ("age_group",  "string",  None, "Возрастная группа",             False, "17_35"),
        ("gender",     "string",  None, "male / female",                 False, "female"),
    ],

    # ── Видеодетектор: vehicle-class ──
    "vd-vehicle-class": [
        ("event_type",   "string",  None, "Всегда 'vehicle_class'",        True,  "vehicle_class"),
        ("camera_id",    "string",  None, "ID камеры",                      True,  "Camera-5"),
        ("track_id",     "integer", None, "Трекинг ID",                    False, 421),
        ("confidence",   "decimal", None, "Уверенность",                    True,  0.89),
        ("bbox",         "string",  None, "Bbox авто",                      False, "300,200,700,500"),
        ("vehicle_type", "string",  None, "car / truck / bus / motorcycle / bicycle", True, "truck"),
        ("speed_kph",    "decimal", "км/ч","Оценочная скорость",            False, 45),
        ("direction",    "string",  None, "north / south / east / west",   False, "north"),
    ],

    # ── Видеодетектор: fire-smoke ──
    "vd-fire-smoke": [
        ("event_type", "string",  None, "fire / smoke",                  True,  "smoke"),
        ("camera_id",  "string",  None, "ID камеры",                      True,  "Camera-8"),
        ("confidence", "decimal", None, "Уверенность модели",             True,  0.84),
        ("bbox",       "string",  None, "Очаг в кадре",                   False, "150,80,400,250"),
        ("intensity",  "decimal", None, "Интенсивность 0..1",             False, 0.6),
        ("severity",   "string",  None, "low / medium / high",            False, "medium"),
    ],

    # ── Видеодетектор: helmet (PPE compliance) ──
    "vd-helmet": [
        ("event_type",   "string",  None, "Всегда 'helmet_violation'",          True,  "helmet_violation"),
        ("camera_id",    "string",  None, "ID камеры",                           True,  "Camera-9"),
        ("track_id",     "integer", None, "Трекинг рабочего",                   False, 33),
        ("confidence",   "decimal", None, "Уверенность",                         True,  0.92),
        ("bbox",         "string",  None, "Bbox головы / тела",                 False, "100,50,250,400"),
        ("has_helmet",   "boolean", None, "Есть каска",                          True,  False),
        ("has_vest",     "boolean", None, "Есть жилет",                          False, True),
        ("zone",         "string",  None, "Зона стройплощадки",                 False, "zone-A3"),
    ],

    # ── Видеодетектор: crowd-density ──
    "vd-crowd": [
        ("event_type", "string",  None, "Всегда 'crowd_density'",         True,  "crowd_density"),
        ("camera_id",  "string",  None, "ID камеры",                       True,  "Camera-10"),
        ("count",      "integer", None, "Оценка количества людей",         True,  127),
        ("density",    "decimal", "чел/м²", "Плотность",                    False, 2.5),
        ("threshold",  "integer", None, "Порог опасной плотности",         False, 100),
        ("area_id",    "string",  None, "Зона мониторинга",                False, "stadium-sector-3"),
    ],

    # ── Видеодетектор: weapon ──
    "vd-weapon": [
        ("event_type", "string",  None, "Всегда 'weapon_detected'",       True,  "weapon_detected"),
        ("camera_id",  "string",  None, "ID камеры",                       True,  "Camera-11"),
        ("confidence", "decimal", None, "Уверенность",                     True,  0.78),
        ("bbox",       "string",  None, "Bbox оружия",                     False, "320,200,400,260"),
        ("weapon_type","string",  None, "knife / firearm / blunt",         False, "knife"),
    ],

    # ── Видеодетектор: unattended-bag ──
    "vd-unattended-bag": [
        ("event_type",     "string",  None, "Всегда 'unattended_bag'",   True,  "unattended_bag"),
        ("camera_id",      "string",  None, "ID камеры",                  True,  "Camera-13"),
        ("confidence",     "decimal", None, "Уверенность",                True,  0.81),
        ("bbox",           "string",  None, "Bbox сумки",                 False, "500,300,580,420"),
        ("dwell_seconds",  "integer", "с", "Сколько секунд без хозяина",  True,  180),
        ("threshold_sec",  "integer", "с", "Порог уведомления",           False, 60),
    ],

    # ── DAS-подтипы (вибрация и температура) ──
    "fiber-vibration": [
        ("event",      "string",  None, "vibration_event / digging / vehicle_passing / human_step", True, "digging"),
        ("x",          "integer", "м",  "Координата вдоль кабеля",                                  True, 3946),
        ("confidence", "decimal", None, "Уверенность классификатора",                                True, 0.88),
        ("amplitude",  "decimal", None, "Относительная амплитуда виброактивности",                   False, 0.65),
        ("freq_band",  "string",  None, "Частотная полоса (low / mid / high)",                       False, "mid"),
    ],
    "fiber-temperature": [
        ("event",        "string",  None, "Всегда 'temp_anomaly'",                True,  "temp_anomaly"),
        ("x",            "integer", "м",  "Координата вдоль кабеля",              True,  2150),
        ("temperature",  "decimal", "°C", "Зарегистрированная температура",        True,  82.4),
        ("reference",    "decimal", "°C", "Проектная норма для этой точки",        False, 65.0),
        ("anomaly_type", "string",  None, "hotspot / cold_spot / gradient_jump",   False, "hotspot"),
    ],

    # ── Air-подтипы ──
    "air-co2": [
        ("event_type",    "string",  None, "co2_threshold_exceeded / co2_normal",  True,  "co2_threshold_exceeded"),
        ("sensor_id",     "string",  None, "ID датчика",                            True,  "sensor_02"),
        ("concentration", "decimal", "ppm","Концентрация CO2",                       True,  1200),
        ("threshold",     "decimal", "ppm","ПДК для помещения",                      False, 1000),
        ("ts",            "integer", "ms", "Unix мс",                                False, 1728961623456),
        ("pos",           "string",  None, "Координаты",                            False, "44.34N 72.45E"),
    ],
    "air-pm": [
        ("event_type",    "string",  None,    "pm_threshold_exceeded",                True,  "pm_threshold_exceeded"),
        ("sensor_id",     "string",  None,    "ID датчика",                            True,  "sensor_07"),
        ("pollutant",     "string",  None,    "PM2.5 / PM10",                          True,  "PM2.5"),
        ("concentration", "decimal", "µg/m³", "Концентрация частиц",                   True,  78.4),
        ("threshold",     "decimal", "µg/m³", "ПДК",                                   False, 35),
        ("ts",            "integer", "ms",    "Unix мс",                               False, 1728994934000),
        ("pos",           "string",  None,    "Координаты",                           False, "44.36N 72.46E"),
    ],
    "air-no2": [
        ("event_type",    "string",  None,    "no2_threshold_exceeded",                True,  "no2_threshold_exceeded"),
        ("sensor_id",     "string",  None,    "ID датчика",                            True,  "sensor_no2_01"),
        ("concentration", "decimal", "mg/m³", "Концентрация NO2",                       True,  0.35),
        ("threshold",     "decimal", "mg/m³", "ПДК среднесуточная",                     False, 0.2),
        ("ts",            "integer", "ms",    "Unix мс",                                False, 1728994934000),
    ],
}


def init_db() -> None:
    """Lifespan-инициализация: создать таблицы + засеять если пустые."""
    with _LOCK:
        _connection()
        _seed_if_empty()


def _seed_if_empty() -> None:
    """Идемпотентный per-row сид.

    Стратегия: для каждого подтипа в SEED_SUBTYPES — INSERT если не существует.
    Для каждого подтипа в SEED_FIELDS — если у него НЕТ полей, заливаем
    дефолтный набор. Это устойчиво к двум ситуациям:
      - первый запуск: всё пусто → засеваем всё
      - миграция от старой схемы: старые class-level поля сохранены под
        generic-подтипами (subtype_id = class_id), новые специфические
        подтипы получают свои поля впервые

    Пользовательские правки НЕ перетираются: добавили поле — повторный
    старт его не тронет; удалили все поля подтипа — повторный старт
    вернёт их обратно (опционально, может быть нежелательно — но это
    explicit reset из reseed()).
    """
    c = _connection()

    # 1) Subtypes — добавляем недостающие.
    existing_subtypes = {
        r[0] for r in c.execute("SELECT subtype_id FROM sensor_subtypes").fetchall()
    }
    for position, (subtype_id, class_id, label, description) in enumerate(SEED_SUBTYPES):
        if subtype_id in existing_subtypes:
            continue
        c.execute(
            """
            INSERT INTO sensor_subtypes (subtype_id, class_id, label, description, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            [subtype_id, class_id, label, description, position],
        )

    # 2) Fields — per-subtype: если у подтипа уже есть поля, не трогаем.
    #    Если полей нет (первый сид этого подтипа) — заливаем дефолтный набор.
    for subtype_id, fields in SEED_FIELDS.items():
        existing = c.execute(
            "SELECT COUNT(*) FROM sensor_field_schemas WHERE subtype_id = ?",
            [subtype_id],
        ).fetchone()
        if existing and existing[0] > 0:
            continue
        for position, (name, datatype, unit, description, required, example) in enumerate(fields):
            c.execute(
                """
                INSERT INTO sensor_field_schemas
                  (subtype_id, field_name, datatype, unit, description, required, example_value, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    subtype_id, name, datatype, unit, description, required,
                    json.dumps(example, ensure_ascii=False) if example is not None else None,
                    position,
                ],
            )


# ── Public API: subtypes ───────────────────────────────────────────────


def list_subtypes() -> list[SensorSubtype]:
    """Все подтипы, упорядоченные (class_id, position)."""
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT subtype_id, class_id, label, description, position
            FROM sensor_subtypes
            ORDER BY class_id, position, subtype_id
            """
        ).fetchall()
    return [SensorSubtype(
        subtype_id=r[0], class_id=r[1], label=r[2], description=r[3], position=int(r[4]),
    ) for r in rows]


def get_subtype(subtype_id: str) -> SensorSubtype | None:
    with _LOCK:
        c = _connection()
        row = c.execute(
            "SELECT subtype_id, class_id, label, description, position FROM sensor_subtypes WHERE subtype_id = ?",
            [subtype_id],
        ).fetchone()
    if row is None:
        return None
    return SensorSubtype(
        subtype_id=row[0], class_id=row[1], label=row[2], description=row[3], position=int(row[4]),
    )


def upsert_subtype(sub: SensorSubtype) -> SensorSubtype:
    """Создать или обновить подтип. Position подбирается в конце класса для новых."""
    with _LOCK:
        c = _connection()
        existing = c.execute(
            "SELECT position FROM sensor_subtypes WHERE subtype_id = ?",
            [sub.subtype_id],
        ).fetchone()
        if existing is None and sub.position == 0:
            # Новая запись — подбираем позицию в конце класса.
            tail = c.execute(
                "SELECT MAX(position) FROM sensor_subtypes WHERE class_id = ?",
                [sub.class_id],
            ).fetchone()
            next_pos = (int(tail[0]) if tail and tail[0] is not None else -1) + 1
            sub = sub.model_copy(update={"position": next_pos})
        c.execute(
            """
            INSERT INTO sensor_subtypes (subtype_id, class_id, label, description, position)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (subtype_id) DO UPDATE SET
                class_id = EXCLUDED.class_id,
                label = EXCLUDED.label,
                description = EXCLUDED.description,
                position = EXCLUDED.position
            """,
            [sub.subtype_id, sub.class_id, sub.label, sub.description, sub.position],
        )
    fresh = get_subtype(sub.subtype_id)
    assert fresh is not None
    return fresh


def delete_subtype(subtype_id: str) -> bool:
    """Удалить подтип. Каскадно удаляются и его поля."""
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM sensor_subtypes WHERE subtype_id = ?", [subtype_id]
        ).fetchone() is not None
        if existed:
            c.execute("DELETE FROM sensor_field_schemas WHERE subtype_id = ?", [subtype_id])
            c.execute("DELETE FROM sensor_subtypes WHERE subtype_id = ?", [subtype_id])
    return existed


# ── Public API: fields ─────────────────────────────────────────────────


def list_fields_for_subtype(subtype_id: str) -> list[SensorField]:
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT subtype_id, field_name, datatype, unit, description, required, example_value, position
            FROM sensor_field_schemas
            WHERE subtype_id = ?
            ORDER BY position, field_name
            """,
            [subtype_id],
        ).fetchall()
    return [_row_to_field(r) for r in rows]


def list_all_fields() -> dict[str, list[SensorField]]:
    """Все поля сгруппированные по subtype_id — для GET /api/sensor-schemas."""
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT subtype_id, field_name, datatype, unit, description, required, example_value, position
            FROM sensor_field_schemas
            ORDER BY subtype_id, position, field_name
            """
        ).fetchall()
    grouped: dict[str, list[SensorField]] = {}
    for r in rows:
        grouped.setdefault(r[0], []).append(_row_to_field(r))
    return grouped


def upsert_field(field: SensorField) -> None:
    with _LOCK:
        c = _connection()
        if field.position == 0:
            already = c.execute(
                "SELECT position FROM sensor_field_schemas WHERE subtype_id = ? AND field_name = ?",
                [field.subtype_id, field.field_name],
            ).fetchone()
            if already is None:
                tail = c.execute(
                    "SELECT MAX(position) FROM sensor_field_schemas WHERE subtype_id = ?",
                    [field.subtype_id],
                ).fetchone()
                next_pos = (int(tail[0]) if tail and tail[0] is not None else -1) + 1
                field = field.model_copy(update={"position": next_pos})
        c.execute(
            """
            INSERT INTO sensor_field_schemas
              (subtype_id, field_name, datatype, unit, description, required, example_value, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (subtype_id, field_name) DO UPDATE SET
                datatype = EXCLUDED.datatype,
                unit = EXCLUDED.unit,
                description = EXCLUDED.description,
                required = EXCLUDED.required,
                example_value = EXCLUDED.example_value,
                position = EXCLUDED.position
            """,
            [
                field.subtype_id, field.field_name, field.datatype, field.unit,
                field.description, field.required, field.example_value, field.position,
            ],
        )


def delete_field(subtype_id: str, field_name: str) -> bool:
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM sensor_field_schemas WHERE subtype_id = ? AND field_name = ?",
            [subtype_id, field_name],
        ).fetchone() is not None
        if existed:
            c.execute(
                "DELETE FROM sensor_field_schemas WHERE subtype_id = ? AND field_name = ?",
                [subtype_id, field_name],
            )
    return existed


def reseed() -> dict[str, int]:
    """Сбросить и пересеять оба набора. Для тестов и кнопки 'reset' в UI."""
    with _LOCK:
        c = _connection()
        c.execute("DELETE FROM sensor_field_schemas")
        c.execute("DELETE FROM sensor_subtypes")
        _seed_if_empty()
    return {
        "subtypes_seeded": len(SEED_SUBTYPES),
        "fields_seeded": sum(len(v) for v in SEED_FIELDS.values()),
    }


def _row_to_field(r: tuple) -> SensorField:
    return SensorField(
        subtype_id=r[0],
        field_name=r[1],
        datatype=r[2],
        unit=r[3],
        description=r[4],
        required=bool(r[5]),
        example_value=r[6],
        position=int(r[7]),
    )
