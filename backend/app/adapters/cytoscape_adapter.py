"""Convert RAGU KnowledgeGraph → Cytoscape.js payload.

Pure adapter, no RAGU import at module level — RAGU's runtime objects are
duck-typed (any object with `.get_all_entities()` / `.get_all_relations()`).
"""
from __future__ import annotations

from typing import Any

from app.schemas.domain import (
    CyEdge,
    CyEdgeData,
    CyNode,
    CyNodeData,
    GraphPayload,
)


def to_cytoscape(knowledge_graph: Any) -> GraphPayload:
    nodes: list[CyNode] = []
    edges: list[CyEdge] = []

    for entity in knowledge_graph.get_all_entities():
        nodes.append(
            CyNode(
                data=CyNodeData(
                    id=str(entity.id),
                    label=str(getattr(entity, "name", entity.id)),
                    type=str(getattr(entity, "entity_type", "Entity")),
                    description=getattr(entity, "description", None),
                    regulation_id=getattr(entity, "regulation_id", None),
                )
            )
        )

    for relation in knowledge_graph.get_all_relations():
        src = str(getattr(relation, "source_id", ""))
        tgt = str(getattr(relation, "target_id", ""))
        if not src or not tgt:
            continue
        edges.append(
            CyEdge(
                data=CyEdgeData(
                    id=f"{src}__{tgt}",
                    source=src,
                    target=tgt,
                    label=str(getattr(relation, "relation_type", "")),
                    weight=getattr(relation, "confidence", None),
                )
            )
        )

    return GraphPayload(
        nodes=nodes,
        edges=edges,
        meta={"total_nodes": len(nodes), "total_edges": len(edges)},
    )
