"""Sandbox endpoints — демо-фичи поверх RAGU (mock или real)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import sandbox

router = APIRouter()


class SearchRequest(BaseModel):
    query: str = Field(..., description="Запрос на естественном языке")
    top_k: int = Field(5, ge=1, le=20)


class ExtractRequest(BaseModel):
    text: str = Field(..., description="Сырой текст регламента (фрагмент Постановления, описание и т.п.)")


@router.get("/sandbox/status")
def sandbox_status() -> dict[str, Any]:
    """Текущий режим работы песочницы — mock или real (RAGU)."""
    return {
        "mode": sandbox.backend_mode(),
        "real_available": sandbox.is_real_ragu_available(),
        "demos": ["semantic-search", "extract-parameters"],
        "backlog": ["knowledge-graph", "compare-regulations"],
    }


@router.post("/sandbox/search")
def sandbox_search(req: SearchRequest) -> dict[str, Any]:
    """Семантический поиск по регламентам.

    Mock-режим: keyword scoring (name×3 + domain×2 + params×2 + recommendation×1).
    Возвращает список { regulation_id, regulation_name, domain, score, matched_terms, snippet }.
    """
    results = sandbox.semantic_search(req.query, top_k=req.top_k)
    return {
        "query": req.query,
        "mode": sandbox.backend_mode(),
        "results": results,
    }


@router.post("/sandbox/extract-parameters")
def sandbox_extract_parameters(req: ExtractRequest) -> dict[str, Any]:
    """Извлечь параметры из произвольного текста регламента.

    Mock-режим: regex по `число [± deviation] единица` + контекстный словарь
    (давление → pressure, температура → temperature и т.п.).
    """
    found = sandbox.extract_parameters(req.text)
    return {
        "mode": sandbox.backend_mode(),
        "extracted": found,
        "count": len(found),
    }
