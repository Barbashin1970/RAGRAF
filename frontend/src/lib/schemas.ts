/**
 * Zod-схемы для рантайм-валидации ответов backend'а на сетевом boundary.
 *
 * Закрывает R6 из Sigma-audit: вместо `r.json() as Promise<T>` (без проверки
 * формы данных) — каждый ответ проходит через `schema.parse(data)`, что:
 *   - бросает понятное исключение при breaking-change бэкенда,
 *   - сужает `unknown` → типизированный тип без `as`-каста,
 *   - служит документацией на форму данных в одном месте.
 *
 * Стратегия миграции: новые ручки оборачиваем сразу; существующие — по мере
 * прикосновения. Без schema можно вызывать `request<T>` без последнего
 * аргумента (тогда возврат — `unknown`, и TS заставит каст в месте использования).
 */
import { z } from 'zod'

// ── Базовые ──────────────────────────────────────────────────────────────

export const parameterSchema = z.object({
  id: z.string(),
  name: z.string(),
  datatype: z.enum(['decimal', 'string', 'date', 'boolean']),
  referenceValue: z.number().nullable().optional(),
  minInclusive: z.number().nullable().optional(),
  maxInclusive: z.number().nullable().optional(),
  deviationAllowed: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
})

export const constraintSchema = z.object({
  id: z.string(),
  targetClass: z.string(),
  path: z.string(),
  datatype: z.string().nullable().optional(),
  minCount: z.number().nullable().optional(),
  maxCount: z.number().nullable().optional(),
  minInclusive: z.number().nullable().optional(),
  maxInclusive: z.number().nullable().optional(),
  pattern: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  severity: z.enum(['violation', 'warning', 'info']),
})

export const recommendationSchema = z.object({
  id: z.string(),
  text: z.string(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  linkedParameters: z.array(z.string()),
})

export const regulationSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  version: z.string(),
  status: z.enum(['active', 'draft', 'archived']),
  parameters: z.array(parameterSchema),
  constraints: z.array(constraintSchema),
  recommendations: z.array(recommendationSchema),
})

export const domainSchema = z.object({
  id: z.string(),
  label: z.string(),
  hint: z.string().optional(),
})

export const domainsSchema = z.array(domainSchema)

// ── Список регламентов: форма может быть «частично известна» из upstream — ──
// допускаем passthrough неизвестных полей.
export const datasetItemSchema = z.object({
  id: z.string(),
  source_id: z.string().optional(),
  name: z.string().optional(),
  domain: z.string().nullable().optional(),
  parameters_count: z.number().optional(),
  constraints_count: z.number().optional(),
  recommendations_count: z.number().optional(),
}).passthrough()

export const datasetsResponseSchema = z.union([
  z.array(datasetItemSchema),
  z.object({ items: z.array(datasetItemSchema) }).passthrough(),
])

// ── История правок и diff ───────────────────────────────────────────────

export const diffCountsSchema = z.object({
  changed: z.number().optional(),
  added: z.number().optional(),
  removed: z.number().optional(),
  initial: z.number().optional(),
})

export const historyItemSchema = z.object({
  version_id: z.string(),
  source_id: z.string(),
  created_at: z.string(),
  author: z.string(),
  comment: z.string().nullable(),
  diff_summary: z.string(),
  diff_counts: diffCountsSchema,
})

export const diffChangeSchema = z.object({
  op: z.enum(['changed', 'added', 'removed']),
  path: z.string(),
  label: z.string().optional(),
  before: z.unknown(),
  after: z.unknown(),
})

export const diffResponseSchema = z.object({
  summary: z.string(),
  changes: z.array(diffChangeSchema),
  counts: diffCountsSchema,
})

// ── Flow и связанные ─────────────────────────────────────────────────────

export const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['input', 'threshold', 'compare', 'formula', 'switch', 'output', 'shacl_constraint']),
  label: z.string().nullable().optional(),
  position: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  paramRef: z.string().nullable().optional(),
  refValue: z.number().nullable().optional(),
  deviation: z.number().nullable().optional(),
  operator: z.string().nullable().optional(),
  expression: z.string().nullable().optional(),
  cases: z.array(z.object({ label: z.string(), value: z.unknown() })).nullable().optional(),
  action: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  constraintRef: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
}).passthrough()

