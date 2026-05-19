"""REST для Process — цифрового двойника процесса управления.

Process — именованная коллекция регламентов; страница «Цифровой двойник»
в UI собирает 2-N регламентов в одну операционную картину для просмотра
графа цепочки, симуляции и экспорта артефактов.

Endpoints:
  GET    /api/processes            — список всех двойников
  GET    /api/processes/{id}       — один двойник
  POST   /api/processes            — создать
  PUT    /api/processes/{id}       — обновить
  DELETE /api/processes/{id}       — удалить

Экспорт артефактов:
  GET    /api/processes/{id}/bundle.zip   — ZIP с N data.ttl + shapes.ttl + manifest
  GET    /api/processes/{id}/turtle       — объединённый Turtle всех регламентов
                                            в одном text/plain файле (для быстрого
                                            просмотра/копирования)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, Response

from app.schemas.domain import Process
from app.services import process_store, regulation_store, sigma_export
from app.services.turtle_bridge import regulation_to_turtle

router = APIRouter()


def _validate_wiring(payload: Process) -> None:
    """Жёсткая валидация Twin.wiring перед save'ом.

    Бизнес-инварианты (см. ProcessWiringEntry docstring):
      1. target_regulation и source_regulation — оба в regulation_ids Twin'а.
      2. target_regulation != source_regulation (само-ссылка запрещена).
      3. Ни одна пара (target_regulation, target_param_ref) не повторяется
         внутри wiring одного Twin'а — иначе projection в flow.json двойственна.
      4. Все строковые ID непустые.
      5. Если regulation_ids пуст — wiring должен быть пуст (нечем связывать).

    Конфликт-детект между разными Twin'ами — отдельной валидации, не здесь:
    она вызывается только в update_process (через find_wiring_owners).
    """
    members = set(payload.regulation_ids or [])

    if (payload.wiring or []) and not members:
        raise HTTPException(
            status_code=400,
            detail="Двойник без регламентов не может иметь связей. Добавьте регламенты в состав.",
        )

    seen_targets: set[tuple[str, str]] = set()
    for i, w in enumerate(payload.wiring or []):
        prefix = f"wiring[{i}]"
        # 4. non-empty.
        if not w.target_regulation or not w.target_param_ref or not w.source_regulation:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation, target_param_ref и source_regulation обязательны (непустые строки).",
            )
        # 1. members.
        if w.target_regulation not in members:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation '{w.target_regulation}' не входит в regulation_ids двойника.",
            )
        if w.source_regulation not in members:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: source_regulation '{w.source_regulation}' не входит в regulation_ids двойника.",
            )
        # 2. self-ref.
        if w.target_regulation == w.source_regulation:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation == source_regulation ({w.target_regulation}). Само-ссылка не имеет смысла.",
            )
        # 3. unique target.
        key = (w.target_regulation, w.target_param_ref)
        if key in seen_targets:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: дубликат связи на ({w.target_regulation}, {w.target_param_ref}). Один параметр = максимум один источник.",
            )
        seen_targets.add(key)


def _drop_orphan_wiring(payload: Process) -> None:
    """Авто-удаление wiring-записей, ссылающихся на регламенты, которых
    больше нет в regulation_ids.

    UX: пользователь убрал регламент из состава — wiring на него уже не
    имеет смысла. Не отклоняем save с 400, а тихо чистим (вызывается ДО
    _validate_wiring). Иначе аналитика бы заставляли два раза кликать:
    «убрать связь, потом убрать регламент».
    """
    members = set(payload.regulation_ids or [])
    payload.wiring = [
        w for w in (payload.wiring or [])
        if w.target_regulation in members and w.source_regulation in members
    ]


@router.get("/processes")
def list_processes() -> list[Process]:
    """Все двойники, последние правки сверху."""
    return process_store.list_all()


@router.get("/processes/{process_id}")
def get_process(process_id: str) -> Process:
    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    return p


@router.post("/processes", status_code=201)
def create_process(payload: Process) -> Process:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Имя двойника обязательно")
    _validate_wiring(payload)
    # Игнорируем входящий id для POST — генерим сами в store (uuid12).
    payload.id = ""
    saved = process_store.save(payload)
    if saved.wiring:
        try:
            process_store.project_wiring_to_flows(saved, previous_wiring=[])
        except Exception:
            pass
    return saved


@router.put("/processes/{process_id}")
def update_process(process_id: str, payload: Process) -> Process:
    existing = process_store.get(process_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    payload.id = process_id

    # PUT: тихо чистим wiring-записи, чьи регламенты пользователь снял из
    # состава. Это даёт «one-click remove member» в UI Twin Editor'а:
    # убираем регламент → wiring на него уходит вместе. Остальные ошибки
    # (новые записи на не-членов, дубликаты, self-ref) валидатор отбивает.
    _drop_orphan_wiring(payload)
    _validate_wiring(payload)

    # Конфликт-детект: проверяем что новый wiring не нарушает «1 регламент.param =
    # 1 twin владеет» (см. ProcessWiringEntry docstring). Если другой Twin уже
    # владеет той же парой (target_regulation, target_param_ref) — 409 Conflict.
    for w in payload.wiring or []:
        owners = process_store.find_wiring_owners(w.target_regulation, w.target_param_ref)
        # Текущий Twin сам себя видеть может (если поле было уже в его wiring) —
        # отфильтровываем. Если есть другие — конфликт.
        other_owners = [o for o in owners if o != process_id]
        if other_owners:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Регламент '{w.target_regulation}' (параметр '{w.target_param_ref}') "
                    f"уже подключён в другом Двойнике: {', '.join(other_owners)}. "
                    f"Удалите wiring там или используйте другой параметр."
                ),
            )

    previous = existing.wiring or []
    saved = process_store.save(payload)
    try:
        process_store.project_wiring_to_flows(saved, previous_wiring=previous)
    except Exception:
        pass
    return saved


@router.delete("/processes/{process_id}")
def delete_process(process_id: str) -> dict[str, Any]:
    # Перед удалением — снимаем проекцию wiring с flow.json членов, чтобы
    # «битые» source-ссылки не оставались висеть в регламентах.
    existing = process_store.get(process_id)
    if existing is not None and existing.wiring:
        cleared = Process(
            id=existing.id, name=existing.name, description=existing.description,
            regulation_ids=existing.regulation_ids, wiring=[],
        )
        try:
            process_store.project_wiring_to_flows(cleared, previous_wiring=existing.wiring)
        except Exception:
            pass
    deleted = process_store.delete(process_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    return {"ok": True, "process_id": process_id}


# ── Экспорт артефактов ────────────────────────────────────────────────


@router.get("/processes/{process_id}/bundle.zip")
async def export_process_bundle(process_id: str):
    """Экспорт двойника в SIGMA-bundle ZIP (N регламентов).

    Структура: одна папка на каждый regulation_id с data.ttl + shapes.ttl +
    manifest.json; на корне `corpus_manifest.json` с метой двойника.
    Переиспользует `sigma_export.build_corpus_bundle` с whitelist'ом.
    """
    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    if not p.regulation_ids:
        raise HTTPException(
            status_code=400,
            detail="Двойник пуст — добавьте хотя бы один регламент перед экспортом",
        )
    zip_bytes, _manifest = await sigma_export.build_corpus_bundle(
        regulation_ids=p.regulation_ids,
    )
    safe_name = (p.name or process_id).replace(" ", "-")[:80]
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="twin-{safe_name}.zip"',
        },
    )


@router.get("/processes/{process_id}/turtle", response_class=PlainTextResponse)
def export_process_turtle(process_id: str) -> str:
    """Объединённый Turtle всех регламентов двойника — одним текстовым файлом.

    Удобно для копирования в Apache Jena / Protégé / online OWL-инструменты,
    где ZIP неудобен. Каждый регламент идёт со своим префиксным разделителем-
    комментарием для читаемости.
    """
    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    chunks: list[str] = []
    chunks.append(f"# Twin: {p.name}")
    if p.description:
        chunks.append(f"# {p.description}")
    chunks.append(f"# Регламентов: {len(p.regulation_ids)}")
    chunks.append("")
    for rid in p.regulation_ids:
        reg = regulation_store.get(rid)
        if reg is None:
            chunks.append(f"# !! Регламент '{rid}' не найден, пропущен")
            continue
        chunks.append(f"# ──────────── {rid} ────────────")
        chunks.append(regulation_to_turtle(reg))
        chunks.append("")
    return "\n".join(chunks)
