"""Sandbox endpoints — демо-фичи поверх RAGU (mock или real)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import fixtures, regulation_store, sandbox, templates
from app.services.flow_storage import save_flow
from app.services.templates import ensure_unique_source_id, slugify

router = APIRouter()


class SearchRequest(BaseModel):
    query: str = Field(..., description="Запрос на естественном языке")
    top_k: int = Field(5, ge=1, le=20)


class ExtractRequest(BaseModel):
    text: str = Field(..., description="Сырой текст регламента (фрагмент Постановления, описание и т.п.)")


class ExtractedParamPayload(BaseModel):
    """Один параметр из результата `/sandbox/extract-parameters` для последующей сборки регламента."""
    suggested_name: str = Field(..., min_length=1)
    value: float
    deviation: float | None = None
    unit: str | None = None


class CreateFromParamsRequest(BaseModel):
    """Тело `POST /api/sandbox/create-from-params`.

    Третий шаг песочницы: «текст → извлечённые параметры → регламент».
    """
    name: str = Field(..., min_length=1, max_length=200)
    domain: str = Field(..., description="ID домена (heating / housing / safety / environment)")
    params: list[ExtractedParamPayload] = Field(..., min_length=1)


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


@router.post("/sandbox/create-from-params", status_code=201)
def sandbox_create_from_params(req: CreateFromParamsRequest) -> dict[str, Any]:
    """Собрать регламент из выбранных пользователем параметров.

    Замыкает цикл песочницы: текст → извлечённые параметры → регламент.
    Сохраняется в DuckDB (создаётся первая запись в history) + starter flow
    в `data/flows/`. Клиент после успеха переходит в `/regulations/:id/edit`,
    чтобы пользователь уточнил пороги и допилил Flow Editor.
    """
    valid_domains = {d["id"] for d in fixtures.list_domains()}
    if req.domain not in valid_domains:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестный домен '{req.domain}'. Доступны: {sorted(valid_domains)}",
        )

    source_id = ensure_unique_source_id(slugify(req.name))
    try:
        reg, flow = templates.build_regulation_from_params(
            source_id=source_id,
            domain=req.domain,
            name=req.name,
            extracted=[p.model_dump() for p in req.params],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    regulation_store.save(
        reg,
        author="anonymous",
        comment="Создан через песочницу из извлечённых параметров",
    )
    if flow.nodes:
        save_flow(source_id, flow, author="anonymous", comment="Starter flow из песочницы")

    return {
        "regulation_id": source_id,
        "name": reg.name,
        "domain": reg.domain,
        "parameters_count": len(reg.parameters),
    }
