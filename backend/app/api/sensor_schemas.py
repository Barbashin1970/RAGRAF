"""REST для библиотеки подтипов датчиков и их полей.

Двух-уровневая модель:
  GET    /api/sensor-subtypes               → все подтипы, сгруппированные по классам
  POST   /api/sensor-subtypes               → создать новый подтип (например, новый видеодетектор)
  PUT    /api/sensor-subtypes/{id}          → обновить мета (label / description / position)
  DELETE /api/sensor-subtypes/{id}          → удалить подтип (каскадно — его поля)

  GET    /api/sensor-schemas                → все subtype_id → массив полей
  GET    /api/sensor-schemas/{subtype_id}   → поля одного подтипа
  PUT    /api/sensor-schemas/{subtype_id}/{field_name} → upsert поле
  DELETE /api/sensor-schemas/{subtype_id}/{field_name} → удалить

  POST   /api/sensor-schemas/reseed         → сбросить + пересеять (subtypes + fields)

UI «Библиотека датчиков» рендерит дерево: классы (root) → подтипы (children)
→ таблица полей (right panel).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import (
    SensorClassWithSubtypes,
    SensorField,
    SensorFieldsByType,
    SensorSubtype,
)
from app.services import sensor_schema_store

router = APIRouter()


# ── Subtypes ───────────────────────────────────────────────────────────


@router.get("/sensor-subtypes")
def get_subtypes() -> list[SensorClassWithSubtypes]:
    """Все подтипы, сгруппированные по класс_id — формат для tree-UI."""
    subs = sensor_schema_store.list_subtypes()
    grouped: dict[str, list[SensorSubtype]] = {}
    for s in subs:
        grouped.setdefault(s.class_id, []).append(s)
    return [
        SensorClassWithSubtypes(class_id=cls, subtypes=items)
        for cls, items in grouped.items()
    ]


@router.post("/sensor-subtypes")
def create_subtype(payload: SensorSubtype) -> SensorSubtype:
    if not payload.subtype_id.strip():
        raise HTTPException(status_code=400, detail="subtype_id обязателен")
    if not payload.class_id.strip():
        raise HTTPException(status_code=400, detail="class_id обязателен")
    existing = sensor_schema_store.get_subtype(payload.subtype_id)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Подтип '{payload.subtype_id}' уже существует — используйте PUT для обновления",
        )
    return sensor_schema_store.upsert_subtype(payload)


@router.put("/sensor-subtypes/{subtype_id}")
def update_subtype(subtype_id: str, payload: SensorSubtype) -> SensorSubtype:
    if payload.subtype_id != subtype_id:
        raise HTTPException(
            status_code=400,
            detail=f"subtype_id в теле ({payload.subtype_id}) не совпадает с URL ({subtype_id})",
        )
    return sensor_schema_store.upsert_subtype(payload)


@router.delete("/sensor-subtypes/{subtype_id}")
def remove_subtype(subtype_id: str) -> dict[str, object]:
    existed = sensor_schema_store.delete_subtype(subtype_id)
    if not existed:
        raise HTTPException(status_code=404, detail=f"Подтип '{subtype_id}' не найден")
    return {"ok": True, "subtype_id": subtype_id}


# ── Fields ─────────────────────────────────────────────────────────────


@router.get("/sensor-schemas")
def get_all_fields() -> list[SensorFieldsByType]:
    grouped = sensor_schema_store.list_all_fields()
    return [
        SensorFieldsByType(subtype_id=stype, fields=fields)
        for stype, fields in grouped.items()
    ]


@router.get("/sensor-schemas/{subtype_id}")
def get_fields_for_subtype(subtype_id: str) -> SensorFieldsByType:
    fields = sensor_schema_store.list_fields_for_subtype(subtype_id)
    return SensorFieldsByType(subtype_id=subtype_id, fields=fields)


@router.put("/sensor-schemas/{subtype_id}/{field_name}")
def put_field(subtype_id: str, field_name: str, payload: SensorField) -> SensorField:
    if payload.subtype_id != subtype_id:
        raise HTTPException(
            status_code=400,
            detail=f"subtype_id в теле ({payload.subtype_id}) не совпадает с URL ({subtype_id})",
        )
    if payload.field_name != field_name:
        raise HTTPException(
            status_code=400,
            detail=f"field_name в теле ({payload.field_name}) не совпадает с URL ({field_name})",
        )
    sensor_schema_store.upsert_field(payload)
    fresh = [
        f for f in sensor_schema_store.list_fields_for_subtype(subtype_id)
        if f.field_name == field_name
    ]
    if not fresh:
        raise HTTPException(status_code=500, detail="Поле не сохранилось")
    return fresh[0]


@router.delete("/sensor-schemas/{subtype_id}/{field_name}")
def delete_field(subtype_id: str, field_name: str) -> dict[str, object]:
    existed = sensor_schema_store.delete_field(subtype_id, field_name)
    if not existed:
        raise HTTPException(status_code=404, detail=f"Поле {subtype_id}.{field_name} не найдено")
    return {"ok": True, "subtype_id": subtype_id, "field_name": field_name}


@router.post("/sensor-schemas/reseed")
def reseed() -> dict[str, object]:
    counts = sensor_schema_store.reseed()
    return {"ok": True, **counts}
