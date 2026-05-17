"""REST для словаря rules-based извлечения параметров.

Endpoints:
  GET    /api/extraction-terms          — все термины
  PUT    /api/extraction-terms/{stem}   — добавить/обновить
  DELETE /api/extraction-terms/{stem}   — удалить
  POST   /api/extraction-terms/reseed   — сбросить к дефолтному набору

UI «Словарь терминов» в RegulationExtractScreen вызывает их для пополнения
словаря «нераспознанными» словами, которые аналитик увидел в тексте.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import ExtractionTerm
from app.services import extraction_term_store

router = APIRouter()


@router.get("/extraction-terms")
def get_all() -> list[ExtractionTerm]:
    return extraction_term_store.list_all()


@router.put("/extraction-terms/{stem}")
def put_term(stem: str, payload: ExtractionTerm) -> ExtractionTerm:
    if payload.stem != stem:
        raise HTTPException(
            status_code=400,
            detail=f"stem в теле ({payload.stem}) не совпадает с URL ({stem})",
        )
    if not payload.stem.strip():
        raise HTTPException(status_code=400, detail="stem не может быть пустым")
    if not payload.parameter_name.strip():
        raise HTTPException(status_code=400, detail="parameter_name не может быть пустым")
    # Если аналитик редактирует — помечаем source=user. Seed остаётся seed
    # только пока не тронули.
    if payload.source != "user":
        payload = payload.model_copy(update={"source": "user"})
    return extraction_term_store.upsert(payload)


@router.delete("/extraction-terms/{stem}")
def remove_term(stem: str) -> dict[str, object]:
    existed = extraction_term_store.delete(stem)
    if not existed:
        raise HTTPException(status_code=404, detail=f"Термин '{stem}' не найден")
    return {"ok": True, "stem": stem}


@router.post("/extraction-terms/reseed")
def reseed() -> dict[str, object]:
    count = extraction_term_store.reseed()
    return {"ok": True, "terms_seeded": count}
