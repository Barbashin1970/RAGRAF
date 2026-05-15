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
  cases?: Array<{ id?: string; label: string; value: unknown }> | null
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
  // SIGMA-compliance (ТЗ §4.1.3): нормативное основание + период действия.
  source_document?: string | null
  source_clause?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

export interface Domain {
  id: string
  label: string
  hint?: string
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

import type { ZodType } from 'zod'
import {
  constraintSchema,
  constraintsSaveResponseSchema,
  datasetsResponseSchema,
  diffResponseSchema,
  domainsSchema,
  graphPayloadSchema,
  historyItemSchema,
  regulationSchema,
  ruleDslSchema,
  sandboxCreateFromParamsResponseSchema,
  sandboxExtractResponseSchema,
  sandboxSearchResponseSchema,
  sandboxStatusSchema,
  deleteRegulationResponseSchema,
  sandboxChatResponseSchema,
  sandboxLlmInfoSchema,
  saveResponseSchema,
  searchResponseSchema,
  shaclImportResponseSchema,
  validationResultSchema,
} from './schemas'
import { z } from 'zod'

/**
 * Typed HTTP wrapper.
 * @param schema — опциональная zod-схема для рантайм-валидации. Если задана —
 *   ответ проверяется через `schema.parse(data)` и возвращается с типом `z.infer<schema>`.
 *   Если не задана — каст к `T` без проверки (для интернальных вызовов / тестов).
 *   На сетевом boundary рекомендуется ВСЕГДА передавать schema (R6 из Sigma-audit).
 */
async function request<T>(
  path: string,
  init?: RequestInit,
  schema?: ZodType<T>,
): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`${r.status} ${r.statusText}: ${text || path}`)
  }
  if (r.status === 204) return null as T
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const data: unknown = await r.json()
    if (schema) return schema.parse(data)
    return data as T
  }
  // text/plain (Turtle, raw exports) — возвращаем как есть
  const text = await r.text()
  return text as unknown as T
}

