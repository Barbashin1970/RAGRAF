"""REST API для паспортов прикладных модулей (СИГМА § 7).

GET    /api/modules                        — список модулей
GET    /api/modules/{id}                   — паспорт одного модуля + кол-во датчиков
POST   /api/modules                        — создать новый паспорт
PUT    /api/modules/{id}                   — обновить
DELETE /api/modules/{id}                   — удалить
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.schemas.domain import Module
from app.services import module_store

router = APIRouter()


@router.get("/modules")
def list_modules() -> list[dict[str, Any]]:
    """Список модулей + counter подключённых sensor_subtypes."""
    modules = module_store.list_all()
    sensor_counts = module_store.count_sensors_per_module()
    out: list[dict[str, Any]] = []
    for m in modules:
        d = m.model_dump()
        d["sensor_count"] = sensor_counts.get(m.id, 0)
        out.append(d)
    return out


@router.get("/modules/{module_id}")
def get_module(module_id: str) -> dict[str, Any]:
    m = module_store.get(module_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Модуль не найден")
    sensor_counts = module_store.count_sensors_per_module()
    d = m.model_dump()
    d["sensor_count"] = sensor_counts.get(module_id, 0)
    return d


@router.post("/modules", status_code=201)
def create_module(payload: Module) -> Module:
    if not payload.id.strip():
        raise HTTPException(status_code=400, detail="id обязателен")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name обязателен")
    existing = module_store.get(payload.id)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Модуль '{payload.id}' уже существует — используйте PUT для обновления",
        )
    return module_store.save(payload)


@router.put("/modules/{module_id}")
def update_module(module_id: str, payload: Module) -> Module:
    if payload.id != module_id:
        # Принудительно выставляем id из URL.
        payload.id = module_id
    existing = module_store.get(module_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Модуль не найден")
    return module_store.save(payload)


@router.delete("/modules/{module_id}")
def delete_module(module_id: str) -> dict[str, str]:
    deleted = module_store.delete(module_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Модуль не найден")
    return {"id": module_id, "status": "deleted"}
