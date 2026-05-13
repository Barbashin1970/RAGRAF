"""Pydantic models — request/response shape for the RAGRAF API layer.

Mirrors the TypeScript domain in regulation-viz-skill.md § Domain Model.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Core domain --------------------------------------------------------


class Parameter(BaseModel):
    id: str
    name: str
    datatype: Literal["decimal", "string", "date", "boolean"] = "decimal"
    referenceValue: float | None = None
    minInclusive: float | None = None
    maxInclusive: float | None = None
    deviationAllowed: float | None = None
    unit: str | None = None


class Constraint(BaseModel):
    id: str
    targetClass: str = "Regulation"
    path: str
    datatype: str | None = None
    minCount: int | None = None
    maxCount: int | None = None
    minInclusive: float | None = None
    maxInclusive: float | None = None
    pattern: str | None = None
    message: str | None = None
    severity: Literal["violation", "warning", "info"] = "violation"


class ConditionExpression(BaseModel):
    operator: str
    left: str
    right: float | str | None = None


class Recommendation(BaseModel):
    id: str
    condition: ConditionExpression | None = None
    text: str
    priority: Literal[1, 2, 3] = 2
    linkedParameters: list[str] = Field(default_factory=list)


class Regulation(BaseModel):
    id: str
    name: str
    domain: str | None = None  # smysl domain ID: "heating", "housing", ...
    date: str | None = None
    version: str = "1.0"
    status: Literal["active", "draft", "archived"] = "draft"
    parameters: list[Parameter] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)


# --- Rule DSL -----------------------------------------------------------


NodeKind = Literal[
    "input", "threshold", "compare", "formula", "switch", "output", "shacl_constraint"
]


class FlowNode(BaseModel):
    id: str
    type: NodeKind
    label: str | None = None
    position: dict[str, float] | None = None  # {x, y}
    # type-specific config — kept loose so node types stay extensible
    paramRef: str | None = None
    refValue: float | None = None
    deviation: float | None = None
    operator: str | None = None
    expression: str | None = None
    cases: list[dict[str, Any]] | None = None
    action: str | None = None
    text: str | None = None
    priority: int | None = None
    constraintRef: str | None = None
    unit: str | None = None


class FlowEdge(BaseModel):
    source: str
    target: str
    condition: str | None = None


class RuleDSL(BaseModel):
    rule_id: str
    regulation_id: str
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)


# --- Validation ---------------------------------------------------------


class ValidationError(BaseModel):
    nodeId: str | None = None
    edgeId: str | None = None
    code: str
    message: str
    severity: Literal["error", "warning"] = "error"


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationError] = Field(default_factory=list)


# --- Versioning ---------------------------------------------------------


class FlowVersion(BaseModel):
    version_id: str
    regulation_id: str
    created_at: str
    author: str = "anonymous"
    comment: str | None = None
    dsl_snapshot: RuleDSL
    diff_summary: str | None = None


# --- Graph (Cytoscape) --------------------------------------------------


class CyNodeData(BaseModel):
    id: str
    label: str
    type: str
    description: str | None = None
    regulation_id: str | None = None
    domain: str | None = None  # for client-side filtering / grouping


class CyEdgeData(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None
    weight: float | None = None


class CyNode(BaseModel):
    data: CyNodeData


class CyEdge(BaseModel):
    data: CyEdgeData


class GraphPayload(BaseModel):
    nodes: list[CyNode]
    edges: list[CyEdge]
    meta: dict[str, int] = Field(default_factory=dict)


# --- Search (RAGU) ------------------------------------------------------


class SearchRequest(BaseModel):
    query: str
    mode: Literal["local", "global", "naive"] = "local"


class SearchHit(BaseModel):
    id: str
    label: str
    type: str | None = None
    score: float | None = None


class SearchResponse(BaseModel):
    response: str
    entities: list[SearchHit] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)
