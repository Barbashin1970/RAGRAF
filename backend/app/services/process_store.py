"""DuckDB-store для Process — цифрового двойника процесса управления.

Process объединяет N регламентов в одну операционную картину для:
  - визуализации (Cytoscape подграф только этих регламентов + их связей);
  - симуляции цепочки сценариев на нескольких регламентах сразу;
  - экспорта артефакта (Turtle / SIGMA-bundle ZIP).

Сами регламенты остаются authoritative в `regulations`. Process — это
**view-of-the-system**, denormalized listing, без отдельной M:N-таблицы
(regulation_ids хранятся JSON-массивом в одной строке). Это терпимо при
типичном размере процесса в 2-10 регламентов; при росте до 100+ — стоит
выделить `process_regulations` с position.

См. также:
  - app/schemas/domain.py:Process — Pydantic-модель;
  - app/api/processes.py — REST.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb

from app.config import settings
from app.schemas.domain import Process

_LOCK = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None


def _db_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "regulations.duckdb"


def _connection() -> duckdb.DuckDBPyConnection:
    global _conn  # sigma:allow P3 — singleton lazy-init, не рекурсия; защищён _LOCK.
    if _conn is None:
        _conn = duckdb.connect(str(_db_path()))
        _init_schema(_conn)
    return _conn


def _init_schema(c: duckdb.DuckDBPyConnection) -> None:
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS processes (
            id              VARCHAR PRIMARY KEY,
            name            VARCHAR NOT NULL,
            description     VARCHAR,
            regulation_ids  JSON NOT NULL DEFAULT '[]',
            created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def init_db() -> None:
    """Вызывается из app/main.py lifespan."""
    with _LOCK:
        _connection()


# ── CRUD ───────────────────────────────────────────────────────────────


def list_all() -> list[Process]:
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT id, name, description, regulation_ids, created_at, updated_at
            FROM processes
            ORDER BY updated_at DESC, name
            """
        ).fetchall()
    return [
        Process(
            id=r[0],
            name=r[1],
            description=r[2],
            regulation_ids=_decode_ids(r[3]),
            created_at=r[4].isoformat() if r[4] else None,
            updated_at=r[5].isoformat() if r[5] else None,
        )
        for r in rows
    ]


def get(process_id: str) -> Process | None:
    with _LOCK:
        c = _connection()
        row = c.execute(
            """
            SELECT id, name, description, regulation_ids, created_at, updated_at
            FROM processes WHERE id = ?
            """,
            [process_id],
        ).fetchone()
    if row is None:
        return None
    return Process(
        id=row[0],
        name=row[1],
        description=row[2],
        regulation_ids=_decode_ids(row[3]),
        created_at=row[4].isoformat() if row[4] else None,
        updated_at=row[5].isoformat() if row[5] else None,
    )


def save(p: Process) -> Process:
    """Upsert по id. Если id пустой — генерируем uuid.

    Возвращает сохранённый процесс с проставленными created_at / updated_at.
    """
    now = datetime.now(timezone.utc)
    new_id = p.id or uuid.uuid4().hex[:12]
    ids_json = json.dumps(p.regulation_ids or [], ensure_ascii=False)
    with _LOCK:
        c = _connection()
        c.execute(
            """
            INSERT INTO processes (id, name, description, regulation_ids, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                regulation_ids = EXCLUDED.regulation_ids,
                updated_at = EXCLUDED.updated_at
            """,
            [new_id, p.name, p.description, ids_json, now, now],
        )
        # Возвращаем актуальную запись (с серверным created_at / updated_at).
    return get(new_id) or Process(id=new_id, name=p.name, description=p.description,
                                  regulation_ids=list(p.regulation_ids))


def delete(process_id: str) -> bool:
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM processes WHERE id = ?", [process_id],
        ).fetchone() is not None
        if not existed:
            return False
        c.execute("DELETE FROM processes WHERE id = ?", [process_id])
    return True


# ── Helpers ────────────────────────────────────────────────────────────


def _decode_ids(raw: Any) -> list[str]:
    """DuckDB JSON-колонка отдаёт либо list (если decoded), либо str.

    Защищаемся от обоих вариантов.
    """
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return [str(x) for x in v] if isinstance(v, list) else []
        except json.JSONDecodeError:
            return []
    return []
