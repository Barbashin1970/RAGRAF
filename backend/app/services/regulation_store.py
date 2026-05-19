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
from app.schemas.domain import Parameter, Recommendation, Regulation, RegulationTrigger, RuleDSL

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
    global _conn  # sigma:allow P3 — singleton lazy-init, не рекурсия; защищён _LOCK выше.
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
    # Колонки добавлялись инкрементально (SIGMA-compliance + позже PROV-O attachment).
    # ADD COLUMN-цикл идемпотентен: запускается на каждом старте, добавляет только
    # отсутствующие столбцы. Старые БД получают новые поля без миграции данных.
    for col in (
        "source_document", "source_clause", "valid_from", "valid_to",
        # PROV-O attachment (документ-основание для traceability):
        "source_url", "source_excerpt", "source_file_path",
        "source_checksum", "source_mime_type",
    ):
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

    # ── Триггеры регламента (event-driven сцепка) ────────────────────────
    # Декларативная связь «вход регламента → датчик/событие». Один регламент
    # имеет N триггеров — по числу входов (input-нод flow'а). Индекс на
    # sensor_subtype даёт O(1) reverse-lookup «какие регламенты слушают этот
    # датчик» — критично для будущего ETL-приёмника СИГМЫ. Подробнее: модель
    # `RegulationTrigger` в schemas/domain.py.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS regulation_triggers (
            source_id      VARCHAR NOT NULL,
            trigger_id     VARCHAR NOT NULL,
            label          VARCHAR,
            param_ref      VARCHAR NOT NULL,
            sensor_subtype VARCHAR,
            event_type     VARCHAR,
            description    VARCHAR,
            position       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (source_id, trigger_id)
        )
        """
    )
    # Идемпотентная миграция: source_regulation + source_output добавились
    # после первой версии триггеров. Старые БД получают новые колонки без
    # перезаписи данных (как в основной regulations таблице выше).
    existing_trig = {
        row[1] for row in c.execute("PRAGMA table_info('regulation_triggers')").fetchall()
    }
    for col in ("source_regulation", "source_output"):
        if col not in existing_trig:
            c.execute(f"ALTER TABLE regulation_triggers ADD COLUMN {col} VARCHAR")
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_trig_subtype ON regulation_triggers(sensor_subtype)"
    )
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_trig_event ON regulation_triggers(event_type)"
    )
    # Индекс для reverse-lookup композиции «какие регламенты слушают этот».
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_trig_source_reg ON regulation_triggers(source_regulation)"
    )

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

    # ── Overrides RAGU-промптов ─────────────────────────────────────────
    # RAGU 0.0.2 хранит 18 системных Jinja2-промптов в коде. Чтобы аналитик
    # мог менять их без форка библиотеки, держим overrides здесь — при старте
    # каждого search engine применяем через RaguGenerativeModule.update_prompt.
    # comment — для аудита «кто и зачем поправил».
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS ragu_prompt_overrides (
            name        VARCHAR PRIMARY KEY,
            template    TEXT NOT NULL,
            role        VARCHAR NOT NULL DEFAULT 'user',
            comment     VARCHAR,
            updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # ── Пользовательские домены ─────────────────────────────────────────
    # Аналитик может создать новый домен из UI, в т.ч. в сценарии bootstrap'а
    # корпуса с нуля (загрузили PDF → анализ не нашёл соседей → создаём домен
    # «прямо отсюда»). Seed-домены живут в fixtures.DOMAINS, пользовательские —
    # здесь. На read домены объединяются (см. domain_store.list_all).
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS user_domains (
            id          VARCHAR PRIMARY KEY,
            label       VARCHAR NOT NULL,
            hint        VARCHAR,
            icon        VARCHAR,
            color       VARCHAR,
            created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    # Идемпотентная миграция для существующих DB: icon/color добавились
    # вторым подходом после ввода SmartCity-палитры в CreateDomainDialog
    # (2026-05-19, фикс 038). ALTER ADD COLUMN не падает если столбец уже
    # есть только при IF NOT EXISTS; используем PRAGMA для безопасности.
    existing_user_dom = {
        row[1] for row in c.execute("PRAGMA table_info('user_domains')").fetchall()
    }
    for col in ("icon", "color"):
        if col not in existing_user_dom:
            c.execute(f"ALTER TABLE user_domains ADD COLUMN {col} VARCHAR")

    # ── Modules (паспорт прикладного модуля по СИГМА § 7) ───────────────
    # Внешний источник событий с формальным контрактом интеграции.
    # Sensor_subtypes связываются с модулем через FK module_id — это даёт
    # обратный lookup «какой датчик от какого модуля».
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS modules (
            id              VARCHAR PRIMARY KEY,
            name            VARCHAR NOT NULL,
            purpose         TEXT,
            owner           VARCHAR,
            domain          VARCHAR,
            status          VARCHAR NOT NULL DEFAULT 'draft',
            version         VARCHAR NOT NULL DEFAULT '1.0',
            icon            VARCHAR,
            color           VARCHAR,
            api_contract    JSON,
            quality_rules   JSON,
            event_types     JSON,
            contact_email   VARCHAR,
            documentation_url VARCHAR,
            notes           TEXT,
            created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_modules_domain ON modules(domain)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_modules_status ON modules(status)")

    # ── Sensor subtype → Module link (миграция) ──────────────────────────
    # Добавляем module_id к существующей таблице sensor_subtypes если её
    # ещё нет (таблица создаётся в sensor_schema_store.py).
    try:
        existing_sub = {
            row[1] for row in c.execute("PRAGMA table_info('sensor_subtypes')").fetchall()
        }
        if existing_sub and "module_id" not in existing_sub:
            c.execute("ALTER TABLE sensor_subtypes ADD COLUMN module_id VARCHAR")
    except Exception:
        # Таблица sensor_subtypes ещё не создана — sensor_schema_store
        # сама добавит module_id в своей миграции.
        pass

    # ── Incident audit log (СИГМА § 2 «Объяснимость и аудит») ────────────
    # Append-only журнал цепочки «событие → регламент → рекомендация →
    # действие пользователя → результат». Каждая строка — один шаг цепочки;
    # для агрегации по incident_id (UUID одного инцидента) UI собирает
    # хронологию.
    #
    # Структура denormalized — все ключевые поля плоские, чтобы фронт мог
    # один SELECT по incident_id и сразу показал timeline без JOIN'ов.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS incident_audit_log (
            entry_id        VARCHAR PRIMARY KEY,
            incident_id     VARCHAR NOT NULL,
            timestamp       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            event_type      VARCHAR NOT NULL,
            -- event: что пришло на вход
            source_module_id VARCHAR,
            source_sensor_id VARCHAR,
            source_sensor_subtype VARCHAR,
            event_value     DOUBLE,
            event_payload   JSON,
            -- regulation: какой регламент применился
            regulation_id   VARCHAR,
            regulation_version VARCHAR,
            -- verdict: результат обработки
            level           INTEGER,
            recommendation  TEXT,
            verdict_status  VARCHAR,
            evidence_level  VARCHAR DEFAULT 'measured',
            -- action: действие пользователя
            user_id         VARCHAR,
            user_action     VARCHAR,
            user_comment    TEXT,
            -- result: итог
            outcome_status  VARCHAR
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_incident ON incident_audit_log(incident_id, timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_event_type ON incident_audit_log(event_type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_regulation ON incident_audit_log(regulation_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON incident_audit_log(timestamp DESC)")

    # ── Raw Turtle (вербатимное хранилище для встроенного редактора) ─────
    # `regulation_to_turtle(reg)` — каноническая сериализация: парсер→модель→
    # ре-сериализация теряет всё, чего нет в Regulation: rdf-комментарии,
    # порядок triplet'ов, кастомные неймспейсы, пробелы. Когда пользователь
    # правит «Turtle»-вкладку и пишет, например, дефис в комментарии или
    # переставляет триплы — после save мы возвращали ему ре-сериализованный
    # текст БЕЗ его правок. Симптом: «добавил тире → сохранить → тире
    # исчезло».
    #
    # Лечение — `regulation_raw_turtle`: дополнительная таблица с raw-текстом
    # последнего save. Контракт:
    #   • PUT /raw → store user's text verbatim + parse+save Regulation.
    #   • GET /raw → если raw_turtle есть → отдать верзим; иначе fallback на
    #     regulation_to_turtle(stored).
    #   • PUT /regulations/{id} (Form save) → save() очищает raw_turtle —
    #     следующий GET регенерит из структурированной модели (правда — Form).
    #   • restore() из истории → тоже очищает raw_turtle.
    # Один источник правды: то, что пользователь сохранил последним.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS regulation_raw_turtle (
            source_id   VARCHAR PRIMARY KEY,
            turtle      TEXT NOT NULL,
            updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # ── Processes (цифровые двойники процессов управления) ──────────────
    # Process объединяет N регламентов в одну операционную картину для
    # визуализации (Cytoscape-подграф), симуляции цепочек и экспорта.
    # regulation_ids хранятся JSON-массивом — denormalized listing терпим
    # при типичном размере процесса (2-10 регламентов).
    #
    # Схема создаётся ЗДЕСЬ (а не в process_store), чтобы все таблицы
    # `regulations.duckdb` шарили один _connection() singleton. Иначе
    # вторая DuckDB-связь с тем же файлом ловит race с WAL-flush'ем —
    # цифровые двойники терялись после рестарта uvicorn.
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

    # ── Миграции (одноразовые data-migrations) ───────────────────────────
    # Лёгкий tracker: имя миграции + applied_at. Используется для апгрейдов
    # данных, которые не выражаются ALTER TABLE — например «удалить триггеры
    # с эвристическим источником». См. _run_data_migrations() ниже.
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS _migrations (
            name        VARCHAR PRIMARY KEY,
            applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


# ---- Public API -------------------------------------------------------


def init_db() -> None:
    """Вызывается при старте FastAPI (lifespan). Создаёт схему + сидит из фикстур."""
    with _LOCK:
        _connection()  # запустит _init_schema
        _seed_from_fixtures_if_empty()
        _run_data_migrations()
        # Seed модулей (СИГМА § 7) — пустая таблица → 10 модулей примера.
        try:
            from app.services import module_store
            module_store.seed_if_empty()
        except Exception as e:
            print(f"[regulation_store] module seed warning: {e}")


def _run_data_migrations() -> None:
    """Запустить одноразовые data-migrations (имена tracked в _migrations).

    Каждая миграция идемпотентна по самой себе, плюс мы отмечаем её как
    `applied_at` — после первого запуска код миграции уже не выполняется.

    Сценарии добавления миграций:
      • удаление авто-сгенерированных триггеров после смены политики
        (heuristic auto-fill → user-driven only);
      • очистка sensor-нод flow без bindsTo;
      • любая трансформация данных, которая не выражается ALTER TABLE.
    """
    c = _connection()
    applied = {row[0] for row in c.execute("SELECT name FROM _migrations").fetchall()}

    # ── strip_auto_triggers_v1 ──────────────────────────────────────────
    # 2026-05-18. Раньше `_backfill_triggers_if_missing` агрессивно заполнял
    # триггеры по эвристике PARAM_TO_SUBTYPE_HINT (имя параметра → датчик)
    # и PARAM_TO_EVENT_TYPE — пользователь видел уже привязанные датчики,
    # которых он не выбирал. Поведение поменяли: триггер создаётся только
    # явно пользователем. Эта миграция удаляет хвост авто-триггеров,
    # оставшийся в БД.
    #
    # Критерий — description тех функций. Не трогаем триггеры с явным
    # source_regulation/sensor_subtype, выбранным руками (description !=
    # auto-pattern).
    if "strip_auto_triggers_v1" not in applied:
        try:
            deleted = c.execute(
                """
                DELETE FROM regulation_triggers
                WHERE description LIKE 'Производный триггер%'
                   OR description LIKE 'Создан из flow%'
                """
            ).fetchall()
            c.execute(
                "INSERT INTO _migrations (name) VALUES (?)",
                ["strip_auto_triggers_v1"],
            )
            print("[regulation_store] migration strip_auto_triggers_v1 applied")
        except Exception as e:
            print(f"[regulation_store] migration strip_auto_triggers_v1 failed: {e}")

    # ── fix_trigger_param_ref_to_id_v1 ───────────────────────────────────
    # 2026-05-18. Контракт param_ref: стабильный schema-id (`inletPressure`),
    # НЕ display name (`Давление узла`). Раньше фронт сохранял
    # `trigger.param_ref = p.name`, что после ренейма параметра ломало
    # синк с flow (input.paramRef = p.id) — sensor-нода не появлялась,
    # GET /raw 500 при rdflib URI build на «Давление узла».
    #
    # Миграция: для каждого trigger.param_ref, если он совпадает с
    # parameter.name (но не с parameter.id), заменяем на parameter.id.
    # Триггеры с param_ref совпадающим с parameter.id не трогаем.
    if "fix_trigger_param_ref_to_id_v1" not in applied:
        try:
            # Сначала собираем пары (source_id, current_param_ref, target_id)
            # — DuckDB UPDATE с JOIN ограничен, выгоднее построить план в Python.
            mismatches = c.execute(
                """
                SELECT t.source_id, t.trigger_id, t.param_ref, p.id, p.name
                FROM regulation_triggers t
                JOIN parameters p
                  ON p.source_id = t.source_id
                 AND p.name = t.param_ref
                WHERE NOT EXISTS (
                    SELECT 1 FROM parameters p2
                    WHERE p2.source_id = t.source_id AND p2.id = t.param_ref
                )
                """
            ).fetchall()
            updated = 0
            for sid, tid, old_ref, new_ref, _name in mismatches:
                # Также пере-канонизируем trigger_id если он был
                # `trig-<old_ref>` — иначе после фикса URI триггер всё ещё
                # имеет «грязный» trigger_id, который ломает Turtle URI.
                new_tid = f"trig-{new_ref}" if tid == f"trig-{old_ref}" else tid
                if new_tid != tid:
                    # Сначала проверим что нет коллизии — иначе UPSERT
                    # с новым id наложился бы на существующий триггер.
                    coll = c.execute(
                        "SELECT 1 FROM regulation_triggers WHERE source_id = ? AND trigger_id = ?",
                        [sid, new_tid],
                    ).fetchone()
                    if coll is None:
                        c.execute(
                            "UPDATE regulation_triggers SET trigger_id = ?, param_ref = ? WHERE source_id = ? AND trigger_id = ?",
                            [new_tid, new_ref, sid, tid],
                        )
                    else:
                        # Коллизия — удаляем legacy запись (новая уже есть).
                        c.execute(
                            "DELETE FROM regulation_triggers WHERE source_id = ? AND trigger_id = ?",
                            [sid, tid],
                        )
                else:
                    c.execute(
                        "UPDATE regulation_triggers SET param_ref = ? WHERE source_id = ? AND trigger_id = ?",
                        [new_ref, sid, tid],
                    )
                updated += 1
            c.execute(
                "INSERT INTO _migrations (name) VALUES (?)",
                ["fix_trigger_param_ref_to_id_v1"],
            )
            print(
                f"[regulation_store] migration fix_trigger_param_ref_to_id_v1 applied — fixed {updated} trigger(s)"
            )
        except Exception as e:
            print(
                f"[regulation_store] migration fix_trigger_param_ref_to_id_v1 failed: {e}"
            )

    # ── seed_arch_pdf_medical_modules_v1 ────────────────────────────────
    # 2026-04-14 (дата пояснительной записки «Описание архитектуры»).
    # Документ описывает 2 специфичных медицинских модуля, которых в
    # старом seed не было: ИИ-диагностика МРТ/туберкулёза и оценка
    # воздействия городской среды на здоровье. Раньше был один общий
    # `health-services` placeholder.
    #
    # Миграция аддитивная: только INSERT, если модулей с такими id ещё
    # нет. Уже отредактированные пользователем модули не трогаем.
    # Свежие установки получают эти модули через module_store.seed_if_empty().
    if "seed_arch_pdf_medical_modules_v1" not in applied:
        try:
            from app.services import module_store
            module_store.seed_arch_pdf_medical_modules_if_missing()
            c.execute(
                "INSERT INTO _migrations (name) VALUES (?)",
                ["seed_arch_pdf_medical_modules_v1"],
            )
            print(
                "[regulation_store] migration seed_arch_pdf_medical_modules_v1 applied"
            )
        except Exception as e:
            print(
                f"[regulation_store] migration seed_arch_pdf_medical_modules_v1 failed: {e}"
            )


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
                   r.source_document,
                   r.source_file_path,
                   r.source_url
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
            # PROV-O attachment indicators — UI рисует badge «📎 источник
            # прикреплён» если есть локальный файл или внешняя ссылка.
            "source_file_path": r[8],
            "source_url": r[9],
        }
        for r in rows
    ]


def get(source_id: str) -> Regulation | None:
    with _LOCK:
        c = _connection()
        head = c.execute(
            """
            SELECT source_id, name, domain, date, version, status, recommendation, recommendation_priority,
                   source_document, source_clause, valid_from, valid_to,
                   source_url, source_excerpt, source_file_path, source_checksum, source_mime_type
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
        trig_rows = c.execute(
            """
            SELECT trigger_id, label, param_ref, sensor_subtype, event_type,
                   source_regulation, source_output, description
            FROM regulation_triggers WHERE source_id = ?
            ORDER BY position, trigger_id
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
        # linkedParameters — auto-derived = все p.id. Поле в модели сохранено
        # для backward compat (graph_builder использует его как «к каким
        # параметрам относится эта рекомендация» — пока всегда «ко всем»).
        # Клиентские правки этого поля игнорируются: оно всегда
        # перевычисляется на read. Если в будущем будет нужно линковать
        # подмножество параметров — добавить DB-колонку + UI-чекбоксы.
        recommendations.append(
            Recommendation(
                id=f"rec_{source_id}",
                text=head[6],
                priority=int(head[7] or 2),  # type: ignore[arg-type]
                linkedParameters=[p.id for p in parameters],
            )
        )
    triggers = [
        RegulationTrigger(
            id=row[0],
            label=row[1],
            param_ref=row[2],
            sensor_subtype=row[3],
            event_type=row[4],
            source_regulation=row[5],
            source_output=row[6],
            description=row[7],
        )
        for row in trig_rows
    ]
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
        triggers=triggers,
        source_document=head[8],
        source_clause=head[9],
        valid_from=head[10],
        valid_to=head[11],
        source_url=head[12],
        source_excerpt=head[13],
        source_file_path=head[14],
        source_checksum=head[15],
        source_mime_type=head[16],
    )


def save(
    reg: Regulation,
    author: str = "anonymous",
    comment: str | None = None,
    sync_flow: bool = True,
) -> str:
    """Upsert + snapshot в history. Возвращает version_id.

    `sync_flow=False` отключает Form → Flow reconcile — используется когда
    save() вызван из Flow→Form sync пути (`derive_params_from_flow`), чтобы
    не вернуться обратно в Flow с теми же изменениями (защита от циклов).
    """
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
                    source_document, source_clause, valid_from, valid_to,
                    source_url, source_excerpt, source_file_path,
                    source_checksum, source_mime_type
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    valid_to = EXCLUDED.valid_to,
                    source_url = EXCLUDED.source_url,
                    source_excerpt = EXCLUDED.source_excerpt,
                    source_file_path = EXCLUDED.source_file_path,
                    source_checksum = EXCLUDED.source_checksum,
                    source_mime_type = EXCLUDED.source_mime_type
                """,
                [
                    reg.id, reg.name, reg.domain, reg.date, reg.version, reg.status,
                    rec_text, rec_priority, now,
                    reg.source_document, reg.source_clause, reg.valid_from, reg.valid_to,
                    reg.source_url, reg.source_excerpt, reg.source_file_path,
                    reg.source_checksum, reg.source_mime_type,
                ],
            )
            # ── Parameters: UPSERT + точечный DELETE удалённых ──────────────
            # Раньше делали DELETE-всех + INSERT-новых. Это дёргает
            # PRIMARY_parameters_5 index на ВСЕ ключи дважды (удаление + вставка
            # обратно с тем же id). При abrupt-shutdown между этими шагами на
            # volume оставался битый index → последующий COMMIT падал с
            # FatalException `duplicate key "src, id"` → SIGABRT → краш контейнера.
            # Корень из логов Railway 2026-05-18.
            #
            # UPSERT через ON CONFLICT DO UPDATE — НЕ удаляет существующую строку,
            # только меняет non-PK поля. Индекс PK остаётся стабильным, не
            # ребилдится. Удаление параметров теперь точечное — только тех,
            # которых нет в новом списке.
            #
            # Защита от дубликатов в входном reg.parameters: dedupe по id
            # с сохранением первого вхождения.
            seen_param_ids: set[str] = set()
            unique_params = []
            for p in reg.parameters:
                if p.id in seen_param_ids:
                    continue
                seen_param_ids.add(p.id)
                unique_params.append(p)
            for pos, p in enumerate(unique_params):
                c.execute(
                    """
                    INSERT INTO parameters (source_id, id, name, datatype, ref_value, deviation, unit, min_inclusive, max_inclusive, position)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (source_id, id) DO UPDATE SET
                        name = EXCLUDED.name,
                        datatype = EXCLUDED.datatype,
                        ref_value = EXCLUDED.ref_value,
                        deviation = EXCLUDED.deviation,
                        unit = EXCLUDED.unit,
                        min_inclusive = EXCLUDED.min_inclusive,
                        max_inclusive = EXCLUDED.max_inclusive,
                        position = EXCLUDED.position
                    """,
                    [
                        reg.id, p.id, p.name, p.datatype,
                        p.referenceValue, p.deviationAllowed, p.unit,
                        p.minInclusive, p.maxInclusive, pos,
                    ],
                )
            # Удаление параметров, которых больше нет в reg.parameters.
            # NOT IN-список безопасен по размеру — типичный регламент <20 params.
            if seen_param_ids:
                placeholders = ",".join("?" for _ in seen_param_ids)
                c.execute(
                    f"DELETE FROM parameters WHERE source_id = ? AND id NOT IN ({placeholders})",
                    [reg.id, *seen_param_ids],
                )
            else:
                # Пустой набор — удаляем всё
                c.execute("DELETE FROM parameters WHERE source_id = ?", [reg.id])

            # ── Triggers: UPSERT + точечный DELETE удалённых ─────────────────
            # Та же история, что и с parameters: DELETE-all + INSERT-all
            # дёргал idx_trig_subtype/event/source_reg + PK index, что давало
            # риск повреждения на abrupt-shutdown.
            #
            # Дедуп: сначала по trigger_id (PK защита), затем по param_ref —
            # в DB не может быть двух триггеров на один и тот же входной
            # параметр (один параметр = один источник). Раньше когда
            # _safe_local_name резал дефис из trig.id, Turtle round-trip
            # создавал «вторую» запись `trigpressure` рядом с `trig-pressure`,
            # обе на param_ref=`pressure` — дубликат в UI и хаос. Теперь
            # сначала по id, потом по param_ref оставляем первого, далее
            # delete-all-not-in.
            seen_trig_ids: set[str] = set()
            seen_param_refs: set[str] = set()
            unique_triggers = []
            for t in reg.triggers:
                if t.id in seen_trig_ids:
                    continue
                if t.param_ref in seen_param_refs:
                    continue
                seen_trig_ids.add(t.id)
                seen_param_refs.add(t.param_ref)
                unique_triggers.append(t)
            for pos, t in enumerate(unique_triggers):
                c.execute(
                    """
                    INSERT INTO regulation_triggers (
                        source_id, trigger_id, label, param_ref,
                        sensor_subtype, event_type,
                        source_regulation, source_output,
                        description, position
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (source_id, trigger_id) DO UPDATE SET
                        label = EXCLUDED.label,
                        param_ref = EXCLUDED.param_ref,
                        sensor_subtype = EXCLUDED.sensor_subtype,
                        event_type = EXCLUDED.event_type,
                        source_regulation = EXCLUDED.source_regulation,
                        source_output = EXCLUDED.source_output,
                        description = EXCLUDED.description,
                        position = EXCLUDED.position
                    """,
                    [
                        reg.id, t.id, t.label, t.param_ref,
                        t.sensor_subtype, t.event_type,
                        t.source_regulation, t.source_output,
                        t.description, pos,
                    ],
                )
            if seen_trig_ids:
                placeholders = ",".join("?" for _ in seen_trig_ids)
                c.execute(
                    f"DELETE FROM regulation_triggers WHERE source_id = ? AND trigger_id NOT IN ({placeholders})",
                    [reg.id, *seen_trig_ids],
                )
                # Дополнительная зачистка legacy дубликатов: если в БД
                # осталась запись с тем же param_ref, но другим trigger_id
                # (последствие BUG-4 — Turtle round-trip создавал `trigfoo`
                # рядом с `trig-foo`), её тоже сносим. Это гарантирует
                # «один parameter = максимум один trigger».
                ph_param = ",".join("?" for _ in seen_param_refs)
                ph_tid = ",".join("?" for _ in seen_trig_ids)
                c.execute(
                    f"""
                    DELETE FROM regulation_triggers
                    WHERE source_id = ?
                      AND param_ref IN ({ph_param})
                      AND trigger_id NOT IN ({ph_tid})
                    """,
                    [reg.id, *seen_param_refs, *seen_trig_ids],
                )
            else:
                c.execute("DELETE FROM regulation_triggers WHERE source_id = ?", [reg.id])
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

    # После успешного коммита — синхронизируем flow с новым набором параметров,
    # чтобы Form Editor и Flow Editor не расходились. Reconcile:
    #   • удаляет orphan-цепочки удалённых параметров,
    #   • добавляет цепочки для новых параметров,
    #   • синхронит threshold-ноды (refValue/deviation/unit/label).
    # Выполняется вне транзакции — флоу в файлах, не блокирует DB-лок, и сбой
    # синка не должен откатывать запись регламента.
    if sync_flow:
        try:
            from app.schemas.domain import RuleDSL
            from app.services.flow_storage import (
                load_flow,
                reconcile_flow_with_params,
                reconcile_flow_with_recommendation,
                reconcile_flow_with_triggers,
                save_flow,
            )

            # Если flow.json для регламента ещё не существует — создаём
            # минимальный пустой RuleDSL. Без этого reconcile_flow_with_params
            # сразу выходит (его контракт: «flow есть → синкаем; нет flow →
            # ничего не делаем»), и sensor-нодa, ожидаемая пользователем
            # после правки триггера, не появляется на канвасе. С пустым flow
            # reconcile_flow_with_params сама добавит input-цепочки для всех
            # параметров, reconcile_flow_with_triggers навесит sensor-узлы.
            if load_flow(reg.id) is None:
                empty_dsl = RuleDSL(
                    rule_id=f"rule_{reg.id}",
                    regulation_id=reg.id,
                    nodes=[],
                    edges=[],
                )
                save_flow(reg.id, empty_dsl, author="system",
                          comment="Авто-создан при save регламента")

            # Порядок важен: сначала параметры (создаёт input-ноды для новых
            # параметров), потом триггеры (привязывает sensor-узлы к этим
            # input-нодам). В обратном порядке reconcile_flow_with_triggers
            # не нашёл бы input и пропустил бы создание sensor.
            reconcile_flow_with_params(reg.id, reg.parameters)
            reconcile_flow_with_triggers(reg.id, reg.triggers)
            # Sync рекомендации в текст единственной output-ноды (если такая
            # есть). Закрывает разрыв между Form'овским text/priority и
            # output.text/priority в Flow Editor — без этого они расходились
            # на каждом save.
            if reg.recommendations:
                rec = reg.recommendations[0]
                reconcile_flow_with_recommendation(reg.id, rec.text, rec.priority)
        except Exception:
            # Сознательно глотаем: flow можно поправить вручную в Flow Editor,
            # потеря регламента из-за рассинка флоу — недопустима.
            pass

    # Form-save → инвалидируем сохранённый raw turtle. Структурированная модель
    # теперь — источник правды; следующий GET /raw регенерит каноничный текст
    # из неё через regulation_to_turtle. Без инвалидации пользователь увидел
    # бы старый verbatim, не отражающий правки в полях.
    invalidate_raw_turtle(reg.id)

    return version_id


