"""SHACL constraints — read/write via upstream `/shapes`, plus import/export Turtle."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from app.schemas.domain import Constraint
from app.services.regulation_client import client
from app.services.turtle_bridge import constraints_to_shacl_turtle, parse_shapes_turtle

router = APIRouter()


@router.get("/regulations/{regulation_id}/constraints")
async def get_constraints(regulation_id: str) -> list[Constraint]:
    try:
        turtle = await client.get_shapes(regulation_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    return parse_shapes_turtle(turtle)


@router.put("/regulations/{regulation_id}/constraints")
async def put_constraints(regulation_id: str, constraints: list[Constraint]) -> dict[str, int]:
    turtle = constraints_to_shacl_turtle(constraints)
    try:
        await client.update_shapes(regulation_id, turtle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    return {"count": len(constraints)}


@router.get(
    "/regulations/{regulation_id}/shacl/export",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/turtle": {}}}},
)
async def export_shacl(regulation_id: str) -> str:
    try:
        return await client.get_shapes(regulation_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e


@router.post("/regulations/{regulation_id}/shacl/import")
async def import_shacl(regulation_id: str, file: UploadFile = File(...)) -> dict:
    """Импорт SHACL Turtle: парсим, мерджим с текущими, возвращаем conflict-репорт."""
    body = (await file.read()).decode("utf-8", errors="ignore")
    incoming = parse_shapes_turtle(body)

    try:
        current_turtle = await client.get_shapes(regulation_id)
    except Exception:
        current_turtle = ""
    current = parse_shapes_turtle(current_turtle)

    by_id = {c.id: c for c in current}
    conflicts: list[dict] = []
    for c in incoming:
        if c.id in by_id and by_id[c.id] != c:
            conflicts.append({"id": c.id, "existing": by_id[c.id].model_dump(), "incoming": c.model_dump()})
        by_id[c.id] = c  # last-write-wins; conflicts reported

    merged = list(by_id.values())
    turtle = constraints_to_shacl_turtle(merged)
    try:
        await client.update_shapes(regulation_id, turtle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e

    return {"merged_constraints": len(merged), "conflicts": conflicts}
