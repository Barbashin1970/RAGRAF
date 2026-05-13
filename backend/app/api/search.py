"""Semantic search via RAGU. Returns 503 when RAGU disabled."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import SearchRequest, SearchResponse
from app.services import ragu_service

router = APIRouter()


@router.post("/search")
def search(req: SearchRequest) -> SearchResponse:
    """Sync — ragu_service.search() синхронный (RAGU engines не async).
    FastAPI выполнит в thread-pool."""
    try:
        result = ragu_service.search(req.query, req.mode)
    except ragu_service.RaguDisabled as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return SearchResponse(
        response=str(result.get("response", "")),
        entities=[],  # could map result["entities"] when RAGU types stabilise
        sources=result.get("sources", []),
    )
