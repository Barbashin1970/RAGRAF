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
    # Игнорируем входящий id для POST — генерим сами в store (uuid12).
    payload.id = ""
    return process_store.save(payload)


@router.put("/processes/{process_id}")
def update_process(process_id: str, payload: Process) -> Process:
    existing = process_store.get(process_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    payload.id = process_id
    return process_store.save(payload)


@router.delete("/processes/{process_id}")
def delete_process(process_id: str) -> dict[str, Any]:
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
