"""Validate a Rule DSL — runs the 7 checks in services/validator.py."""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.domain import RuleDSL, ValidationResult
from app.services.regulation_client import client
from app.services.turtle_bridge import parse_regulation_turtle
from app.services.validator import validate_dsl

router = APIRouter()


@router.post("/regulations/{regulation_id}/validate")
async def validate(regulation_id: str, dsl: RuleDSL) -> ValidationResult:
    parameters = []
    try:
        turtle = await client.get_data(regulation_id)
        shapes_turtle = ""
        try:
            shapes_turtle = await client.get_shapes(regulation_id)
        except Exception:
            pass
        parameters = parse_regulation_turtle(
            turtle, regulation_id, shapes_turtle=shapes_turtle
        ).parameters
    except Exception:
        # If upstream is unreachable, validate without parameter checks
        pass
    return validate_dsl(dsl, parameters=parameters)
