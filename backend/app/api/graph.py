"""Graph View — aggregate regulations into a Cytoscape payload.

Поддерживает фильтр по домену (`?domain=heating`), чтобы Graph View разводил
ЖКХ-регламенты и регламенты Теплоснабжения по отдельным экранам.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from pydantic import BaseModel, Field

from app.adapters.cytoscape_adapter import to_cytoscape
from app.schemas.domain import GraphPayload
from app.services import (
    domain_store,
    fixtures,
    graph_builder,
    module_store,
    ragu_service,
    regulation_store,
    sensor_schema_store,
)
from app.services.regulation_client import client
from app.services.turtle_bridge import parse_regulation_turtle, parse_shapes_turtle

router = APIRouter()


class CreateDomainRequest(BaseModel):
    """Тело `POST /api/domains`.

    Аналитик создаёт новый домен из UI — обычно из пустого состояния анализа
    документа («регламентов нет, давай заведём новый домен»). `suggested_id`
    опционален: если не задан, слаг строится из label.

    `icon` и `color` — выбранная аналитиком SmartCity-иконка и цветовая
    палитра. Соответствуют ID'ам в frontend/src/lib/domains.ts
    DOMAIN_ICONS_REGISTRY и DOMAIN_COLORS_REGISTRY. Опциональны:
    если None, фронт показывает Settings2 + stone.
    """
    label: str = Field(..., min_length=1, max_length=80)
    hint: str | None = Field(default=None, max_length=200)
    suggested_id: str | None = Field(default=None, max_length=40)
    icon: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)


@router.get("/domains")
def list_domains():
    """Список доменов (seed + пользовательские). Используется табами Graph View,
    селектором при создании регламента, валидацией domain-полей."""
    return domain_store.list_all()


@router.post("/domains", status_code=201)
def create_domain(req: CreateDomainRequest):
    """Создать новый пользовательский домен.

    UX: после успеха клиент инвалидирует кэш `['domains']` и обычно открывает
    «Извлечь параметры» с pre-selected новым доменом — чтобы заполнить корпус.
    """
    try:
        return domain_store.create(
            req.label, req.hint or "", req.suggested_id, req.icon, req.color
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/domains/{domain_id}/overview")
def domain_overview(domain_id: str) -> dict[str, object]:
    """Сводка по домену: регламенты + модули-источники + датчики.

    Закрывает обратный поиск «домен → его компоненты». Используется на
    карточке домена (DomainDetailScreen) и для бейджей покрытия (N/M/K).

    Возвращает плоские списки — без вложенных счётчиков, фронт сам рендерит.
    Sensor_subtypes — те, что подключены к модулям этого домена (через
    `sensor_subtypes.module_id → modules.id → modules.domain`). Подтипы
    без `module_id` сюда не попадают (по дизайну — мы хотим показать
    «подключённые», а не «потенциально доступные»).
    """
    # Проверка существования домена не строгая: для seed-доменов и user-доменов
    # одинаково отдаём пустой overview если их нет — UI не падает.
    domain_meta = next(
        (d for d in domain_store.list_all() if d["id"] == domain_id),
        None,
    )

    regs = [
        r for r in regulation_store.list_all() if r.get("domain") == domain_id
    ]
    mods = [
        m.model_dump() for m in module_store.list_all() if m.domain == domain_id
    ]

    # Sensor-subtypes этого домена = подтипы, привязанные к модулям домена.
    # `list_subtypes` не отдаёт module_id (легаси, см. sensor_schema_store
    # строки 702-715), читаем напрямую из БД через шаренный connection.
    module_ids = {m["id"] for m in mods}
    subs = []
    if module_ids:
        with regulation_store._LOCK:
            c = regulation_store._connection()
            rows = c.execute(
                """
                SELECT subtype_id, class_id, label, description, module_id
                FROM sensor_subtypes
                WHERE module_id IN ({})
                ORDER BY class_id, subtype_id
                """.format(",".join("?" * len(module_ids))),
                list(module_ids),
            ).fetchall()
        subs = [
            {
                "subtype_id": r[0],
                "class_id": r[1],
                "label": r[2],
                "description": r[3],
                "module_id": r[4],
            }
            for r in rows
        ]

    return {
        "domain": domain_meta,
        "regulations": regs,
        "modules": mods,
        "sensor_subtypes": subs,
        "coverage": {
            "regulations_count": len(regs),
            "modules_count": len(mods),
            "sensor_subtypes_count": len(subs),
        },
    }


@router.delete("/domains/{domain_id}")
def delete_domain(domain_id: str) -> dict[str, str]:
    """Удалить пользовательский домен. Seed-домены защищены.

    Регламенты, ссылающиеся на этот домен, остаются с прежним domain-значением
    (отображаются в группе «Без домена» после удаления).
    """
    if any(d["id"] == domain_id for d in fixtures.list_domains()):
        raise HTTPException(status_code=409, detail="Этот домен — встроенный, его нельзя удалить")
    if not domain_store.delete(domain_id):
        raise HTTPException(status_code=404, detail=f"Домен '{domain_id}' не найден")
    return {"id": domain_id, "status": "deleted"}


async def _domain_for(source_id: str):
    turtle = await client.get_data(source_id)
    shapes_turtle = ""
    try:
        shapes_turtle = await client.get_shapes(source_id)
    except Exception:
        pass
    reg = parse_regulation_turtle(turtle, source_id, shapes_turtle=shapes_turtle)
    reg.constraints = parse_shapes_turtle(shapes_turtle)
    reg.domain = fixtures.get_domain(source_id)
    return reg


def _dataset_ids(datasets) -> list[str]:
    if isinstance(datasets, list):
        return [str(d.get("id") or d.get("source_id") or d) for d in datasets if d]
    return []


@router.get("/graph")
async def graph_all(domain: str | None = Query(default=None, description="Фильтр по домену")) -> GraphPayload:
    """Граф регламентов. Если задан `domain` — только этот домен."""
    if ragu_service.settings.ragu_enabled and not domain:
        try:
            kg = ragu_service.get_knowledge_graph()
            return to_cytoscape(kg)
        except ragu_service.RaguDisabled:
            pass

    try:
        datasets = await client.list_datasets()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e

    ids = _dataset_ids(datasets)
    if domain:
        ids = [i for i in ids if fixtures.get_domain(i) == domain]
    if not ids:
        return GraphPayload(nodes=[], edges=[], meta={"total_nodes": 0, "total_edges": 0})

    regs = await asyncio.gather(*[_domain_for(i) for i in ids], return_exceptions=True)
    subs = [graph_builder.regulation_to_subgraph(r) for r in regs if not isinstance(r, Exception)]
    return graph_builder.merge_graphs(subs)


@router.get("/graph/regulation/{regulation_id}")
async def graph_one(regulation_id: str) -> GraphPayload:
    try:
        reg = await _domain_for(regulation_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    return graph_builder.regulation_to_subgraph(reg)
