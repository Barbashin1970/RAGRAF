// Typed REST client for the RAGRAF backend (FastAPI at /api/*).
// Shapes mirror backend/app/schemas/domain.py.

export type NodeKind =
  | 'input' | 'threshold' | 'compare' | 'formula' | 'switch' | 'output' | 'shacl_constraint'
  // Точка привязки к внешнему сигналу ETL/IoT. На канвасе рисуется кружком,
  // ребром цепляется к input-ноде. См. README §«Исполнение регламента».
  | 'sensor'

// sigma R6 type-guard: drag/drop из палитры приходит как `string` из
// HTML5 DataTransfer; до использования сужаем к узкому union'у NodeKind
// без `as`-каста. Используется в FlowCanvas.onDrop.
const _NODE_KINDS: readonly NodeKind[] = [
  'input', 'threshold', 'compare', 'formula', 'switch', 'output',
  'shacl_constraint', 'sensor',
] as const

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && (_NODE_KINDS as readonly string[]).includes(value)
}

// Тип физического датчика (соответствует `type` в ETL-payload'е СИГМЫ):
//   p     — pressure (манометр),
//   t     — temperature (термопара / RTD),
//   flow  — расход м³/ч (электромагнитный/ультразвуковой расходомер),
//   noise — акустический детектор (например, утечки),
//   detector — видеодетектор (CCTV-аналитика),
//   fiber — распределённое оптоволокно (DAS): кабель сам является
//           датчиком, ML классифицирует событие + позицию вдоль волокна.
//   air   — качество воздуха (CO2, PM2.5, PM10, …) из проекта ГОРОД-ОМ-ИИ;
//           edge-агрегатор шлёт семантическое «превышение концентрации».
export type SensorType = 'p' | 't' | 'flow' | 'noise' | 'detector' | 'fiber' | 'air'

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
  // Sensor-specific (см. backend/app/schemas/domain.py: FlowNode):
  sensorType?: SensorType | null
  sensorSubtype?: string | null   // конкретный подтип (vd-anpr / fiber-vibration / ...)
  bindsTo?: string | null
  externalId?: string | null
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

// Декларативная привязка «вход регламента → датчик/событие». Зеркалит
// backend `RegulationTrigger`. Закрывает event-driven gap: маршрутизация
// «датчик → регламент» теперь явная, а не через обход flow.json.
export interface RegulationTrigger {
  id: string
  label?: string | null
  param_ref: string
  sensor_subtype?: string | null
  event_type?: string | null
  // Композиция регламентов: триггер слушает output другого регламента.
  // source_regulation взаимоисключен с sensor_subtype (логически — UI делает
  // переключатель «датчик / другой регламент»), но обе пары необязательны.
  source_regulation?: string | null
  source_output?: string | null
  description?: string | null
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
  // Optional с дефолтом `[]` на бэкенде — старые регламенты без триггеров
  // приходят без поля, новые — с массивом. Optional освобождает места,
  // где Regulation конструируется во временных тестовых заглушках.
  triggers?: RegulationTrigger[]
  // SIGMA-compliance (ТЗ §4.1.3): нормативное основание + период действия.
  source_document?: string | null
  source_clause?: string | null
  valid_from?: string | null
  valid_to?: string | null
  // PROV-O attachment: документ-основание (Вариант B — локальный кэш).
  // Подробнее: README §«Документ-основание».
  source_url?: string | null
  source_excerpt?: string | null
  source_file_path?: string | null   // относительный путь от DATA_DIR (read-only из UI)
  source_checksum?: string | null    // sha256:<hex>
  source_mime_type?: string | null
}

export interface Domain {
  id: string
  label: string
  hint?: string
}

