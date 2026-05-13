"""Operate on a single regulation: DuckDB-backed editor + Turtle proxy."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.schemas.domain import Regulation
from app.services import fixtures, regulation_store
from app.services.regulation_client import client
from app.services.turtle_bridge import parse_regulation_turtle, regulation_to_turtle

router = APIRouter()


@router.get("/regulations/{source_id}")
async def get_regulation(source_id: str) -> Regulation:
    """Получить регламент.

    Приоритет источников:
      1. DuckDB store (если регламент редактировался)
      2. парсинг Turtle из upstream/фикстур (fallback)
    """
    # 1) DuckDB store
    stored = regulation_store.get(source_id)
    if stored is not None:
        # Подмешиваем SHACL constraints из shapes (они хранятся в upstream/fixture, не в DB).
        try:
            shapes_turtle = await client.get_shapes(source_id)
            from app.services.turtle_bridge import parse_shapes_turtle
            stored.constraints = parse_shapes_turtle(shapes_turtle)
        except Exception:
            pass
        return stored

    # 2) Fallback — парсинг Turtle
    try:
        turtle = await client.get_data(source_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    shapes_turtle = ""
    try:
        shapes_turtle = await client.get_shapes(source_id)
    except Exception:
        pass
    reg = parse_regulation_turtle(turtle, source_id=source_id, shapes_turtle=shapes_turtle)
    reg.domain = fixtures.get_domain(source_id)
    return reg


@router.put("/regulations/{source_id}")
async def update_regulation(source_id: str, payload: Regulation) -> dict[str, Any]:
    """Сохранить регламент в DuckDB store; опционально пушим Turtle в upstream."""
    if payload.id != source_id:
        # Принудительно выставляем id из URL — клиент мог не дозаполнить.
        payload.id = source_id
    version_id = regulation_store.save(payload, comment="UI edit")

    # Опциональный writeback в upstream (управляется флагом из .env).
    pushed = False
    if getattr(settings, "writeback_upstream", False):
        try:
            await client.update_data(source_id, regulation_to_turtle(payload))
            pushed = True
        except Exception as e:
            # Не валим сохранение — оно уже в локальном store.
            return {"ok": "true", "version": version_id, "upstream_error": str(e)}
    return {"ok": "true", "version": version_id, "pushed_upstream": pushed}


@router.get("/regulations/{source_id}/regulation-history")
async def get_regulation_history(source_id: str):
    """История правок самого регламента (имя/параметры/рекомендация).
    Версии flow живут отдельно по пути /flow/history."""
    return regulation_store.history(source_id)


@router.post("/regulations/{source_id}/regulation-restore/{version_id}")
async def restore_regulation(source_id: str, version_id: str) -> Regulation:
    reg = regulation_store.restore(source_id, version_id)
    if reg is None:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return reg


@router.get("/regulations/{source_id}/raw", response_class=PlainTextResponse)
async def get_regulation_raw(source_id: str) -> str:
    """Получить регламент сырым Turtle (для отладки и инспекции)."""
    try:
        return await client.get_data(source_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e


@router.put("/regulations/{source_id}/raw", status_code=204)
async def update_regulation_raw(source_id: str, turtle: str):
    """Записать сырой Turtle в upstream (используется редактором источников)."""
    try:
        await client.update_data(source_id, turtle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e


@router.delete("/regulations/{source_id}", status_code=204)
async def delete_regulation(source_id: str):
    try:
        await client.delete_data(source_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
