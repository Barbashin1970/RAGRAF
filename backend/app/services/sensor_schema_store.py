"""Registry полей payload по типам датчиков — DuckDB-backed.

Назначение
==========
Отвязать «какие поля у датчика типа `p`/`t`/…» от кода. До этого библиотека
event-data-examples/sensors/ была документацией (Markdown + JSON-сэмплы),
а UI имел хардкодные селекты типа `pressure | flow | ...` в PropertyPanel.
Теперь поля живут в DuckDB:

  CREATE TABLE sensor_field_schemas (
      sensor_type    VARCHAR,   -- 'p' / 't' / 'flow' / ...
      field_name     VARCHAR,   -- 'pressure' / 'event' / ...
      datatype       VARCHAR,   -- 'decimal' / 'integer' / 'string' / 'boolean'
      unit           VARCHAR,
      description    VARCHAR,
      required       BOOLEAN,
      example_value  VARCHAR,   -- JSON-encoded (число / строка / null)
      position       INTEGER,
      PRIMARY KEY (sensor_type, field_name)
  )

Сидится при первом запуске из SEED_FIELDS ниже — этот словарь скопирован
из event-data-examples/sensors/<type>/README.md (таблицы «Поля payload»).
Аналитик может из UI добавлять/удалять поля поверх сидового набора.

Идемпотентность: повторный запуск приложения не перетирает правки —
сидинг идёт ТОЛЬКО когда таблица пуста.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import duckdb

from app.config import settings
from app.schemas.domain import SensorField

# Используем тот же DuckDB-файл что и regulation_store — single source of
# truth для всего приложения. Своё подключение, синхронизация через RLock.
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
        CREATE TABLE IF NOT EXISTS sensor_field_schemas (
            sensor_type    VARCHAR NOT NULL,
            field_name     VARCHAR NOT NULL,
            datatype       VARCHAR NOT NULL DEFAULT 'decimal',
            unit           VARCHAR,
            description    VARCHAR,
            required       BOOLEAN NOT NULL DEFAULT FALSE,
            example_value  VARCHAR,
            position       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (sensor_type, field_name)
        )
        """
    )


# ── Seed: реплицирует таблицы «Поля payload» из event-data-examples/sensors/<type>/README.md ──
#
# Кладём через триплеты (datatype, unit, description, required, example).
# При добавлении нового типа в SensorType literal — обновляем сид здесь.

SEED_FIELDS: dict[str, list[tuple[str, str, str | None, str, bool, Any]]] = {
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
        ("event_type",   "string",  None, "person / anpr / trash_bin",                             True,  "person"),
        ("camera_id",    "string",  None, "ID камеры (произвольная строка)",                       True,  "Camera-3"),
        ("camera_name",  "string",  None, "Человекочитаемое имя камеры",                           False, "Парковка, въезд"),
        ("track_id",     "integer", None, "Идентификатор трекинга через кадры",                    False, 12345),
        ("confidence",   "decimal", None, "Уверенность детектора объекта 0..1",                    True,  0.93),
        ("class_id",     "integer", None, "Класс из выходной модели детектора",                    False, 0),
        ("bbox",         "string",  None, "Координаты bbox x1,y1,x2,y2 в пикселях",                False, "412,256,698,521"),
        ("image_path",   "string",  None, "Путь к полному кадру на диске",                         False, "/images/cam03/.../track.jpg"),
        ("numberPlate",  "string",  None, "Номер ГРЗ (только для anpr)",                           False, "A123BC777"),
        ("brand",        "string",  None, "Марка авто (только для anpr)",                          False, "Toyota"),
        ("model",        "string",  None, "Модель (только для anpr)",                              False, "Corolla"),
        ("color",        "string",  None, "Цвет авто (только для anpr)",                           False, "red"),
        ("direction",    "integer", None, "Направление движения (только для anpr)",                False, 1),
    ],
    "fiber": [
        ("event",      "string",  None, "Категория DAS-события: digging / human_step / noise_event / vehicle_passing", True, "digging"),
        ("x",          "integer", "м",  "Координата вдоль волокна, метры от нулевой точки",         True,  3946),
        ("confidence", "decimal", None, "Уверенность ML-классификатора 0..1",                       True,  0.88),
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
}