# ---- Raw Turtle (вербатимное хранилище для встроенного редактора) ----

def get_raw_turtle(source_id: str) -> str | None:
    """Возвращает verbatim Turtle, сохранённый через PUT /raw, или None.

    None означает «структурированная модель — источник правды, регенерируйте».
    """
    with _LOCK:
        c = _connection()
        row = c.execute(
            "SELECT turtle FROM regulation_raw_turtle WHERE source_id = ?",
            [source_id],
        ).fetchone()
    return row[0] if row else None


def save_raw_turtle(source_id: str, turtle: str) -> None:
    """Сохранить verbatim Turtle (вызов из PUT /raw)."""
    with _LOCK:
        c = _connection()
        c.execute(
            """
            INSERT INTO regulation_raw_turtle (source_id, turtle, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (source_id) DO UPDATE SET
                turtle = EXCLUDED.turtle,
                updated_at = EXCLUDED.updated_at
            """,
            [source_id, turtle],
        )


def invalidate_raw_turtle(source_id: str) -> None:
    """Удалить verbatim Turtle — следующий GET /raw регенерит из модели."""
    with _LOCK:
        c = _connection()
        c.execute(
            "DELETE FROM regulation_raw_turtle WHERE source_id = ?", [source_id]
        )


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
            c.execute("DELETE FROM regulation_triggers WHERE source_id = ?", [source_id])
            c.execute("DELETE FROM regulation_history WHERE source_id = ?", [source_id])
            c.execute("DELETE FROM regulation_raw_turtle WHERE source_id = ?", [source_id])
            c.execute("DELETE FROM regulations WHERE source_id = ?", [source_id])
            c.commit()
        except Exception:
            c.rollback()
            raise
    return True