export const api = {
  datasets: {
    list: () => request(`/api/datasets`, undefined, datasetsResponseSchema),
    create: (appId: string) =>
      request<unknown>(`/api/datasets/${encodeURIComponent(appId)}`, { method: 'POST' }, z.unknown()),
  },
  regulations: {
    /** Создать новый регламент по шаблону домена (или пустой при `use_template=false`). */
    create: (payload: {
      domain: string
      name?: string
      source_id?: string
      use_template?: boolean
    }) =>
      request(
        `/api/regulations`,
        { method: 'POST', body: JSON.stringify(payload) },
        regulationSchema,
      ),
    get: (id: string) => request(`/api/regulations/${encodeURIComponent(id)}`, undefined, regulationSchema),
    save: (id: string, reg: Regulation) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(reg) },
        saveResponseSchema,
      ),
    raw: (id: string) => request<string>(`/api/regulations/${encodeURIComponent(id)}/raw`),
    /** Удаление регламента. Бэкенд требует ?confirm=true чтобы случайный
     *  curl/код не сносил данные; UI всегда подтверждает через диалог. */
    delete: (id: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}?confirm=true`,
        { method: 'DELETE' },
        deleteRegulationResponseSchema,
      ),
    history: (id: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/regulation-history`,
        undefined,
        z.array(historyItemSchema),
      ),
    diff: (id: string, versionId: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/regulation-diff/${encodeURIComponent(versionId)}`,
        undefined,
        diffResponseSchema,
      ),
    restore: (id: string, versionId: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/regulation-restore/${encodeURIComponent(versionId)}`,
        { method: 'POST' },
        regulationSchema,
      ),
    publish: (id: string) =>
      request(`/api/regulations/${encodeURIComponent(id)}/publish`, { method: 'POST' }, regulationSchema),
    archive: (id: string) =>
      request(`/api/regulations/${encodeURIComponent(id)}/archive`, { method: 'POST' }, regulationSchema),
  },
  flow: {
    get: (id: string) => request(`/api/regulations/${encodeURIComponent(id)}/flow`, undefined, ruleDslSchema),
    save: (id: string, dsl: RuleDSL) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/flow`,
        { method: 'PUT', body: JSON.stringify(dsl) },
        z.object({ ok: z.string(), version: z.string() }),
      ),
    validate: (id: string, dsl: RuleDSL) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/validate`,
        { method: 'POST', body: JSON.stringify(dsl) },
        validationResultSchema,
      ),
    history: (id: string) =>
      request<FlowVersion[]>(`/api/regulations/${encodeURIComponent(id)}/flow/history`),
    restore: (id: string, versionId: string) =>
      request<FlowVersion>(
        `/api/regulations/${encodeURIComponent(id)}/flow/restore/${encodeURIComponent(versionId)}`,
        { method: 'POST' },
      ),
  },
  constraints: {
    list: (id: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/constraints`,
        undefined,
        z.array(constraintSchema),
      ),
    save: (id: string, items: Constraint[]) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/constraints`,
        { method: 'PUT', body: JSON.stringify(items) },
        constraintsSaveResponseSchema,
      ),
    exportShacl: (id: string) => request<string>(`/api/regulations/${encodeURIComponent(id)}/shacl/export`),
    importShacl: async (id: string, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/regulations/${encodeURIComponent(id)}/shacl/import`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const data: unknown = await r.json()
      return shaclImportResponseSchema.parse(data)
    },
  },
  graph: {
    all: (domain?: string) =>
      request(
        domain ? `/api/graph?domain=${encodeURIComponent(domain)}` : '/api/graph',
        undefined,
        graphPayloadSchema,
      ),
    forRegulation: (id: string) =>
      request(
        `/api/graph/regulation/${encodeURIComponent(id)}`,
        undefined,
        graphPayloadSchema,
      ),
  },
  domains: {
    list: () => request(`/api/domains`, undefined, domainsSchema),
    create: (payload: { label: string; hint?: string; suggested_id?: string }) =>
      request<Domain>(
        `/api/domains`,
        { method: 'POST', body: JSON.stringify(payload) },
        z.object({ id: z.string(), label: z.string(), hint: z.string().optional() }),
      ),
    delete: (id: string) =>
      request<{ id: string; status: string }>(
        `/api/domains/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        z.object({ id: z.string(), status: z.string() }),
      ),
  },
  search: {
    query: (q: string, mode: 'local' | 'global' | 'naive' = 'local') =>
      request(
        '/api/search',
        { method: 'POST', body: JSON.stringify({ query: q, mode }) },
        searchResponseSchema,
      ),
  },
  sandbox: {
    status: () => request(`/api/sandbox/status`, undefined, sandboxStatusSchema),
    search: (query: string, top_k = 5) =>
      request(
        `/api/sandbox/search`,
        { method: 'POST', body: JSON.stringify({ query, top_k }) },
        sandboxSearchResponseSchema,
      ),
    chat: (
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      params: { top_k?: number; temperature?: number; max_tokens?: number } = {},
    ) =>
      request(
        `/api/sandbox/chat`,
        { method: 'POST', body: JSON.stringify({ messages, ...params }) },
        sandboxChatResponseSchema,
      ),
    llmInfo: () => request(`/api/sandbox/llm-info`, undefined, sandboxLlmInfoSchema),
    extractParameters: (text: string) =>
      request(
        `/api/sandbox/extract-parameters`,
        { method: 'POST', body: JSON.stringify({ text }) },
        sandboxExtractResponseSchema,
      ),
    createFromParams: (payload: {
      name: string
      domain: string
      params: Array<{ suggested_name: string; value: number; deviation?: number | null; unit?: string | null }>
    }) =>
      request(
        `/api/sandbox/create-from-params`,
        { method: 'POST', body: JSON.stringify(payload) },
        sandboxCreateFromParamsResponseSchema,
      ),
    // Documents (NotebookLM-style контекст для Q&A)
    listDocuments: () =>
      request<DocumentsListResponse>(`/api/sandbox/documents`),
    uploadDocument: async (file: File): Promise<UserDocument> => {
      const fd = new FormData()
      fd.append('file', file)
      // FormData нельзя через JSON-обёртку request() — fetch напрямую.
      const r = await fetch(`/api/sandbox/documents/upload`, { method: 'POST', body: fd })
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try {
          const j = await r.json()
          if (j?.detail) detail = j.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      return r.json() as Promise<UserDocument>
    },
    toggleDocument: (docId: string, enabled: boolean) =>
      request<UserDocument>(
        `/api/sandbox/documents/${encodeURIComponent(docId)}`,
        { method: 'PATCH', body: JSON.stringify({ enabled }) },
      ),
    deleteDocument: (docId: string) =>
      request<{ doc_id: string; status: string }>(
        `/api/sandbox/documents/${encodeURIComponent(docId)}`,
        { method: 'DELETE' },
      ),
    analyzeDocument: (docId: string) =>
      request<DocumentAnalysisResult>(
        `/api/sandbox/documents/${encodeURIComponent(docId)}/analyze`,
        { method: 'POST' },
      ),
    analyzeDocumentSummary: (docId: string) =>
      request<{ doc_id: string; summary: string }>(
        `/api/sandbox/documents/${encodeURIComponent(docId)}/analyze-summary`,
        { method: 'POST' },
      ),
  },
}