export const flowEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  condition: z.string().nullable().optional(),
})

export const ruleDslSchema = z.object({
  rule_id: z.string(),
  regulation_id: z.string(),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
})

// ── Validation result ────────────────────────────────────────────────────

export const validationErrorSchema = z.object({
  nodeId: z.string().nullable().optional(),
  edgeId: z.string().nullable().optional(),
  code: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
})

export const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationErrorSchema),
})

// ── Mutation responses ───────────────────────────────────────────────────

export const saveResponseSchema = z.object({
  ok: z.string(),
  version: z.string(),
  pushed_upstream: z.boolean().optional(),
  upstream_error: z.string().optional(),
})

export const deleteRegulationResponseSchema = z.object({
  ok: z.boolean(),
  regulation_id: z.string(),
  deleted_from_store: z.boolean(),
  deleted_flow_files: z.boolean(),
  fixture_backed: z.boolean(),
  upstream_status: z.string().nullable(),
  note: z.string().nullable(),
})

export const shaclImportResponseSchema = z.object({
  merged_constraints: z.number(),
  conflicts: z.array(z.unknown()),
})

export const constraintsSaveResponseSchema = z.object({
  count: z.number(),
})

export const searchResponseSchema = z.object({
  response: z.string(),
  entities: z.array(z.unknown()),
  sources: z.array(z.unknown()),
})

// ── Cytoscape graph ──────────────────────────────────────────────────────

export const cyNodeSchema = z.object({
  data: z.object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    description: z.string().nullable().optional(),
    regulation_id: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
  }),
})

export const cyEdgeSchema = z.object({
  data: z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().nullable().optional(),
    weight: z.number().nullable().optional(),
  }),
})

export const graphPayloadSchema = z.object({
  nodes: z.array(cyNodeSchema),
  edges: z.array(cyEdgeSchema),
  meta: z.record(z.string(), z.number()),
})

// ── Sandbox ────────────────────────────────────────────────────────────

export const sandboxStatusSchema = z.object({
  mode: z.enum(['mock', 'real']),
  real_available: z.boolean(),
  demos: z.array(z.string()),
  backlog: z.array(z.string()),
})

export const sandboxSearchResultSchema = z.object({
  regulation_id: z.string(),
  regulation_name: z.string(),
  domain: z.string().nullable().optional(),
  score: z.number(),
  matched_terms: z.array(z.string()),
  snippet: z.string(),
  parameters_count: z.number(),
})

export const sandboxSearchResponseSchema = z.object({
  query: z.string(),
  mode: z.enum(['mock', 'real']),
  results: z.array(sandboxSearchResultSchema),
})

export const sandboxChatResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(sandboxSearchResultSchema),
  mode: z.enum(['mock', 'real']),
})

export const sandboxLlmInfoSchema = z.object({
  mode: z.enum(['mock', 'real']),
  ragu_enabled: z.boolean(),
  llm_model: z.string(),
  embed_model: z.string(),
  base_url: z.string().nullable(),
  defaults: z.object({
    temperature: z.number(),
    top_k: z.number(),
    max_tokens: z.number(),
  }),
  limits: z.object({
    temperature: z.tuple([z.number(), z.number()]),
    top_k: z.tuple([z.number(), z.number()]),
    max_tokens: z.tuple([z.number(), z.number()]),
  }),
  llm_reachable: z.boolean(),
  llm_loaded_in_memory: z.boolean(),
  available_models: z.array(z.string()),
  loaded_models: z.array(z.string()).optional(),
  index_size: z.number(),
  index_fresh: z.boolean().optional(),
})

export const sandboxExtractedParamSchema = z.object({
  id: z.string(),
  suggested_name: z.string(),
  value: z.number(),
  deviation: z.number().nullable().optional(),
  unit: z.string(),
  source_text: z.string(),
  confidence: z.number(),
  min_inclusive: z.number().nullable().optional(),
})

export const sandboxExtractResponseSchema = z.object({
  mode: z.enum(['mock', 'real']),
  extracted: z.array(sandboxExtractedParamSchema),
  count: z.number(),
})

export const sandboxCreateFromParamsResponseSchema = z.object({
  regulation_id: z.string(),
  name: z.string(),
  domain: z.string().nullable().optional(),
  parameters_count: z.number(),
})
