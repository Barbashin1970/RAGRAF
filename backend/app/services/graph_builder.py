"""Build a Cytoscape-ready graph view from regulations + flow data.

Used when RAGU is disabled / not installed — provides a deterministic graph
straight from domain objects so the frontend has something to render.

Все Cy-узлы помечаются `domain` — это поле использует frontend GraphView чтобы
показывать домены отдельно (Теплоснабжение / Управление ЖКХ / …), а не
склеивать в одну кашу.
"""
from __future__ import annotations

from app.schemas.domain import (
    CyEdge,
    CyEdgeData,
    CyNode,
    CyNodeData,
    GraphPayload,
    Regulation,
)


def _short_label(text: str | None, max_len: int = 64) -> str:
    """Сокращает строку до max_len по последней границе слова, добавляя «…».

    Без urlanке посередине слова: ищем последний пробел до max_len и режем там.
    Висячие знаки препинания (`. , ; :`) убираем перед многоточием.
    Пустые/короткие строки возвращаем как есть.
    """
    s = (text or "").strip()
    if not s or len(s) <= max_len:
        return s
    cut = s.rfind(" ", 0, max_len)
    if cut <= 0:
        cut = max_len
    return s[:cut].rstrip(",.;:!?-") + "…"


def regulation_to_subgraph(reg: Regulation) -> GraphPayload:
    nodes: list[CyNode] = []
    edges: list[CyEdge] = []
    dom = reg.domain

    # Regulation root
    reg_id = f"reg:{reg.id}"
    nodes.append(
        CyNode(
            data=CyNodeData(
                id=reg_id,
                label=_short_label(reg.name, max_len=72),
                type="Regulation",
                description=f"{reg.name}\nВерсия {reg.version}",
                regulation_id=reg.id,
                domain=dom,
            )
        )
    )

    for p in reg.parameters:
        pid = f"param:{reg.id}:{p.id}"
        nodes.append(
            CyNode(
                data=CyNodeData(
                    id=pid,
                    label=p.name,
                    type="Parameter",
                    description=p.unit or None,
                    regulation_id=reg.id,
                    domain=dom,
                )
            )
        )
        edges.append(
            CyEdge(
                data=CyEdgeData(
                    id=f"{reg_id}__has__{pid}",
                    source=reg_id,
                    target=pid,
                    label="has_parameter",
                )
            )
        )

    for c in reg.constraints:
        cid = f"constr:{reg.id}:{c.id}"
        constraint_label = _short_label(c.message or c.path, max_len=64)
        bounds_parts: list[str] = []
        if c.minInclusive is not None:
            bounds_parts.append(f"≥ {c.minInclusive}")
        if c.maxInclusive is not None:
            bounds_parts.append(f"≤ {c.maxInclusive}")
        if c.minCount is not None:
            bounds_parts.append(f"minCount {c.minCount}")
        desc_parts = [c.message] if c.message else []
        if bounds_parts:
            desc_parts.append(", ".join(bounds_parts))
        desc_parts.append(f"путь: {c.path}")
        desc_parts.append(f"severity: {c.severity}")
        nodes.append(
            CyNode(
                data=CyNodeData(
                    id=cid,
                    label=constraint_label,
                    type="Constraint",
                    description="\n".join(desc_parts),
                    regulation_id=reg.id,
                    domain=dom,
                )
            )
        )
        edges.append(
            CyEdge(
                data=CyEdgeData(
                    id=f"{reg_id}__applies__{cid}",
                    source=reg_id,
                    target=cid,
                    label="applies_constraint",
                )
            )
        )

    for r in reg.recommendations:
        rid = f"rec:{reg.id}:{r.id}"
        # На холсте — короткий человечный заголовок; полный текст идёт в description,
        # frontend GraphView рендерит description как многострочный body.
        short_label = _short_label(r.text, max_len=64) or f"Рекомендация {r.priority}"
        nodes.append(
            CyNode(
                data=CyNodeData(
                    id=rid,
                    label=short_label,
                    type="Recommendation",
                    description=f"Приоритет {r.priority}\n\n{r.text}",
                    regulation_id=reg.id,
                    domain=dom,
                )
            )
        )
        for p_ref in r.linkedParameters:
            edges.append(
                CyEdge(
                    data=CyEdgeData(
                        id=f"{rid}__triggers__param:{reg.id}:{p_ref}",
                        source=rid,
                        target=f"param:{reg.id}:{p_ref}",
                        label="triggers",
                    )
                )
            )

    return GraphPayload(
        nodes=nodes,
        edges=edges,
        meta={"total_nodes": len(nodes), "total_edges": len(edges)},
    )


def merge_graphs(graphs: list[GraphPayload]) -> GraphPayload:
    seen_nodes: dict[str, CyNode] = {}
    seen_edges: dict[str, CyEdge] = {}
    for g in graphs:
        for n in g.nodes:
            seen_nodes.setdefault(n.data.id, n)
        for e in g.edges:
            seen_edges.setdefault(e.data.id, e)
    nodes = list(seen_nodes.values())
    edges = list(seen_edges.values())
    return GraphPayload(
        nodes=nodes,
        edges=edges,
        meta={"total_nodes": len(nodes), "total_edges": len(edges)},
    )