// Documents (NotebookLM-style) — типы для контекста аналитика.
export interface UserDocument {
  doc_id: string
  filename: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
  enabled: boolean
  total_chunks: number
  char_count: number
  error: string | null
}

export interface DocumentsListResponse {
  documents: UserDocument[]
  limits: {
    max_documents: number
    max_file_size_bytes: number
    current_count: number
    enabled_count: number
  }
}

export interface DocumentAnalysisDomainSlice {
  domain: string
  regulation_count: number
  total_hits: number
}

export interface DocumentAnalysisRegulation {
  regulation_id: string
  name: string
  domain: string
  hits: number
  max_score: number
  chunk_examples: string[]
}

export interface DocumentAnalysisResult {
  doc_id: string
  filename: string
  domain_spectrum: DocumentAnalysisDomainSlice[]
  regulations: DocumentAnalysisRegulation[]
  summary: string
  summary_llm_available?: boolean
  stats: {
    chunks_analyzed: number
    regulations_matched: number
    avg_hits_per_chunk: number
  }
}

// Node-RED-style: каждый тип узла имеет свою иконку. В palette (Toolbox) и на
// canvas (FlowEditor) рисуется как split-block: тёмная иконка-секция слева +
// светлая label-секция справа. Точная семантика выбора см. NODE_KIND_META.
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  Calculator,
  GitBranch,
  LogIn,
  ScanLine,
  Send,
  Shield,
} from 'lucide-react'

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; className: string; description: string; icon: LucideIcon }
> = {
  input:             { label: 'Вход',     className: 'rf-node--input',     description: 'Параметр на вход',           icon: LogIn },
  threshold:         { label: 'Порог',    className: 'rf-node--threshold', description: 'Эталон ± отклонение',         icon: ScanLine },
  compare:           { label: 'Сравнить', className: 'rf-node--compare',   description: 'Сравнение со значением',      icon: ArrowDownToLine },
  formula:           { label: 'Формула',  className: 'rf-node--formula',   description: 'Выражение JS-like',           icon: Calculator },
  switch:            { label: 'Развилка', className: 'rf-node--switch',    description: 'Маршрут по значениям',        icon: GitBranch },
  output:            { label: 'Выход',    className: 'rf-node--output',    description: 'Действие / рекомендация',     icon: Send },
  shacl_constraint:  { label: 'SHACL',    className: 'rf-node--shacl_constraint', description: 'Внешнее ограничение SHACL', icon: Shield },
}
