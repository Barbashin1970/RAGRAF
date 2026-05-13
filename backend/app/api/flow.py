"""Rule DSL flow — load/save the visual rule for a regulation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import RuleDSL
from app.services import fixtures
from app.services.flow_storage import load_flow, save_flow

router = APIRouter()


@router.get("/regulations/{regulation_id}/flow")
async def get_flow(regulation_id: str) -> RuleDSL:
    """Загрузить сохранённый flow; если нет — отдать стартовый из фикстуры
    (когда для регламента есть `.flow.json`); иначе — пустой каркас."""
    dsl = load_flow(regulation_id)
    if dsl is not None:
        return dsl
    starter = fixtures.read_flow(regulation_id)
    if starter:
        return RuleDSL.model_validate_json(starter)
    return RuleDSL(rule_id=f"rule_{regulation_id}", regulation_id=regulation_id)


@router.put("/regulations/{regulation_id}/flow")
async def put_flow(regulation_id: str, dsl: RuleDSL) -> dict[str, str]:
    if dsl.regulation_id != regulation_id:
        raise HTTPException(status_code=400, detail="regulation_id в теле не совпадает с URL")
    version = save_flow(regulation_id, dsl)
    return {"ok": "true", "version": version.version_id}