# ---- Flow → Triggers sync ---------------------------------------------


def sync_triggers_from_flow(source_id: str, dsl: RuleDSL) -> dict[str, int]:
    """Обновить regulation_triggers по sensor-нодам с sourceKind='regulation'.

    Закрывает контракт «Flow ведёт — triggers зеркалит» для композиции
    регламентов через канвас: аналитик переключил sensor-пилюлю в режим
    «слушаю регламент X / выход Y» — после save flow.json мы материализуем
    эту связь в regulation_triggers, чтобы `/triggered-by` reverse-lookup
    моментально стал её видеть.

    Стратегия (зеркалит UPSERT в `save()` triggers):
      1. Сканируем flow.nodes — собираем sensor-ноды с sourceKind='regulation'
         + sourceRegulationId + bindsTo (без bindsTo триггер бессмыслен —
         мы не знаем какой input наполнять).
      2. Для каждого:
           - Лукапим input-ноду (bindsTo) → её paramRef = trigger.param_ref.
           - Генерим стабильный trigger_id = `regsrc-<param_ref>` —
             идемпотентность по последующим save'ам.
      3. UPSERT в regulation_triggers (sensor_subtype/event_type=NULL,
         source_regulation/source_output из ноды).
      4. УДАЛЯЕМ regulation-source триггеры (где source_regulation IS NOT NULL),
         которых больше нет во flow — это значит пользователь снёс sensor
         или переключил его обратно в режим 'sensor'.

    ВАЖНО: НЕ трогаем триггеры с sensor_subtype (физический датчик) — они
    управляются через вкладку «Триггеры» в Edit. Sync строго односторонний:
    flow ↔ regulation-source triggers, без касания sensor-subtype triggers.

    Возвращает `{"upserted": N, "removed": M}` — для логов / тестов.
    """
    # Собираем регуляции-источники из flow.
    desired: list[tuple[str, str, str | None]] = []  # (param_ref, source_reg, source_out)
    seen_param_refs: set[str] = set()
    # Индексируем input-ноды по id чтобы достать paramRef через bindsTo.
    input_paramref_by_id = {n.id: n.paramRef for n in dsl.nodes if n.type == "input" and n.paramRef}
    for n in dsl.nodes:
        if n.type != "sensor":
            continue
        if (n.sourceKind or "sensor") != "regulation":
            continue
        if not n.sourceRegulationId:
            continue
        if not n.bindsTo:
            continue
        param_ref = input_paramref_by_id.get(n.bindsTo)
        if not param_ref:
            continue
        # Защита от двух sensor-нод на один input: первая побеждает.
        if param_ref in seen_param_refs:
            continue
        seen_param_refs.add(param_ref)
        desired.append((param_ref, n.sourceRegulationId, n.sourceOutputAction))

    upserted = 0
    removed = 0
    with _LOCK:
        c = _connection()
        # Проверим что у нас вообще есть запись регламента — без неё триггер
        # повиснет orphan'ом (FK не enforced в DuckDB, но логически вредно).
        exists = c.execute(
            "SELECT 1 FROM regulations WHERE source_id = ?", [source_id]
        ).fetchone()
        if not exists:
            # Возможный кейс: save_flow на регламент, который только что
            # удалили в другой вкладке. Не ронялим — пропускаем.
            return {"upserted": 0, "removed": 0}

        # Сначала вычислим набор существующих regulation-source триггеров,
        # чтобы понять что удалять (которых нет в desired).
        existing_regsrc = c.execute(
            """
            SELECT trigger_id, param_ref
            FROM regulation_triggers
            WHERE source_id = ? AND source_regulation IS NOT NULL
            """,
            [source_id],
        ).fetchall()
        existing_ids = {r[0] for r in existing_regsrc}

        desired_ids: set[str] = set()
        # Найти max(position) среди существующих, чтобы новые добавлять в конец.
        max_pos_row = c.execute(
            "SELECT COALESCE(MAX(position), -1) FROM regulation_triggers WHERE source_id = ?",
            [source_id],
        ).fetchone()
        next_pos = (max_pos_row[0] if max_pos_row else -1) + 1

        for param_ref, src_reg, src_out in desired:
            trigger_id = f"regsrc-{param_ref}"
            desired_ids.add(trigger_id)
            # Перед UPSERT: на этот param_ref может висеть «физический» триггер
            # (sensor_subtype IS NOT NULL) с другим trigger_id — он логически
            # конфликтует (один parameter = один источник). Удаляем его, чтобы
            # save регламента не превратил наш regsrc-триггер в дубликат.
            c.execute(
                """
                DELETE FROM regulation_triggers
                WHERE source_id = ?
                  AND param_ref = ?
                  AND trigger_id != ?
                """,
                [source_id, param_ref, trigger_id],
            )
            c.execute(
                """
                INSERT INTO regulation_triggers (
                    source_id, trigger_id, label, param_ref,
                    sensor_subtype, event_type,
                    source_regulation, source_output,
                    description, position
                )
                VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                ON CONFLICT (source_id, trigger_id) DO UPDATE SET
                    param_ref = EXCLUDED.param_ref,
                    sensor_subtype = NULL,
                    event_type = NULL,
                    source_regulation = EXCLUDED.source_regulation,
                    source_output = EXCLUDED.source_output
                """,
                [
                    source_id,
                    trigger_id,
                    f"← {src_reg}",  # label для UI
                    param_ref,
                    src_reg,
                    src_out,
                    f"Авто-синк из flow: sensor sourceKind=regulation",
                    next_pos,
                ],
            )
            next_pos += 1
            upserted += 1

        # Удаляем regulation-source триггеры, которых больше нет в desired.
        stale_ids = existing_ids - desired_ids
        if stale_ids:
            placeholders = ",".join("?" for _ in stale_ids)
            c.execute(
                f"""
                DELETE FROM regulation_triggers
                WHERE source_id = ?
                  AND source_regulation IS NOT NULL
                  AND trigger_id IN ({placeholders})
                """,
                [source_id, *stale_ids],
            )
            removed = len(stale_ids)

    return {"upserted": upserted, "removed": removed}


