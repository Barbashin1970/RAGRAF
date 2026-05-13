"""Operate on a single regulation (the Turtle blob at upstream `{source_id}/data`)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from app.schemas.domain import Regulation
from app.services import fixtures
from app.services.regulation_client import client
from app.services.turtle_bridge import parse_regulation_turtle

router = APIRouter()


@router.get("/regulations/{source_id}")
async def get_regulation(source_id: str) -> Regulation:
    """Получить регламент в виде нашей domain-структуры.

    Тянем `/data` (Turtle с инстансом регламента) и `/shapes` (SHACL); парсер
    собирает domain объект с параметрами + bounds из обеих частей.
    """
    try:
        turtle = await client.get_data(source_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    shapes_turtle = ""
    try:
        shapes_turtle = await client.get_shapes(source_id)
    except Exception:
        pass  # shapes опциональны — параметры разберём и без них
    reg = parse_regulation_turtle(turtle, source_id=source_id, shapes_turtle=shapes_turtle)
    reg.domain = fixtures.get_domain(source_id)
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
