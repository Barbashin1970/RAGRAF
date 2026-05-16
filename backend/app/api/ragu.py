"""RAGU Studio endpoints — каталог системных промптов RAGU + overrides.

Сценарий: аналитик заходит в раздел «RAGU Studio», видит все 18 промптов
библиотеки (extraction / search / summarization), может посмотреть default
content, переписать его, сохранить → следующий /api/search применит override
через `RaguGenerativeModule.update_prompt`. Возврат к дефолту — DELETE.

Также `/api/ragu/config` — read-only снепшот builder/settings/models для
debug-панели. Не trigger'ит инициализацию KG, безопасен для read'а.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import ragu_prompts

router = APIRouter()


class PromptOverrideRequest(BaseModel):
    """Тело `PUT /api/ragu/prompts/{name}`."""
    template: str = Field(..., min_length=1, description="Полный Jinja2-текст промпта")
    role: str = Field("user", pattern="^(user|system|ai)$")
    comment: str | None = Field(None, max_length=500)


@router.get("/ragu/prompts")
def list_prompts() -> dict[str, Any]:
    """Каталог всех RAGU-промптов + статус override'ов.

    Если RAGU не установлен — пустой список + `available=false`. UI должен
    показать onboarding-плашку «установите graph_ragu».
    """
    return {
        "available": ragu_prompts.is_available(),
        "prompts": ragu_prompts.list_prompts(),
    }


@router.get("/ragu/prompts/{name}")
def get_prompt(name: str) -> dict[str, Any]:
    """Полный default + override (если есть) одного промпта."""
    data = ragu_prompts.get_prompt(name)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Промпт '{name}' не найден")
    return data


@router.put("/ragu/prompts/{name}")
def put_prompt_override(name: str, req: PromptOverrideRequest) -> dict[str, Any]:
    """Сохранить override промпта. Применяется на следующем `/api/search`."""
    try:
        ov = ragu_prompts.set_override(name, req.template, role=req.role, comment=req.comment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "override": ov}


@router.delete("/ragu/prompts/{name}")
def delete_prompt_override(name: str) -> dict[str, Any]:
    """Удалить override — следующий запрос возьмёт RAGU-default."""
    if not ragu_prompts.delete_override(name):
        raise HTTPException(status_code=404, detail=f"Override для '{name}' не найден")
    return {"ok": True, "name": name, "status": "restored_to_default"}


@router.get("/ragu/config")
def get_config() -> dict[str, Any]:
    """Read-only снепшот BuilderArguments + Settings + моделей.

    Используется UI как debug-панель «что сейчас настроено в RAGU».
    """
    return ragu_prompts.builder_config_snapshot()