# ---- Triggers reverse-lookup ------------------------------------------


def list_by_sensor_subtype(subtype_id: str) -> list[dict[str, Any]]:
    """Какие регламенты слушают этот подтип датчика.

    O(1) запрос благодаря индексу `idx_trig_subtype` на regulation_triggers.
    Возвращает регламенты с краткой меткой триггера (label/param_ref) —
    UI рисует список «датчик air-quality-pm25 используется в 3 регламентах».

    Один регламент может появиться несколько раз если на один подтип
    привязано несколько триггеров — DISTINCT не делаем, UI группирует сам.
    """
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT t.source_id, r.name, r.domain, t.trigger_id, t.label,
                   t.param_ref, t.event_type
            FROM regulation_triggers t
            JOIN regulations r ON r.source_id = t.source_id
            WHERE t.sensor_subtype = ?
            ORDER BY r.domain, r.source_id, t.position, t.trigger_id
            """,
            [subtype_id],
        ).fetchall()
    return [
        {
            "regulation_id": r[0],
            "regulation_name": r[1],
            "domain": r[2],
            "trigger_id": r[3],
            "trigger_label": r[4],
            "param_ref": r[5],
            "event_type": r[6],
        }
        for r in rows
    ]


def list_triggered_by(source_regulation_id: str) -> list[dict[str, Any]]:
    """Какие регламенты слушают output этого регламента (композиция).

    Reverse-lookup для event-driven композиции: показываем «этот регламент
    является триггером для N других». O(1) запрос благодаря индексу
    `idx_trig_source_reg`.

    Один регламент может появиться несколько раз если он держит несколько
    триггеров на этот источник (например, разные output-actions того же
    источника); UI группирует сам.
    """
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT t.source_id, r.name, r.domain, t.trigger_id, t.label,
                   t.param_ref, t.source_output, t.event_type
            FROM regulation_triggers t
            JOIN regulations r ON r.source_id = t.source_id
            WHERE t.source_regulation = ?
            ORDER BY r.domain, r.source_id, t.position, t.trigger_id
            """,
            [source_regulation_id],
        ).fetchall()
    return [
        {
            "regulation_id": r[0],
            "regulation_name": r[1],
            "domain": r[2],
            "trigger_id": r[3],
            "trigger_label": r[4],
            "param_ref": r[5],
            "source_output": r[6],
            "event_type": r[7],
        }
        for r in rows
    ]