def init_db() -> None:
    """Lifespan-инициализация: создать таблицу + засеять если пустая."""
    with _LOCK:
        _connection()
        _seed_if_empty()


def _seed_if_empty() -> None:
    c = _connection()
    row = c.execute("SELECT COUNT(*) FROM sensor_field_schemas").fetchone()
    count = int(row[0]) if row else 0
    if count > 0:
        return
    for sensor_type, fields in SEED_FIELDS.items():
        for position, (name, datatype, unit, description, required, example) in enumerate(fields):
            c.execute(
                """
                INSERT INTO sensor_field_schemas
                  (sensor_type, field_name, datatype, unit, description, required, example_value, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    sensor_type, name, datatype, unit, description, required,
                    json.dumps(example, ensure_ascii=False) if example is not None else None,
                    position,
                ],
            )


# ── Public API ─────────────────────────────────────────────────────────


def list_all() -> dict[str, list[SensorField]]:
    """Все типы и их поля, сгруппированные. Порядок полей — по `position`."""
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT sensor_type, field_name, datatype, unit, description, required, example_value, position
            FROM sensor_field_schemas
            ORDER BY sensor_type, position, field_name
            """
        ).fetchall()
    grouped: dict[str, list[SensorField]] = {}
    for r in rows:
        grouped.setdefault(r[0], []).append(_row_to_field(r))
    return grouped


def list_for_type(sensor_type: str) -> list[SensorField]:
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT sensor_type, field_name, datatype, unit, description, required, example_value, position
            FROM sensor_field_schemas
            WHERE sensor_type = ?
            ORDER BY position, field_name
            """,
            [sensor_type],
        ).fetchall()
    return [_row_to_field(r) for r in rows]


def upsert(field: SensorField) -> None:
    """Создать или обновить поле. Position автоматически = max+1 для новых."""
    with _LOCK:
        c = _connection()
        # Если новое поле и position не задан явно — кладём в конец.
        if field.position == 0:
            existing = c.execute(
                "SELECT MAX(position) FROM sensor_field_schemas WHERE sensor_type = ?",
                [field.sensor_type],
            ).fetchone()
            already = c.execute(
                "SELECT position FROM sensor_field_schemas WHERE sensor_type = ? AND field_name = ?",
                [field.sensor_type, field.field_name],
            ).fetchone()
            if already is None:
                next_pos = (int(existing[0]) if existing and existing[0] is not None else -1) + 1
                field = field.model_copy(update={"position": next_pos})
        c.execute(
            """
            INSERT INTO sensor_field_schemas
              (sensor_type, field_name, datatype, unit, description, required, example_value, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (sensor_type, field_name) DO UPDATE SET
                datatype = EXCLUDED.datatype,
                unit = EXCLUDED.unit,
                description = EXCLUDED.description,
                required = EXCLUDED.required,
                example_value = EXCLUDED.example_value,
                position = EXCLUDED.position
            """,
            [
                field.sensor_type, field.field_name, field.datatype, field.unit,
                field.description, field.required, field.example_value, field.position,
            ],
        )


def delete(sensor_type: str, field_name: str) -> bool:
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM sensor_field_schemas WHERE sensor_type = ? AND field_name = ?",
            [sensor_type, field_name],
        ).fetchone() is not None
        if existed:
            c.execute(
                "DELETE FROM sensor_field_schemas WHERE sensor_type = ? AND field_name = ?",
                [sensor_type, field_name],
            )
    return existed


def reseed() -> int:
    """Сбросить и пересеять — utility-метод для тестов и кнопки 'reset' в UI."""
    with _LOCK:
        c = _connection()
        c.execute("DELETE FROM sensor_field_schemas")
        _seed_if_empty()
    return sum(len(v) for v in SEED_FIELDS.values())


def _row_to_field(r: tuple) -> SensorField:
    return SensorField(
        sensor_type=r[0],
        field_name=r[1],
        datatype=r[2],
        unit=r[3],
        description=r[4],
        required=bool(r[5]),
        example_value=r[6],
        position=int(r[7]),
    )
