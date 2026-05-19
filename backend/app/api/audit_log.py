"""REST API для аудит-цепочки инцидентов (СИГМА § 2 «Объяснимость и аудит»).

GET    /api/audit-log                       — последние инциденты (агрегированно)
GET    /api/audit-log/{incident_id}         — полная хронология одного инцидента
POST   /api/audit-log                       — записать шаг (используется CORE)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import audit_log_store

router = APIRouter()


class AuditEntryRequest(BaseModel):
    """Шаг аудит-цепочки.

    incident_id связывает все шаги одного инцидента.
    Любое поле кроме incident_id и event_type опционально — заполняется
    на той стадии цепочки, где известно (event на ETL-стадии, regulation_id
    после CORE, user_action после действия оператора).
    """

    incident_id: str
    event_type: str
    source_module_id: str | None = None
    source_sensor_id: str | None = None
    source_sensor_subtype: str | None = None
    event_value: float | None = None
    event_payload: dict[str, Any] | None = None
    regulation_id: str | None = None
    regulation_version: str | None = None
    level: int | None = None
    recommendation: str | None = None
    verdict_status: str | None = None
    evidence_level: str = "measured"
    user_id: str | None = None
    user_action: str | None = None
    user_comment: str | None = None
    outcome_status: str | None = None


@router.get("/audit-log")
def list_recent(limit: int = 50) -> list[dict[str, Any]]:
    return audit_log_store.list_recent(limit=limit)


@router.get("/audit-log/{incident_id}")
def get_incident(incident_id: str) -> list[dict[str, Any]]:
    chain = audit_log_store.get_incident(incident_id)
    if not chain:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    return chain


@router.post("/audit-log", status_code=201)
def append_entry(payload: AuditEntryRequest) -> dict[str, str]:
    entry_id = audit_log_store.append_event(
        incident_id=payload.incident_id,
        event_type=payload.event_type,
        source_module_id=payload.source_module_id,
        source_sensor_id=payload.source_sensor_id,
        source_sensor_subtype=payload.source_sensor_subtype,
        event_value=payload.event_value,
        event_payload=payload.event_payload,
        regulation_id=payload.regulation_id,
        regulation_version=payload.regulation_version,
        level=payload.level,
        recommendation=payload.recommendation,
        verdict_status=payload.verdict_status,
        evidence_level=payload.evidence_level,
        user_id=payload.user_id,
        user_action=payload.user_action,
        user_comment=payload.user_comment,
        outcome_status=payload.outcome_status,
    )
    return {"entry_id": entry_id, "incident_id": payload.incident_id}


@router.post("/audit-log/new-incident")
def new_incident() -> dict[str, str]:
    """Утилита: получить новый incident_id для первого шага цепочки."""
    return {"incident_id": audit_log_store.new_incident_id()}