// Process — цифровой двойник процесса управления. Именованная коллекция
// регламентов с возможностью экспорта артефакта (Turtle/SIGMA-bundle).
// Страница /twins.
export interface Process {
  id: string
  name: string
  description?: string | null
  regulation_ids: string[]
  created_at?: string | null
  updated_at?: string | null
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

// ── Sensor field schemas + subtypes (Библиотека датчиков) ────────────
// Зеркалит app/schemas/domain.py. Двух-уровневая структура:
//   class_id ('detector', 'fiber', ...) — литерал SensorType
//   subtype_id ('vd-anpr', 'fiber-vibration', ...) — конкретная модель,
//                                                    содержит свои поля
// Поля живут под subtype_id, а не под class_id.
export interface SensorSubtype {
  subtype_id: string
  class_id: string
  label: string
  description?: string | null
  position: number
}

export interface SensorClassWithSubtypes {
  class_id: string
  subtypes: SensorSubtype[]
}

export interface SensorFieldSchema {
  subtype_id: string
  field_name: string
  datatype: 'decimal' | 'integer' | 'string' | 'boolean'
  unit?: string | null
  description?: string | null
  required: boolean
  example_value?: string | null   // JSON-encoded строка
  position: number
}

export interface SensorFieldsByType {
  subtype_id: string
  fields: SensorFieldSchema[]
}

// ── Extraction dictionary ─────────────────────────────────────────────
// Словарь rules-based извлечения — DuckDB-backed, аналитик «дообучает»
// движок добавлением новых стемов из UI. См. /api/extraction-terms.
export interface ExtractionTerm {
  stem: string                  // подстрочный паттерн в русском тексте
  parameter_name: string        // что предложить в качестве имени параметра
  domain?: string | null        // тэг домена (heating/housing/safety/environment) или null
  unit_hint?: string | null     // подсказка единицы для UI
  source: 'seed' | 'user'
}

export interface DomainScore {
  domain: string
  hits: number
  confidence: number            // 0..1, доля от total_hits
}

// ── Режим «Исполнение» (Execute) ──────────────────────────────────────
// Зеркалит app/services/flow_executor.py. ETL → POST /execute → ExecutionResult.
export interface SensorReading {
  value: number
  sensor_id?: string | null
  param_id?: string | null
  sensor_type?: SensorType | null
  external_id?: string | null
  edge_id?: number | null
}

export interface NodeTrace {
  node_id: string
  node_type: string
  fired: boolean
  value?: number | null
  explanation?: string | null
}

export interface ExecutionResult {
  level: number              // 0 = норма, 1..3 = priority output'а
  regulation_id: string
  regulation_name: string
  recommendation?: string | null
  fired_nodes: string[]
  fired_edges: string[]      // формат `${source}__${target}` (см. rulesDsl.ts)
  trace: NodeTrace[]
  inputs_resolved: Record<string, number>
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
  extractionTermSchema,
  extractionTermsListResponse,
  processSchema,
  processesListSchema,
  sensorFieldSchema,
  sensorFieldsByTypeSchema,
  sensorSchemasListResponse,
  sensorSubtypeSchema,
  sensorSubtypesListResponse,
  shaclImportResponseSchema,
  sigmaImportResponseSchema,
  sourceUploadResponseSchema,
  sourceVerifyResponseSchema,
  userDocumentSchema,
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
    /** Дублировать существующий регламент — копирует параметры/триггеры/flow/SHACL.
     *  Возвращает созданный Regulation. Backend генерирует уникальный source_id
     *  и ставит status='draft' (копия не может быть active без явного approval). */
    duplicate: (id: string, payload?: { name?: string; source_id?: string }) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/duplicate`,
        { method: 'POST', body: JSON.stringify(payload ?? {}) },
        regulationSchema,
      ),
    save: (id: string, reg: Regulation) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(reg) },
        saveResponseSchema,
      ),
    raw: (id: string) => request<string>(`/api/regulations/${encodeURIComponent(id)}/raw`),
    /** PUT /raw — встроенный редактор вкладки «Turtle» в Regulation Editor.
     *  Backend парсит Turtle → сохраняет в DuckDB store + history. */
    updateRaw: async (id: string, turtle: string) => {
      const r = await fetch(`/api/regulations/${encodeURIComponent(id)}/raw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: turtle,
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`${r.status} ${r.statusText}: ${text}`)
      }
      return r.json() as Promise<{ ok: boolean; version: string; pushed_upstream: boolean }>
    },
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
    // Композиция регламентов: какие регламенты слушают output этого.
    triggeredBy: (id: string) =>
      request<{
        regulation_id: string
        count: number
        triggers: Array<{
          regulation_id: string
          regulation_name: string
          domain?: string | null
          trigger_id: string
          trigger_label?: string | null
          param_ref: string
          source_output?: string | null
          event_type?: string | null
        }>
      }>(`/api/regulations/${encodeURIComponent(id)}/triggered-by`),
    // Output-action'ы этого регламента — для селекта source_output в секции
    // «Триггеры» при настройке композиции (выбрали source_regulation = X →
    // подгружаются доступные action'ы X из его flow.json).
    outputActions: (id: string) =>
      request<{
        regulation_id: string
        actions: Array<{
          action: string
          label: string
          text: string
          priority: number
        }>
      }>(`/api/regulations/${encodeURIComponent(id)}/output-actions`),
    /**
     * Загрузить документ-основание (PDF / DOCX / etc.) для регламента.
     * Backend сохранит файл в `data/source_documents/{id}/`, посчитает SHA-256
     * и пропишет путь/хеш/mime в Regulation. Один регламент = один attachment.
     */
    uploadSourceDocument: async (id: string, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/regulations/${encodeURIComponent(id)}/source-upload`, {
        method: 'POST', body: fd,
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`${r.status} ${r.statusText}: ${text}`)
      }
      return sourceUploadResponseSchema.parse(await r.json())
    },
    /** URL для прямого скачивания/preview документа (используется как href). */
    sourceDocumentUrl: (id: string) =>
      `/api/regulations/${encodeURIComponent(id)}/source-document`,
    /** Удалить только локальный кэш файла (URL/цитата сохраняются). */
    deleteSourceDocument: (id: string) =>
      request<{ ok: boolean; removed: boolean }>(
        `/api/regulations/${encodeURIComponent(id)}/source-document`,
        { method: 'DELETE' },
      ),
    /** Сверить SHA-256 локального файла с записанным в БД. */
    verifySourceDocument: (id: string) =>
      request(
        `/api/regulations/${encodeURIComponent(id)}/source-verify`,
        undefined,
        sourceVerifyResponseSchema,
      ),
    /**
     * Импорт SIGMA-bundle (ZIP) обратно в RAGRAF.
     *
     * Поддерживает оба формата:
     *  - single bundle: ZIP с одной папкой `<source_id>/data.ttl + shapes.ttl`
     *  - corpus bundle: несколько таких папок + `corpus_manifest.json`
     *
     * Регламенты создаются/обновляются в DuckDB store. SHACL пушится в upstream
     * если он доступен; иначе мягко скипается (можно догрузить через UI).
     */
    importSigmaBundle: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/sigma-import/bundle`, { method: 'POST', body: fd })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`${r.status} ${r.statusText}: ${text}`)
      }
      const data: unknown = await r.json()
      return sigmaImportResponseSchema.parse(data)
    },
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
    /**
     * Прогнать flow с конкретными readings — режим «Исполнение регламента».
     * dsl передаём inline, чтобы аналитик прогонял live-draft без save'а.
     * Бэк отвечает level/recommendation/fired_nodes/fired_edges/trace —
     * UI подсвечивает путь и показывает вердикт.
     */
    execute: (id: string, payload: { dsl?: RuleDSL; readings: SensorReading[] }) =>
      request<ExecutionResult>(
        `/api/regulations/${encodeURIComponent(id)}/execute`,
        { method: 'POST', body: JSON.stringify(payload) },
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
  modules: {
    list: () => request(`/api/modules`, undefined, z.array(z.any())) as Promise<Array<Record<string, unknown>>>,
    get: (id: string) => request(`/api/modules/${encodeURIComponent(id)}`, undefined, z.any()) as Promise<Record<string, unknown>>,
    create: (payload: Record<string, unknown>) =>
      request(
        `/api/modules`,
        { method: 'POST', body: JSON.stringify(payload) },
        z.any(),
      ) as Promise<Record<string, unknown>>,
    update: (id: string, payload: Record<string, unknown>) =>
      request(
        `/api/modules/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(payload) },
        z.any(),
      ) as Promise<Record<string, unknown>>,
    delete: (id: string) =>
      request(
        `/api/modules/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        z.object({ id: z.string(), status: z.string() }),
      ),
  },
  downloads: {
    /** Счётчики скачиваний installer'ов по платформам. Для footer-социалки.
     *  Persistent в JSON на Volume Railway → переживает редеплои. */
    stats: () =>
      request(
        `/api/download/stats`,
        undefined,
        z.object({ macos: z.number(), windows: z.number() }),
      ),
    /** URL для прямой ссылки на ZIP — кнопки в footer'е делают `<a href>`,
     *  не fetch — браузер сам инициирует скачивание + Save dialog. */
    installerUrl: (platform: 'macos' | 'windows') =>
      `/api/download/installer/${platform}`,
  },
  auditLog: {
    listRecent: (limit = 50) =>
      request(
        `/api/audit-log?limit=${limit}`,
        undefined,
        z.array(z.any()),
      ) as Promise<Array<Record<string, unknown>>>,
    getIncident: (id: string) =>
      request(
        `/api/audit-log/${encodeURIComponent(id)}`,
        undefined,
        z.array(z.any()),
      ) as Promise<Array<Record<string, unknown>>>,
  },
  domains: {
    list: () => request(`/api/domains`, undefined, domainsSchema),
    create: (payload: {
      label: string
      hint?: string
      suggested_id?: string
      icon?: string | null
      color?: string | null
    }) =>
      request<Domain>(
        `/api/domains`,
        { method: 'POST', body: JSON.stringify(payload) },
        z.object({
          id: z.string(),
          label: z.string(),
          hint: z.string().optional(),
          icon: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
        }),
      ),
    delete: (id: string) =>
      request<{ id: string; status: string }>(
        `/api/domains/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        z.object({ id: z.string(), status: z.string() }),
      ),
    overview: (id: string) =>
      request(
        `/api/domains/${encodeURIComponent(id)}/overview`,
        undefined,
        z.any(),
      ) as Promise<{
        domain: { id: string; label: string; hint?: string; icon?: string | null; color?: string | null } | null
        regulations: Array<Record<string, unknown>>
        modules: Array<Record<string, unknown>>
        sensor_subtypes: Array<{
          subtype_id: string
          class_id: string
          label: string
          description: string | null
          module_id: string | null
        }>
        coverage: {
          regulations_count: number
          modules_count: number
          sensor_subtypes_count: number
        }
      }>,
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
      params: {
        top_k?: number
        temperature?: number
        max_tokens?: number
        // Доп-инструкция «стиль/тон/формат» — добавляется к встроенному
        // system-промпту. Пустую строку не отправляем (бэк отфильтрует, но
        // не плодим бесполезный wire-overhead).
        extra_system_prompt?: string
        // Регламенты, исключённые из retrieval'а (галки сняты слева).
        // Пустой массив = всё включено.
        disabled_regulation_ids?: string[]
        // Контекстное окно Ollama (`num_ctx`). undefined = дефолт модели.
        num_ctx?: number
        // Override модели на этот запрос (например быстрая qwen2.5:3b
        // вместо дефолтной 7b). undefined = настройка из .env.
        model?: string
      } = {},
      // AbortSignal для кнопки «Стоп» в чате. Когда LLM крутится дольше чем
      // юзер готов ждать, abort() обрывает fetch — на бэке вызов к Ollama
      // продолжится в фоне (его результат отбросится), но юзер сразу увидит
      // что цикл оборвался.
      signal?: AbortSignal,
    ) =>
      request(
        `/api/sandbox/chat`,
        { method: 'POST', body: JSON.stringify({ messages, ...params }), signal },
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
      // sigma R6: runtime-валидация network-payload через zod вместо `as`-каста.
      return userDocumentSchema.parse(await r.json())
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
    /** Принудительно загрузить модель в RAM Ollama (keep_alive=-1). */
    loadModel: (model: string) =>
      request<{ ok: boolean; model: string; status: string }>(
        `/api/sandbox/llm/load`,
        { method: 'POST', body: JSON.stringify({ model }) },
      ),
    /** Принудительно выгрузить модель из RAM (keep_alive=0). */
    unloadModel: (model: string) =>
      request<{ ok: boolean; model: string; status: string }>(
        `/api/sandbox/llm/unload`,
        { method: 'POST', body: JSON.stringify({ model }) },
      ),
  },
  ragu: {
    listPrompts: () =>
      request<{ available: boolean; prompts: RaguPrompt[] }>(`/api/ragu/prompts`),
    getPrompt: (name: string) =>
      request<RaguPromptDetail>(`/api/ragu/prompts/${encodeURIComponent(name)}`),
    savePromptOverride: (name: string, payload: { template: string; role?: 'user' | 'system' | 'ai'; comment?: string }) =>
      request<{ ok: boolean; override: RaguPromptOverride }>(
        `/api/ragu/prompts/${encodeURIComponent(name)}`,
        { method: 'PUT', body: JSON.stringify(payload) },
      ),
    deletePromptOverride: (name: string) =>
      request<{ ok: boolean; name: string; status: string }>(
        `/api/ragu/prompts/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      ),
    getConfig: () => request<RaguConfig>(`/api/ragu/config`),
  },
  // ── Библиотека датчиков: подтипы + их поля ─────────────────────────
  // Двух-уровневая структура.
  //   Класс (литерал SensorType) — статичен в коде.
  //   Подтип — конкретная модель, добавляется/удаляется из UI.
  //   Поля привязаны к подтипу.
  // Аналитик через эти endpoints добавляет 20+ видеодетекторов или
  // DAS-подтипов без правок в коде.
  sensorSubtypes: {
    list: () =>
      request(`/api/sensor-subtypes`, undefined, sensorSubtypesListResponse),
    create: (sub: SensorSubtype) =>
      request(
        `/api/sensor-subtypes`,
        { method: 'POST', body: JSON.stringify(sub) },
        sensorSubtypeSchema,
      ),
    update: (subtypeId: string, sub: SensorSubtype) =>
      request(
        `/api/sensor-subtypes/${encodeURIComponent(subtypeId)}`,
        { method: 'PUT', body: JSON.stringify(sub) },
        sensorSubtypeSchema,
      ),
    delete: (subtypeId: string) =>
      request<{ ok: boolean; subtype_id: string }>(
        `/api/sensor-subtypes/${encodeURIComponent(subtypeId)}`,
        { method: 'DELETE' },
      ),
    // Reverse-lookup: какие регламенты слушают этот подтип. Возвращает
    // плоский список триггеров (один регламент может быть несколько раз
    // если у него несколько триггеров на этот подтип).
    regulationsUsing: (subtypeId: string) =>
      request<{
        subtype_id: string
        count: number
        triggers: Array<{
          regulation_id: string
          regulation_name: string
          domain?: string | null
          trigger_id: string
          trigger_label?: string | null
          param_ref: string
          event_type?: string | null
        }>
      }>(`/api/sensor-subtypes/${encodeURIComponent(subtypeId)}/regulations`),
    // Агрегированный счётчик: subtype_id → N регламентов. Один запрос
    // вместо N для рендера бэйджей в дереве датчиков.
    usageCounts: () =>
      request<Record<string, number>>(`/api/sensor-subtypes/_usage`),
  },
  // ── Цифровые двойники процессов (Process) ──────────────────────────
  // CRUD + экспорт артефактов (Turtle / SIGMA-bundle ZIP). Страница /twins.
  processes: {
    list: () => request(`/api/processes`, undefined, processesListSchema),
    get: (id: string) =>
      request(`/api/processes/${encodeURIComponent(id)}`, undefined, processSchema),
    create: (p: Omit<Process, 'id' | 'created_at' | 'updated_at'> & { id?: string }) =>
      request(
        `/api/processes`,
        { method: 'POST', body: JSON.stringify({ id: '', ...p }) },
        processSchema,
      ),
    update: (id: string, p: Process) =>
      request(
        `/api/processes/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(p) },
        processSchema,
      ),
    delete: (id: string) =>
      request<{ ok: boolean; process_id: string }>(
        `/api/processes/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    // Экспорт: прямые URL для <a download> — браузер сам скачивает.
    bundleUrl: (id: string) =>
      `/api/processes/${encodeURIComponent(id)}/bundle.zip`,
    turtleUrl: (id: string) =>
      `/api/processes/${encodeURIComponent(id)}/turtle`,
  },
  // ── Словарь rules-based извлечения ─────────────────────────────────
  // CRUD над DuckDB extraction_terms: пополнение нераспознанными словами
  // прямо из UI («Словарь» в RegulationExtractScreen). Source-of-truth
  // для seed-набора — backend/app/services/extraction_term_store.py.
  extractionTerms: {
    list: () =>
      request(`/api/extraction-terms`, undefined, extractionTermsListResponse),
    upsert: (stem: string, body: ExtractionTerm) =>
      request(
        `/api/extraction-terms/${encodeURIComponent(stem)}`,
        { method: 'PUT', body: JSON.stringify(body) },
        extractionTermSchema,
      ),
    delete: (stem: string) =>
      request<{ ok: boolean; stem: string }>(
        `/api/extraction-terms/${encodeURIComponent(stem)}`,
        { method: 'DELETE' },
      ),
    reseed: () =>
      request<{ ok: boolean; terms_seeded: number }>(
        `/api/extraction-terms/reseed`,
        { method: 'POST' },
      ),
  },
  sensorSchemas: {
    list: () =>
      request(`/api/sensor-schemas`, undefined, sensorSchemasListResponse),
    listForSubtype: (subtypeId: string) =>
      request(
        `/api/sensor-schemas/${encodeURIComponent(subtypeId)}`,
        undefined,
        sensorFieldsByTypeSchema,
      ),
    upsert: (subtypeId: string, fieldName: string, body: SensorFieldSchema) =>
      request(
        `/api/sensor-schemas/${encodeURIComponent(subtypeId)}/${encodeURIComponent(fieldName)}`,
        { method: 'PUT', body: JSON.stringify(body) },
        sensorFieldSchema,
      ),
    delete: (subtypeId: string, fieldName: string) =>
      request<{ ok: boolean; subtype_id: string; field_name: string }>(
        `/api/sensor-schemas/${encodeURIComponent(subtypeId)}/${encodeURIComponent(fieldName)}`,
        { method: 'DELETE' },
      ),
    reseed: () =>
      request<{ ok: boolean; subtypes_seeded: number; fields_seeded: number }>(
        `/api/sensor-schemas/reseed`,
        { method: 'POST' },
      ),
  },
}

// ── RAGU Studio types ──────────────────────────────────────────────────

export interface RaguPrompt {
  name: string
  description: string
  default_template: string
  role: 'user' | 'system' | 'ai'
  pydantic_schema: string
  variables: string[]
  message_count: number
  has_override: boolean
  override_updated_at: string | null
  override_comment: string | null
}

export interface RaguPromptOverride {
  name: string
  template: string
  role: string
  comment: string | null
  updated_at: string
}

export interface RaguPromptDetail extends RaguPrompt {
  override_template: string | null
  override_role: string | null
  override_comment: string | null
  override_updated_at: string | null
}

export interface RaguConfig {
  ragu_enabled: boolean
  llm_model: string
  embed_model: string
  base_url: string | null
  storage_folder: string
  available: boolean
  builder_defaults: Record<string, unknown> | null
  language: string | null
  prompt_count?: number
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
  Radar,
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
  // Датчик — точка привязки к внешнему сигналу ETL. Кружок, ETL-индикатор.
  sensor:            { label: 'Датчик',   className: 'rf-node--sensor',    description: 'Точка ввода с датчика ETL',   icon: Radar },
}

// Палитра цветов для каждого типа физического датчика — используется и в
// панели запуска (бейджи у инпутов), и на канвасе (заливка кружка).
// Тон совпадает с тоном domains, чтобы аналитик не путался.
export const SENSOR_TYPE_META: Record<
  SensorType,
  { label: string; short: string; bg: string; fg: string; ring: string }
> = {
  p:        { label: 'Давление',       short: 'p', bg: 'bg-blue-100',    fg: 'text-blue-700',    ring: 'ring-blue-300' },
  t:        { label: 'Температура',    short: 't', bg: 'bg-rose-100',    fg: 'text-rose-700',    ring: 'ring-rose-300' },
  // Расход (м³/ч) — теплосчётчик / расходомер. Цвет cyan, чтобы рядом с p (blue)
  // и t (rose) сразу читался как «другой канал гидравлики».
  flow:     { label: 'Расход м³/ч',    short: 'Q', bg: 'bg-cyan-100',    fg: 'text-cyan-700',    ring: 'ring-cyan-300' },
  noise:    { label: 'Шум',            short: 'N', bg: 'bg-amber-100',   fg: 'text-amber-800',   ring: 'ring-amber-300' },
  detector: { label: 'Видеодетектор',  short: 'V', bg: 'bg-violet-100',  fg: 'text-violet-700',  ring: 'ring-violet-300' },
  // Оптоволокно (DAS): категориальное событие + координата вдоль кабеля.
  // Цвет indigo — отдельная семья «high-tech distributed sensor», не путать
  // с detector (violet) и noise (amber) — разная физика.
  fiber:    { label: 'Волокно DAS',    short: 'F', bg: 'bg-indigo-100',  fg: 'text-indigo-700',  ring: 'ring-indigo-300' },
  // Качество воздуха (ВОЗДУХ-ОМ): CO2 / PM2.5 / PM10 / NO2. Цвет sky —
  // ассоциация «небо/атмосфера», отличается от p (blue) и flow (cyan).
  air:      { label: 'Качество возд.', short: 'A', bg: 'bg-sky-100',     fg: 'text-sky-700',     ring: 'ring-sky-300' },
}
