"""DuckDB-backed authoritative store for editable regulations.

Архитектура (по аналогии с NSK_OpenData_Bot Studio):
  - fixtures = seed (golden examples, не редактируются в рантайме)
  - regulation_store (DuckDB) = source of truth для редактируемых регламентов
  - upstream regulation_client = опциональный sink ("опубликовать в Sigma")

Файл: `backend/data/regulations.duckdb`. Создаётся автоматически.

Зачем DuckDB, а не SQLite:
  - тот же файл-в-файле формат, ноль сетевой инфраструктуры
  - native JSON-тип для snapshot-ов истории
  - быстрый аналитический COUNT(*) для будущего "регламент в дашборде"
  - mature Python binding
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
from app.schemas.domain import Parameter, Recommendation, Regulation

# DuckDB allows multiple cursors over one connection — но для предсказуемости
# в multi-threaded FastAPI используем один process-wide connection + reentrant
# lock — init_db → seed → save() повторно захватывает тот же лок в одном потоке.
_LOCK = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None


def _db_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "regulations.duckdb"


def _connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        _conn = duckdb.connect(str(_db_path()))
        _init_schema(_conn)
    return _conn


def _init_schema(c: duckdb.DuckDBPyConnection) -> None:
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS regulations (
            source_id      VARCHAR PRIMARY KEY,
            name           VARCHAR NOT NULL,
            domain         VARCHAR,
            date           VARCHAR,
            version        VARCHAR NOT NULL DEFAULT '1.0',
            status         VARCHAR NOT NULL DEFAULT 'draft',
            recommendation TEXT,
            recommendation_priority INTEGER,
            updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS parameters (
            source_id      VARCHAR NOT NULL,
            id             VARCHAR NOT NULL,
            name           VARCHAR NOT NULL,
            datatype       VARCHAR NOT NULL DEFAULT 'decimal',
            ref_value      DOUBLE,
            deviation      DOUBLE,
            unit           VARCHAR,
            min_inclusive  DOUBLE,
            max_inclusive  DOUBLE,
            position       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (source_id, id)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS regulation_history (
            version_id     VARCHAR PRIMARY KEY,
            source_id      VARCHAR NOT NULL,
            snapshot       JSON NOT NULL,
            created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            author         VARCHAR NOT NULL DEFAULT 'anonymous',
            comment        VARCHAR
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_hist_src ON regulation_history(source_id, created_at DESC)")


# ---- Public API -------------------------------------------------------


def init_db() -> None:
    """Вызывается при старте FastAPI (lifespan). Создаёт схему + сидит из фикстур."""
    with _LOCK:
        _connection()  # запустит _init_schema
        _seed_from_fixtures_if_empty()


def has(source_id: str) -> bool:
    with _LOCK:
        c = _connection()
        row = c.execute("SELECT 1 FROM regulations WHERE source_id = ?", [source_id]).fetchone()
    return row is not None


def list_all() -> list[dict[str, Any]]:
    """Список регламентов для /api/datasets (id, name, domain + счётчики)."""
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT r.source_id, r.name, r.domain,
                   (SELECT COUNT(*) FROM parameters p WHERE p.source_id = r.source_id) AS params_count,
                   CASE WHEN r.recommendation IS NULL OR r.recommendation = '' THEN 0 ELSE 1 END AS recs_count
            FROM regulations r
            ORDER BY r.domain, r.source_id
            """
        ).fetchall()
    return [
        {
            "id": r[0],
            "source_id": r[0],
            "name": r[1],
            "domain": r[2],
            "parameters_count": int(r[3]),
            "recommendations_count": int(r[4]),
        }
        for r in rows
    ]


def get(source_id: str) -> Regulation | None:
    with _LOCK:
        c = _connection()
        head = c.execute(
            """
            SELECT source_id, name, domain, date, version, status, recommendation, recommendation_priority
            FROM regulations WHERE source_id = ?
            """,
            [source_id],
        ).fetchone()
        if head is None:
            return None
        params_rows = c.execute(
            """
            SELECT id, name, datatype, ref_value, deviation, unit, min_inclusive, max_inclusive
            FROM parameters WHERE source_id = ?
            ORDER BY position, id
            """,
            [source_id],
        ).fetchall()
    parameters = [
        Parameter(
            id=row[0],
            name=row[1],
            datatype=row[2],
            referenceValue=row[3],
            deviationAllowed=row[4],
            unit=row[5],
            minInclusive=row[6],
            maxInclusive=row[7],
        )
        for row in params_rows
    ]
    recommendations: list[Recommendation] = []
    if head[6]:  # recommendation text
        recommendations.append(
            Recommendation(
                id=f"rec_{source_id}",
                text=head[6],
                priority=int(head[7] or 2),  # type: ignore[arg-type]
                linkedParameters=[p.id for p in parameters],
            )
        )
    return Regulation(
        id=head[0],
        name=head[1],
        domain=head[2],
        date=head[3],
        version=head[4] or "1.0",
        status=head[5] or "draft",
        parameters=parameters,
        constraints=[],  # constraints живут в upstream /shapes
        recommendations=recommendations,
    )


