// Typed REST client for the RAGRAF backend (FastAPI at /api/*).
// Shapes mirror backend/app/schemas/domain.py.

export type NodeKind =
  | 'input' | 'threshold' | 'compare' | 'formula' | 'switch' | 'output' | 'shacl_constraint'

export interface FlowNode {
  id: string
  type: NodeKind
  label?: string | null
  position?: { x: number; y: number } | null
  paramRef?: string | null
  refValue?: number | null
  deviation?: number | null
  operator?: string | null
  expression?: string | null
  cases?: Array<{ label: string; value: unknown }> | null
  action?: string | null
  text?: string | null
  priority?: number | null
  constraintRef?: string | null
  unit?: string | null
}
export interface FlowEdge {
  source: string
  target: string
  condition?: string | null
}
export interface RuleDSL {
  rule_id: string
  regulation_id: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface Parameter {
  id: string
  name: string
  datatype: 'decimal' | 'string' | 'date' | 'boolean'
  referenceValue?: number | null
  minInclusive?: number | null
  maxInclusive?: number | null
  deviationAllowed?: number | null
  unit?: string | null
}

export interface Constraint {
  id: string
  targetClass: string
  path: string
  datatype?: string | null
  minCount?: number | null
  maxCount?: number | null
  minInclusive?: number | null
  maxInclusive?: number | null
  pattern?: string | null
  message?: string | null
  severity: 'violation' | 'warning' | 'info'
}

export interface Regulation {
  id: string
  name: string
  domain?: string | null
  date?: string | null
  version: string
  status: 'active' | 'draft' | 'archived'
  parameters: Parameter[]
  constraints: Constraint[]
  recommendations: Array<{
    id: string
    text: string
    priority: 1 | 2 | 3
    linkedParameters: string[]
  }>
}

export interface Domain {
  id: string
  label: string
}

export interface ValidationError {
  nodeId?: string | null
  edgeId?: string | null
  code: string
  message: string
  severity: 'error' | 'warning'
}
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface FlowVersion {
  version_id: string
  regulation_id: string
  created_at: string
  author: string
  comment?: string | null
  dsl_snapshot: RuleDSL
  diff_summary?: string | null
}

export interface CyNode { data: { id: string; label: string; type: string; description?: string | null; regulation_id?: string | null; domain?: string | null } }
export interface CyEdge { data: { id: string; source: string; target: string; label?: string | null; weight?: number | null } }
export interface GraphPayload { nodes: CyNode[]; edges: CyEdge[]; meta: Record<string, number> }

// ---- HTTP helpers ----

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`${r.status} ${r.statusText}: ${text || path}`)
  }
  if (r.status === 204) return undefined as T
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return r.json() as Promise<T>
  return r.text() as unknown as T
}

export const api = {
  datasets: {
    list: () => request<Array<Record<string, unknown>> | Record<string, unknown>>('/api/datasets'),
    create: (appId: string) => request<unknown>(`/api/datasets/${encodeURIComponent(appId)}`, { method: 'POST' }),
  },
  regulations: {
    get: (id: string) => request<Regulation>(`/api/regulations/${encodeURIComponent(id)}`),
    raw: (id: string) => request<string>(`/api/regulations/${encodeURIComponent(id)}/raw`),
    delete: (id: string) => request<void>(`/api/regulations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  flow: {
    get: (id: string) => request<RuleDSL>(`/api/regulations/${encodeURIComponent(id)}/flow`),
    save: (id: string, dsl: RuleDSL) =>
      request<{ ok: string; version: string }>(
        `/api/regulations/${encodeURIComponent(id)}/flow`,
        { method: 'PUT', body: JSON.stringify(dsl) },
      ),
    validate: (id: string, dsl: RuleDSL) =>
      request<ValidationResult>(
        `/api/regulations/${encodeURIComponent(id)}/validate`,
        { method: 'POST', body: JSON.stringify(dsl) },
      ),
    history: (id: string) => request<FlowVersion[]>(`/api/regulations/${encodeURIComponent(id)}/flow/history`),
    restore: (id: string, versionId: string) =>
      request<FlowVersion>(
        `/api/regulations/${encodeURIComponent(id)}/flow/restore/${encodeURIComponent(versionId)}`,
        { method: 'POST' },
      ),
  },
  constraints: {
    list: (id: string) => request<Constraint[]>(`/api/regulations/${encodeURIComponent(id)}/constraints`),
    save: (id: string, items: Constraint[]) =>
      request<{ count: number }>(
        `/api/regulations/${encodeURIComponent(id)}/constraints`,
        { method: 'PUT', body: JSON.stringify(items) },
      ),
    exportShacl: (id: string) => request<string>(`/api/regulations/${encodeURIComponent(id)}/shacl/export`),
    importShacl: async (id: string, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/regulations/${encodeURIComponent(id)}/shacl/import`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      return r.json() as Promise<{ merged_constraints: number; conflicts: unknown[] }>
    },
  },
  graph: {
    all: (domain?: string) => request<GraphPayload>(
      domain ? `/api/graph?domain=${encodeURIComponent(domain)}` : '/api/graph',
    ),
    forRegulation: (id: string) => request<GraphPayload>(`/api/graph/regulation/${encodeURIComponent(id)}`),
  },
  domains: {
    list: () => request<Domain[]>('/api/domains'),
  },
  search: {
    query: (q: string, mode: 'local' | 'global' | 'naive' = 'local') =>
      request<{ response: string; entities: unknown[]; sources: unknown[] }>(
        '/api/search', { method: 'POST', body: JSON.stringify({ query: q, mode }) },
      ),
  },
}

export const NODE_KIND_META: Record<NodeKind, { label: string; className: string; description: string }> = {
  input:             { label: 'Вход',         className: 'rf-node--input',     description: 'Параметр на вход' },
  threshold:         { label: 'Порог',        className: 'rf-node--threshold', description: 'Эталон ± отклонение' },
  compare:           { label: 'Сравнить',     className: 'rf-node--compare',   description: 'Сравнение со значением' },
  formula:           { label: 'Формула',      className: 'rf-node--formula',   description: 'Выражение JS-like' },
  switch:            { label: 'Развилка',     className: 'rf-node--switch',    description: 'Маршрут по значениям' },
  output:            { label: 'Выход',        className: 'rf-node--output',    description: 'Действие / рекомендация' },
  shacl_constraint:  { label: 'SHACL',        className: 'rf-node--shacl_constraint', description: 'Внешнее ограничение SHACL' },
}
