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
            updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            source_document VARCHAR,
            source_clause   VARCHAR,
            valid_from      VARCHAR,
            valid_to        VARCHAR
        )
        """
    )
    # Идемпотентная миграция для существующих DB (без drop'а данных).
    # Проверяем существующие колонки через PRAGMA, добавляем только недостающие.
    # DuckDB ADD COLUMN IF NOT EXISTS поддерживается с 0.9, но безопаснее идти
    # через introspection — работает на любой версии.
    # PRAGMA table_info → (cid, name, type, notnull, dflt_value, pk).
    # Имя колонки в row[1], не row[0] (cid — целочисленный индекс).
    existing = {row[1] for row in c.execute("PRAGMA table_info('regulations')").fetchall()}
    for col in ("source_document", "source_clause", "valid_from", "valid_to"):
        if col not in existing:
            c.execute(f"ALTER TABLE regulations ADD COLUMN {col} VARCHAR")
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

    # ── Документы аналитика (загруженные PDF/DOCX как контекст для Q&A) ──
    # Лимит — 10 документов на пользователя (single-user instance). Хранение
    # одной таблицей вместе с метаданными; chunks отдельно для семантического
    # поиска через bge-m3 embeddings (NotebookLM-style layout).
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS user_documents (
            doc_id        VARCHAR PRIMARY KEY,
            filename      VARCHAR NOT NULL,
            mime_type     VARCHAR NOT NULL,
            size_bytes    INTEGER NOT NULL,
            uploaded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            enabled       BOOLEAN NOT NULL DEFAULT TRUE,
            total_chunks  INTEGER NOT NULL DEFAULT 0,
            char_count    INTEGER NOT NULL DEFAULT 0,
            error         VARCHAR
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS document_chunks (
            chunk_id      VARCHAR PRIMARY KEY,
            doc_id        VARCHAR NOT NULL,
            chunk_index   INTEGER NOT NULL,
            text          VARCHAR NOT NULL,
            embedding     JSON,
            FOREIGN KEY (doc_id) REFERENCES user_documents(doc_id)
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(doc_id, chunk_index)")


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
                   CASE WHEN r.recommendation IS NULL OR r.recommendation = '' THEN 0 ELSE 1 END AS recs_count,
                   r.recommendation_priority,
                   r.valid_to,
                   r.source_document
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
            # SIGMA-compliance: критичность (из priority) + срок действия +
            # ссылка на нормативный документ — выводятся в карточке регламента.
            "priority": int(r[5]) if r[5] is not None else None,
            "valid_to": r[6],
            "source_document": r[7],
        }
        for r in rows
    ]


def get(source_id: str) -> Regulation | None:
    with _LOCK:
        c = _connection()
        head = c.execute(
            """
            SELECT source_id, name, domain, date, version, status, recommendation, recommendation_priority,
                   source_document, source_clause, valid_from, valid_to
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
        source_document=head[8],
        source_clause=head[9],
        valid_from=head[10],
        valid_to=head[11],
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
                INSERT INTO regulations (
                    source_id, name, domain, date, version, status,
                    recommendation, recommendation_priority, updated_at,
                    source_document, source_clause, valid_from, valid_to
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (source_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    domain = EXCLUDED.domain,
                    date = EXCLUDED.date,
                    version = EXCLUDED.version,
                    status = EXCLUDED.status,
                    recommendation = EXCLUDED.recommendation,
                    recommendation_priority = EXCLUDED.recommendation_priority,
                    updated_at = EXCLUDED.updated_at,
                    source_document = EXCLUDED.source_document,
                    source_clause = EXCLUDED.source_clause,
                    valid_from = EXCLUDED.valid_from,
                    valid_to = EXCLUDED.valid_to
                """,
                [
                    reg.id, reg.name, reg.domain, reg.date, reg.version, reg.status,
                    rec_text, rec_priority, now,
                    reg.source_document, reg.source_clause, reg.valid_from, reg.valid_to,
                ],
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
    """История правок + автоматический diff_summary для каждой версии.

    diff_summary считается между парой соседних snapshot-ов (текущая ↔ предыдущая
    по created_at), чтобы UI мог сразу показать «что изменилось» без отдельного
    запроса. Структурный diff (полный список changes) отдаётся по `/regulation-diff/{vid}`.
    """
    from app.services.regulation_diff import compute_diff

    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT version_id, source_id, snapshot, created_at, author, comment
            FROM regulation_history
            WHERE source_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            [source_id],
        ).fetchall()

    parsed: list[dict[str, Any]] = []
    for r in rows:
        snap = r[2] if isinstance(r[2], dict) else json.loads(r[2])
        parsed.append(
            {
                "version_id": r[0],
                "source_id": r[1],
                "_snapshot": snap,
                "created_at": r[3].isoformat() if r[3] else None,
                "author": r[4],
                "comment": r[5],
            }
        )

    # Считаем diff между текущей версией и следующей более старой (по списку — это i+1).
    out: list[dict[str, Any]] = []
    for i, h in enumerate(parsed):
        prev_snap = parsed[i + 1]["_snapshot"] if i + 1 < len(parsed) else None
        try:
            new_reg = Regulation.model_validate(h["_snapshot"])
            old_reg = Regulation.model_validate(prev_snap) if prev_snap else None
            diff = compute_diff(old_reg, new_reg)
        except Exception:
            diff = {"summary": "—", "changes": [], "counts": {}}
        out.append(
            {
                "version_id": h["version_id"],
                "source_id": h["source_id"],
                "created_at": h["created_at"],
                "author": h["author"],
                "comment": h["comment"],
                "diff_summary": diff["summary"],
                "diff_counts": diff["counts"],
            }
        )
    return out


def get_snapshot(source_id: str, version_id: str) -> dict[str, Any] | None:
    with _LOCK:
        c = _connection()
        row = c.execute(
            "SELECT snapshot FROM regulation_history WHERE version_id = ? AND source_id = ?",
            [version_id, source_id],
        ).fetchone()
    if row is None:
        return None
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def get_prev_snapshot(source_id: str, version_id: str) -> dict[str, Any] | None:
    """Snapshot версии, которая шла непосредственно перед `version_id`."""
    with _LOCK:
        c = _connection()
        row = c.execute(
            """
            WITH target AS (
                SELECT created_at FROM regulation_history
                WHERE source_id = ? AND version_id = ?
            )
            SELECT snapshot FROM regulation_history
            WHERE source_id = ? AND created_at < (SELECT created_at FROM target)
            ORDER BY created_at DESC LIMIT 1
            """,
            [source_id, version_id, source_id],
        ).fetchone()
    if row is None:
        return None
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


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
    """Полное удаление регламента из store.

    Удаляет head-запись, параметры и всю историю версий (иначе при создании
    регламента с тем же slug-ом старая история «всплывёт»).
    Возвращает True если был удалён, False если такого регламента не было.
    """
    with _LOCK:
        c = _connection()
        existed = c.execute(
            "SELECT 1 FROM regulations WHERE source_id = ?", [source_id]
        ).fetchone() is not None
        if not existed:
            return False
        c.begin()
        try:
            c.execute("DELETE FROM parameters WHERE source_id = ?", [source_id])
            c.execute("DELETE FROM regulation_history WHERE source_id = ?", [source_id])
            c.execute("DELETE FROM regulations WHERE source_id = ?", [source_id])
            c.commit()
        except Exception:
            c.rollback()
            raise
    return True


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