def save(reg: Regulation, author: str = "anonymous", comment: str | None = None) -> str:
    """Upsert + snapshot в history. Возвращает version_id."""
    version_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)

    rec_text = reg.recommendations[0].text if reg.recommendations else None
    rec_priority = reg.recommendations[0].priority if reg.recommendations else None

    snapshot = reg.model_dump(mode="json")

    with _LOCK:
        c = _connection()
        c.begin()
        try:
            # Upsert regulation head
            c.execute(
                """
                INSERT INTO regulations (source_id, name, domain, date, version, status, recommendation, recommendation_priority, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (source_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    domain = EXCLUDED.domain,
                    date = EXCLUDED.date,
                    version = EXCLUDED.version,
                    status = EXCLUDED.status,
                    recommendation = EXCLUDED.recommendation,
                    recommendation_priority = EXCLUDED.recommendation_priority,
                    updated_at = EXCLUDED.updated_at
                """,
                [reg.id, reg.name, reg.domain, reg.date, reg.version, reg.status, rec_text, rec_priority, now],
            )
            # Полная замена параметров (упрощённая стратегия — drop+insert).
            c.execute("DELETE FROM parameters WHERE source_id = ?", [reg.id])
            for pos, p in enumerate(reg.parameters):
                c.execute(
                    """
                    INSERT INTO parameters (source_id, id, name, datatype, ref_value, deviation, unit, min_inclusive, max_inclusive, position)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        reg.id,
                        p.id,
                        p.name,
                        p.datatype,
                        p.referenceValue,
                        p.deviationAllowed,
                        p.unit,
                        p.minInclusive,
                        p.maxInclusive,
                        pos,
                    ],
                )
            # History snapshot
            c.execute(
                """
                INSERT INTO regulation_history (version_id, source_id, snapshot, created_at, author, comment)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [version_id, reg.id, json.dumps(snapshot, ensure_ascii=False), now, author, comment],
            )
            c.commit()
        except Exception:
            c.rollback()
            raise
    return version_id


def history(source_id: str) -> list[dict[str, Any]]:
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT version_id, source_id, created_at, author, comment
            FROM regulation_history
            WHERE source_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            [source_id],
        ).fetchall()
    return [
        {
            "version_id": r[0],
            "source_id": r[1],
            "created_at": r[2].isoformat() if r[2] else None,
            "author": r[3],
            "comment": r[4],
        }
        for r in rows
    ]


def restore(source_id: str, version_id: str) -> Regulation | None:
    with _LOCK:
        c = _connection()
        row = c.execute(
            "SELECT snapshot FROM regulation_history WHERE version_id = ? AND source_id = ?",
            [version_id, source_id],
        ).fetchone()
    if row is None:
        return None
    snapshot = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    reg = Regulation.model_validate(snapshot)
    save(reg, comment=f"Восстановлено из версии {version_id[:8]}")
    return reg


def delete(source_id: str) -> bool:
    """Полное удаление регламента из store. Возвращает True если был удалён."""
    with _LOCK:
        c = _connection()
        c.begin()
        try:
            c.execute("DELETE FROM parameters WHERE source_id = ?", [source_id])
            res = c.execute("DELETE FROM regulations WHERE source_id = ?", [source_id])
            deleted = (res.fetchone() is None)  # for DuckDB just check after; simpler:
            c.commit()
        except Exception:
            c.rollback()
            raise
    return True if has(source_id) is False else not deleted  # noqa: SIM210


# ---- Seeding ----------------------------------------------------------


def _seed_from_fixtures_if_empty() -> None:
    """При первом запуске: парсим все фикстуры и кладём в DB.

    После сида DB — authoritative; правки идут только в DB, фикстуры не меняем.
    """
    from app.services import fixtures  # local import to avoid cycle at module-load time
    from app.services.turtle_bridge import parse_regulation_turtle

    c = _connection()
    row = c.execute("SELECT COUNT(*) FROM regulations").fetchone()
    count = int(row[0]) if row else 0
    if count > 0:
        return  # already seeded

    for sid, meta in fixtures.REGISTRY.items():
        try:
            data = fixtures.read_data(sid)
            shapes = fixtures.read_shapes(sid)
            reg = parse_regulation_turtle(data, sid, shapes_turtle=shapes)
            reg.domain = meta["domain"]
            # Имя из реестра приоритетнее имени в Turtle — оно длиннее и описательнее.
            reg.name = meta.get("name") or reg.name
            save(reg, author="system-seed", comment=f"Сидинг из фикстуры {sid}")
        except Exception as e:
            # Не валим старт приложения если одна фикстура битая.
            print(f"[regulation_store] seed warning for {sid}: {e}")
