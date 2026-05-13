"""Version history & restore for Rule DSL snapshots."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import FlowVersion
from app.services.flow_storage import get_version, list_versions, restore_version

router = APIRouter()


@router.get("/regulations/{regulation_id}/flow/history")
def history(regulation_id: str) -> list[FlowVersion]:
    """Sync `def` — filesystem-snapshots, FastAPI выполнит в thread-pool."""
    return list_versions(regulation_id)


@router.get("/regulations/{regulation_id}/flow/history/{version_id}")
def get(regulation_id: str, version_id: str) -> FlowVersion:
    v = get_version(regulation_id, version_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return v


@router.post("/regulations/{regulation_id}/flow/restore/{version_id}")
def restore(regulation_id: str, version_id: str) -> FlowVersion:
    v = restore_version(regulation_id, version_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return v
