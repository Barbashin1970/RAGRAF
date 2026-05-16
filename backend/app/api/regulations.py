"""Operate on a single regulation: DuckDB-backed editor + Turtle proxy."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.schemas.domain import Regulation
from app.services import domain_store, fixtures, regulation_store, templates
from app.services.flow_storage import delete_flow as save_flow_module_delete, save_flow
from app.services.regulation_client import client
from app.services.templates import ensure_unique_source_id, slugify
from app.services.turtle_bridge import parse_regulation_turtle, regulation_to_turtle

router = APIRouter()


# ---- Create new regulation ----


class CreateRegulationRequest(BaseModel):
    """Тело POST /api/regulations.

    Поля:
      - `domain` — обязателен; задаёт шаблон (heating / housing / safety /
        environment / любой другой из `/api/domains`).
      - `name` — опционально; если не задан, берётся `default_name` шаблона.
      - `source_id` — опционально; если не задан, генерируется slug из
        `name` + uuid-суффикс (для уникальности).
      - `use_template` — по умолчанию True. При False создаётся пустой
        регламент (только meta), без параметров/flow.
    """
    domain: str = Field(..., description="ID домена из /api/domains")
    name: str | None = Field(None, description="Имя; если не задано — default_name шаблона")
    source_id: str | None = Field(None, description="ID источника; если не задано — генерируется")
    use_template: bool = Field(True, description="Заполнить параметры/flow из шаблона домена")


@router.post("/regulations", status_code=201)
def create_regulation(payload: CreateRegulationRequest) -> Regulation:
    """Создать новый регламент по шаблону домена.

    Сценарий:
      1. Slug = `_slugify(payload.source_id or payload.name)`.
      2. Если slug уже занят — добавляем uuid-суффикс.
      3. По шаблону домена создаём `Regulation` + стартовый `RuleDSL` flow.
      4. Сохраняем в DuckDB (первая версия в history) и flow в `data/flows/`.
      5. Возвращаем созданный `Regulation`.

    Это закрывает гэп «нет ручки создания»: раньше регламенты появлялись
    только через seed из фикстур или upstream Sigma.
    """
    if not domain_store.exists(payload.domain):
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестный домен '{payload.domain}'. Доступны: {[d['id'] for d in domain_store.list_all()]}",
        )

    raw_slug = slugify(payload.source_id or payload.name or templates.TEMPLATES.get(payload.domain, {}).get("default_name", "regulation"))
    source_id = ensure_unique_source_id(raw_slug)

    reg, flow = templates.build_regulation(
        source_id=source_id,
        domain=payload.domain,
        name=payload.name,
        use_template=payload.use_template,
    )

    # Сохраняем в DuckDB store — это сразу создаст первую запись в history.
    regulation_store.save(reg, author="anonymous", comment="Создан через POST /api/regulations")

    # Стартовый flow в data/flows/ — чтобы Flow Editor сразу открылся с заготовкой.
    if flow.nodes:
        save_flow(source_id, flow, author="anonymous", comment="Starter flow из шаблона домена")

    return reg


# ---- Read / update existing ----


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
def get_regulation_history(source_id: str):
    """История правок самого регламента (имя/параметры/рекомендация) с авто-diff_summary.

    Sync `def`: внутри только sync DuckDB-вызовы. FastAPI выполнит в thread-pool,
    не блокируя event loop. Это правильный паттерн P8 — `async def` без `await`
    давал ложный сигнал «не блокирую event loop».
    """
    return regulation_store.history(source_id)


@router.get("/regulations/{source_id}/regulation-diff/{version_id}")
def get_regulation_diff(source_id: str, version_id: str):
    """Полный структурный diff: что изменилось в этой версии относительно предыдущей."""
    from app.services.regulation_diff import compute_diff

    snap = regulation_store.get_snapshot(source_id, version_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    prev = regulation_store.get_prev_snapshot(source_id, version_id)
    new_reg = Regulation.model_validate(snap)
    old_reg = Regulation.model_validate(prev) if prev else None
    return compute_diff(old_reg, new_reg)


@router.post("/regulations/{source_id}/regulation-restore/{version_id}")
def restore_regulation(source_id: str, version_id: str) -> Regulation:
    reg = regulation_store.restore(source_id, version_id)
    if reg is None:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return reg


@router.post("/regulations/{source_id}/publish")
def publish_regulation(source_id: str) -> Regulation:
    """Перевести регламент в статус active (approval workflow)."""
    reg = regulation_store.get(source_id)
    if reg is None:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    reg.status = "active"
    regulation_store.save(reg, author="anonymous", comment="Опубликован (status → active)")
    return reg


@router.post("/regulations/{source_id}/archive")
def archive_regulation(source_id: str) -> Regulation:
    """Перевести регламент в статус archived."""
    reg = regulation_store.get(source_id)
    if reg is None:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    reg.status = "archived"
    regulation_store.save(reg, author="anonymous", comment="Архивирован (status → archived)")
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


# ── SIGMA Export ──────────────────────────────────────────────────────────


@router.get("/regulations/{source_id}/export-bundle")
async def export_regulation_bundle(source_id: str):
    """Экспорт одного регламента в SIGMA-совместимом ZIP-bundle.

    Содержит `data.ttl` (OWL-инстанс), `shapes.ttl` (SHACL валидация — берём
    пользовательские правки из upstream/фикстуры, fallback на производный
    шаблон) и `manifest.json` (метадата RAGRAF: версия формата, история,
    SIGMA-compliance поля). Подробнее — см. `services/sigma_export.py` и
    README §SIGMA export.

    Returns `application/zip`. Чтобы попасть в bundle, SHACL должны быть
    видимы через `client.get_shapes()` (т.е. либо в upstream, либо в
    фикстуре — это и есть «то что аналитик отредактировал во вкладке
    Ограничения»).
    """
    from fastapi.responses import Response
    from app.services import sigma_export

    try:
        zip_bytes = await sigma_export.build_regulation_bundle(source_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            # Имя файла — `<source_id>-sigma.zip`. Содержит RU-символы? Нет,
            # source_id всегда ASCII slug, экранировать не надо.
            "Content-Disposition": f'attachment; filename="{source_id}-sigma.zip"',
        },
    )


@router.get("/sigma-export/corpus")
async def export_corpus_bundle(domain: str | None = None):
    """Batch-экспорт всего корпуса (или одного домена) в один SIGMA-bundle.

    Параметр `?domain=heating` фильтрует. Без него — весь корпус.
    Внутри ZIP'а — папка на каждый регламент + `corpus_manifest.json` на корне.

    Путь не `/regulations/export-all` (конфликтнул бы с `{source_id}` маршрутом —
    FastAPI смэтчил бы `export-all` как source_id), поэтому отдельный prefix.
    """
    from fastapi.responses import Response
    from app.services import sigma_export

    zip_bytes, _manifest = await sigma_export.build_corpus_bundle(domain=domain)
    suffix = f"-{domain}" if domain else ""
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="ragraf-sigma-corpus{suffix}.zip"',
        },
    )


# ── SIGMA Import (round-trip back from Apache Jena into RAGRAF) ──────────


@router.post("/sigma-import/bundle")
async def import_sigma_bundle(file: UploadFile = File(...)) -> dict[str, Any]:
    """Импорт SIGMA-bundle (ZIP) обратно в RAGRAF.

    Один endpoint обрабатывает оба сценария:
      - Single bundle (один регламент): ZIP с одной папкой `<source_id>/`
        внутри которой `data.ttl` + `shapes.ttl` (+ опционально `manifest.json`).
      - Corpus bundle: несколько таких папок + `corpus_manifest.json` на корне.

    Поведение:
      1. Парсим `data.ttl` → Regulation (через `parse_regulation_turtle`).
         `source_id` берём из `manifest.json` → fallback на имя папки в ZIP.
      2. Сохраняем регламент в DuckDB как обычную правку с автором
         `sigma-import`. History получит запись «Импорт SIGMA-bundle».
      3. Если `shapes.ttl` непустой и upstream доступен — пушим SHACL через
         `client.update_shapes()`. Если upstream не отвечает — мягко
         пропускаем, регламент уже в store; SHACL можно дозалить через UI.

    Возвращает отчёт с категориями `imported / skipped / failed` — UI
    показывает эти счётчики аналитику.
    """
    from app.services import sigma_export

    try:
        body = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось прочитать файл: {e}") from e
    if not body:
        raise HTTPException(status_code=400, detail="Пустой файл")
    try:
        return await sigma_export.import_bundle(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Импорт не удался: {e}") from e


@router.delete("/regulations/{source_id}")
async def delete_regulation(source_id: str, confirm: bool = False) -> dict[str, Any]:
    """Безопасное удаление регламента.

    Защита: требуется явный query-param `?confirm=true`. Без него возвращаем
    400, чтобы случайный DELETE из кода / curl не сносил данные молча.

    Логика:
      1. Удаляем из локального DuckDB store (включая историю версий регламента).
      2. Удаляем `data/flows/{id}.json` + папку `data/versions/{id}/` (flow-история).
      3. Если `WRITEBACK_UPSTREAM=true` — best-effort удаление из upstream Sigma;
         если upstream вернул ошибку (нет регламента / сеть) — НЕ валим
         запрос целиком, локально-то всё уже удалено. Сообщаем в ответе.

    Защита от удаления фикстуры-сидера: если регламент пришёл из фикстуры и
    в DuckDB ещё не редактировался, удаление снесёт его лишь до следующего
    рестарта (где seed повторно засеит). Сообщаем об этом честно.
    """
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Удаление требует подтверждения. Добавь `?confirm=true` к запросу.",
        )

    local_existed = regulation_store.has(source_id)
    fixture_backed = fixtures.has_fixture(source_id)
    if not local_existed and not fixture_backed:
        raise HTTPException(status_code=404, detail=f"Регламент '{source_id}' не найден")

    deleted_from_store = regulation_store.delete(source_id)
    deleted_flow = save_flow_module_delete(source_id)

    upstream_status: str | None = None
    if getattr(settings, "writeback_upstream", False):
        try:
            await client.delete_data(source_id)
            upstream_status = "deleted"
        except Exception as e:
            upstream_status = f"error: {e}"

    return {
        "ok": True,
        "regulation_id": source_id,
        "deleted_from_store": deleted_from_store,
        "deleted_flow_files": deleted_flow,
        "fixture_backed": fixture_backed,
        "upstream_status": upstream_status,
        "note": (
            "Этот регламент пришёл из фикстуры — после рестарта backend'а seed "
            "восстановит его. Чтобы убрать навсегда, удали запись из "
            "backend/app/services/fixtures.py."
            if fixture_backed else None
        ),
    }
