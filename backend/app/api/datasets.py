"""Список и создание датасетов (источников регламентов) — проксируем admin API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.regulation_client import client

router = APIRouter()


@router.get("/datasets")
async def list_datasets():
    """Список доступных datasets — отображается в Regulation List."""
    try:
        return await client.list_datasets()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream недоступен: {e}") from e


@router.post("/datasets/{app_id}", status_code=201)
async def create_dataset(app_id: str):
    """Создать новый dataset (привязан к приложению `app_id`)."""
    try:
        return await client.create_dataset(app_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream недоступен: {e}") from e
