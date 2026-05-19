"""Аудит-цепочка инцидентов (СИГМА § 2 «Объяснимость и аудит»).

Хранит append-only журнал шагов: «событие → регламент → рекомендация →
действие пользователя → результат». Один incident_id агрегирует всю
цепочку: оператор СЦ или прокурор может за один SELECT восстановить
хронологию принятого решения.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import regulation_store


def append_event(
    incident_id: str,
    event_type: str,
    *,
    source_module_id: str | None = None,
    source_sensor_id: str | None = None,
    source_sensor_subtype: str | None = None,
    event_value: float | None = None,
    event_payload: dict[str, Any] | None = None,
    regulation_id: str | None = None,
    regulation_version: str | None = None,
    level: int | None = None,
    recommendation: str | None = None,
    verdict_status: str | None = None,
    evidence_level: str = "measured",
    user_id: str | None = None,
    user_action: str | None = None,
    user_comment: str | None = None,
    outcome_status: str | None = None,
    timestamp: datetime | None = None,
) -> str:
    """Записать одну запись в журнал инцидента.

    incident_id — UUID одного инцидента (генерируется при первом события
    ETL и проносится через всю цепочку). entry_id — UUID этой записи.
    """
    entry_id = uuid.uuid4().hex
    ts = timestamp or datetime.now(timezone.utc)
    payload_json = (
        json.dumps(event_payload, ensure_ascii=False) if event_payload is not None else None
    )
    with regulation_store._LOCK:
        c = regulation_store._connection()
        c.execute(
            """
            INSERT INTO incident_audit_log (
                entry_id, incident_id, timestamp, event_type,
                source_module_id, source_sensor_id, source_sensor_subtype,
                event_value, event_payload,
                regulation_id, regulation_version,
                level, recommendation, verdict_status, evidence_level,
                user_id, user_action, user_comment, outcome_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                entry_id, incident_id, ts, event_type,
                source_module_id, source_sensor_id, source_sensor_subtype,
                event_value, payload_json,
                regulation_id, regulation_version,
                level, recommendation, verdict_status, evidence_level,
                user_id, user_action, user_comment, outcome_status,
            ],
        )
    return entry_id


def get_incident(incident_id: str) -> list[dict[str, Any]]:
    """Полная хронология одного инцидента в порядке timestamp."""
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            """
            SELECT entry_id, incident_id, timestamp, event_type,
                   source_module_id, source_sensor_id, source_sensor_subtype,
                   event_value, event_payload,
                   regulation_id, regulation_version,
                   level, recommendation, verdict_status, evidence_level,
                   user_id, user_action, user_comment, outcome_status
            FROM incident_audit_log
            WHERE incident_id = ?
            ORDER BY timestamp, entry_id
            """,
            [incident_id],
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_recent(limit: int = 50) -> list[dict[str, Any]]:
    """Последние инциденты — для дашборда руководителя.

    Группирует по incident_id, возвращает агрегированную сводку
    (первая запись + максимальный уровень + последний статус).
    """
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            """
            SELECT
                incident_id,
                MIN(timestamp) AS started_at,
                MAX(timestamp) AS last_at,
                MAX(level) AS max_level,
                ANY_VALUE(event_type) AS first_event_type,
                ANY_VALUE(regulation_id) AS regulation_id,
                ANY_VALUE(verdict_status) AS verdict_status,
                ANY_VALUE(outcome_status) AS outcome_status,
                COUNT(*) AS steps
            FROM incident_audit_log
            GROUP BY incident_id
            ORDER BY last_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    return [
        {
            "incident_id": r[0],
            "started_at": r[1].isoformat() if r[1] else None,
            "last_at": r[2].isoformat() if r[2] else None,
            "max_level": r[3],
            "first_event_type": r[4],
            "regulation_id": r[5],
            "verdict_status": r[6],
            "outcome_status": r[7],
            "steps": int(r[8]),
        }
        for r in rows
    ]


def _row_to_dict(row: tuple) -> dict[str, Any]:
    payload_raw = row[8]
    payload = (
        json.loads(payload_raw)
        if isinstance(payload_raw, str)
        else payload_raw
    )
    return {
        "entry_id": row[0],
        "incident_id": row[1],
        "timestamp": row[2].isoformat() if row[2] else None,
        "event_type": row[3],
        "source_module_id": row[4],
        "source_sensor_id": row[5],
        "source_sensor_subtype": row[6],
        "event_value": float(row[7]) if row[7] is not None else None,
        "event_payload": payload,
        "regulation_id": row[9],
        "regulation_version": row[10],
        "level": int(row[11]) if row[11] is not None else None,
        "recommendation": row[12],
        "verdict_status": row[13],
        "evidence_level": row[14] or "measured",
        "user_id": row[15],
        "user_action": row[16],
        "user_comment": row[17],
        "outcome_status": row[18],
    }


def new_incident_id() -> str:
    """Утилита: генерация incident_id для новой цепочки."""
    return uuid.uuid4().hex
