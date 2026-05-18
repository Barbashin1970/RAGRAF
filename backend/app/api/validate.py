"""Validate a Rule DSL — runs the 8 checks in services/validator.py."""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.domain import RuleDSL, ValidationResult
from app.services import regulation_store
from app.services.regulation_client import client
from app.services.turtle_bridge import parse_regulation_turtle, parse_shapes_turtle
from app.services.validator import validate_dsl

router = APIRouter()


@router.post("/regulations/{regulation_id}/validate")
async def validate(regulation_id: str, dsl: RuleDSL) -> ValidationResult:
    # Сначала DuckDB-store (приоритет), затем upstream-фикстура.
    parameters = []
    constraints = []
    stored = regulation_store.get(regulation_id)
    if stored is not None:
        parameters = stored.parameters
        constraints = stored.constraints
    if not parameters:
        try:
            turtle = await client.get_data(regulation_id)
            shapes_turtle = ""
            try:
                shapes_turtle = await client.get_shapes(regulation_id)
            except Exception:
                pass
            parsed = parse_regulation_turtle(
                turtle, regulation_id, shapes_turtle=shapes_turtle
            )
            parameters = parsed.parameters
            if shapes_turtle:
                constraints = parse_shapes_turtle(shapes_turtle)
        except Exception:
            pass
    # Constraints из shapes для проверки constraintRef в SHACL-нодах.
    if not constraints:
        try:
            shapes_turtle = await client.get_shapes(regulation_id)
            constraints = parse_shapes_turtle(shapes_turtle)
        except Exception:
            pass
    return validate_dsl(dsl, parameters=parameters, constraints=constraints)