def count_triggered_by() -> dict[str, int]:
    """Агрегат: source_regulation_id → N регламентов, его слушающих.

    Для UI — бэйдж «триггерит N регламентов» на карточке регламента-источника,
    без N запросов. Distinct по source_id — если регламент держит два
    триггера на один источник, считается один раз.
    """
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT source_regulation, COUNT(DISTINCT source_id) AS reg_count
            FROM regulation_triggers
            WHERE source_regulation IS NOT NULL
            GROUP BY source_regulation
            """
        ).fetchall()
    return {r[0]: int(r[1]) for r in rows}


def count_by_sensor_subtype() -> dict[str, int]:
    """Агрегат: subtype_id → число регламентов, его использующих.

    Для UI Sensor Library — бэйдж «в N регламентах» на каждой карточке
    подтипа без N запросов. Регламенты считаются distinct — если у регламента
    два триггера на один и тот же подтип, считается один раз.
    """
    with _LOCK:
        c = _connection()
        rows = c.execute(
            """
            SELECT sensor_subtype, COUNT(DISTINCT source_id) AS reg_count
            FROM regulation_triggers
            WHERE sensor_subtype IS NOT NULL
            GROUP BY sensor_subtype
            """
        ).fetchall()
    return {r[0]: int(r[1]) for r in rows}


# ---- Seeding ----------------------------------------------------------


def _seed_from_fixtures_if_empty() -> None:
    """При первом запуске: парсим все фикстуры и кладём в DB.

    Раньше логика была all-or-nothing: если в БД уже есть хоть один регламент,
    подсев не выполнялся. После добавления нового домена (например, новых
    фикстур ЕДДС Кольцово) это означало, что они никогда не появятся у тех
    пользователей, у кого DB уже существовала. Теперь подсев — per-id:
    каждый отсутствующий регламент из REGISTRY добавляется, существующие
    (отредактированные пользователем) не трогаются.
    """
    from app.services import fixtures  # local import to avoid cycle at module-load time
    from app.services.turtle_bridge import parse_regulation_turtle
    from app.services.flow_storage import load_flow
    from app.services.triggers import derive_triggers_from_flow

    c = _connection()
    existing_rows = c.execute("SELECT source_id FROM regulations").fetchall()
    existing_ids = {r[0] for r in existing_rows} if existing_rows else set()

    seeded = 0
    for sid, meta in fixtures.REGISTRY.items():
        if sid in existing_ids:
            continue
        try:
            data = fixtures.read_data(sid)
            shapes = fixtures.read_shapes(sid)
            reg = parse_regulation_turtle(data, sid, shapes_turtle=shapes)
            reg.domain = meta["domain"]
            # Имя из реестра приоритетнее имени в Turtle — оно длиннее и описательнее.
            reg.name = meta.get("name") or reg.name
            # Деривация триггеров — только для фикстур с явной привязкой
            # sensor.bindsTo в flow.json. БЕЗ эвристик по имени параметра —
            # пользователь сам решает, какой источник привязать к входу.
            if not reg.triggers:
                try:
                    flow = load_flow(sid)
                    if flow is not None:
                        reg.triggers = derive_triggers_from_flow(flow)
                except Exception:
                    pass
            save(reg, author="system-seed", comment=f"Сидинг из фикстуры {sid}")
            seeded += 1
        except Exception as e:
            # Не валим старт приложения если одна фикстура битая.
            print(f"[regulation_store] seed warning for {sid}: {e}")

    if seeded:
        print(f"[regulation_store] seeded {seeded} new regulation(s) from fixtures")
