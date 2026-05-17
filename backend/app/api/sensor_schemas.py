"""REST для библиотеки полей датчиков — CRUD над sensor_field_schemas.

Юзкейсы UI:
  GET    /api/sensor-schemas               → все типы + их поля
  GET    /api/sensor-schemas/{type}        → поля одного типа
  PUT    /api/sensor-schemas/{type}/{field} → создать/обновить поле
  DELETE /api/sensor-schemas/{type}/{field} → удалить поле
  POST   /api/sensor-schemas/reseed         → сбросить и пересеять из SEED_FIELDS

UI «Библиотека датчиков» — это master-details: список типов слева, таблица
полей справа, инлайн-форма добавления внизу.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import SensorField, SensorFieldsByType
from app.services import sensor_schema_store

router = APIRouter()


@router.get("/sensor-schemas")
def get_all() -> list[SensorFieldsByType]:
    """Все типы датчиков + их поля. Структура: массив групп."""
    grouped = sensor_schema_store.list_all()
    return [
        SensorFieldsByType(sensor_type=stype, fields=fields)
        for stype, fields in grouped.items()
    ]


@router.get("/sensor-schemas/{sensor_type}")
def get_for_type(sensor_type: str) -> SensorFieldsByType:
    fields = sensor_schema_store.list_for_type(sensor_type)
    return SensorFieldsByType(sensor_type=sensor_type, fields=fields)


@router.put("/sensor-schemas/{sensor_type}/{field_name}")
def put_field(sensor_type: str, field_name: str, payload: SensorField) -> SensorField:
    """Upsert одного поля. URL — source of truth для (sensor_type, field_name);
    тело может содержать те же поля, но если есть расхождение — 400."""
    if payload.sensor_type != sensor_type:
        raise HTTPException(
            status_code=400,
            detail=f"sensor_type в теле ({payload.sensor_type}) не совпадает с URL ({sensor_type})",
        )
    if payload.field_name != field_name:
        raise HTTPException(
            status_code=400,
            detail=f"field_name в теле ({payload.field_name}) не совпадает с URL ({field_name})",
        )
    sensor_schema_store.upsert(payload)
    # Перечитать чтобы вернуть с актуальным `position` (для нового поля он
    # рассчитывается в store).
    fresh = [
        f for f in sensor_schema_store.list_for_type(sensor_type)
        if f.field_name == field_name
    ]
    if not fresh:
        raise HTTPException(status_code=500, detail="Поле не сохранилось")
    return fresh[0]


@router.delete("/sensor-schemas/{sensor_type}/{field_name}")
def delete_field(sensor_type: str, field_name: str) -> dict[str, object]:
    existed = sensor_schema_store.delete(sensor_type, field_name)
    if not existed:
        raise HTTPException(
            status_code=404,
            detail=f"Поле {sensor_type}.{field_name} не найдено",
        )
    return {"ok": True, "sensor_type": sensor_type, "field_name": field_name}


@router.post("/sensor-schemas/reseed")
def reseed() -> dict[str, object]:
    """Сброс к дефолтному набору полей. Все пользовательские правки теряются —
    используется при «обнулить библиотеку» из UI."""
    count = sensor_schema_store.reseed()
    return {"ok": True, "fields_seeded": count}
