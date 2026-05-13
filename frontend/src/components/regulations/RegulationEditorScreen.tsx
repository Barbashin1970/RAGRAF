import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  CopyCheck,
  FileCode2,
  History,
  type LucideIcon,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sliders,
  Trash2,
} from 'lucide-react'
import { api, type Parameter, type Regulation } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { cn } from '@/lib/cn'
import { RegulationHeader } from './RegulationHeader'

type Tab = 'form' | 'sliders' | 'source'

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'form',    label: 'Поля',     icon: CopyCheck },
  { id: 'sliders', label: 'Слайдеры', icon: Sliders   },
  { id: 'source',  label: 'Turtle',   icon: FileCode2 },
]

const STATUS_OPTIONS: Array<{ id: Regulation['status']; label: string; color: string }> = [
  { id: 'draft',    label: 'черновик',  color: 'bg-amber-100 text-amber-800 border-amber-200' },
  { id: 'active',   label: 'активный',  color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: 'archived', label: 'архив',     color: 'bg-stone-200 text-stone-700 border-stone-300' },
]

export function RegulationEditorScreen() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: regulation, isLoading } = useQuery({
    queryKey: ['regulation', id],
    queryFn: () => api.regulations.get(id),
    enabled: !!id,
  })

  // Локальная редактируемая копия. При перезагрузке regulation — сбрасываем.
  const [draft, setDraft] = useState<Regulation | null>(null)
  const [tab, setTab] = useState<Tab>('form')
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (regulation) setDraft(structuredClone(regulation) as Regulation)
  }, [regulation])

  const dirty = useMemo(() => {
    if (!regulation || !draft) return false
    return JSON.stringify(regulation) !== JSON.stringify(draft)
  }, [regulation, draft])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['regulation', id] })
    qc.invalidateQueries({ queryKey: ['datasets'] })
    qc.invalidateQueries({ queryKey: ['flow', id] })
    qc.invalidateQueries({ queryKey: ['regulation-history', id] })
  }

  const save = useMutation({
    mutationFn: (next: Regulation) => api.regulations.save(id, next),
    onSuccess: invalidateAll,
  })

  const publish = useMutation({
    mutationFn: () => api.regulations.publish(id),
    onSuccess: invalidateAll,
  })
  const archive = useMutation({
    mutationFn: () => api.regulations.archive(id),
    onSuccess: invalidateAll,
  })

  const stats = [
    { icon: Sliders, value: draft?.parameters.length ?? 0, label: 'параметров' },
  ]

  const currentStatus = regulation?.status ?? 'draft'
  const actions = (
    <>
      {/* Approval workflow */}
      {currentStatus !== 'active' && (
        <button
          onClick={() => publish.mutate()}
          disabled={publish.isPending || dirty}
          title={dirty ? 'Сначала сохраните черновик' : 'Перевести в статус active'}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
        >
          <Send size={13} className="text-emerald-500" />
          {publish.isPending ? 'Публикую…' : 'Опубликовать'}
        </button>
      )}
      {currentStatus === 'active' && (
        <button
          onClick={() => archive.mutate()}
          disabled={archive.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
        >
          <Archive size={13} className="text-stone-500" />
          {archive.isPending ? 'Архивирую…' : 'Архивировать'}
        </button>
      )}
      <button
        onClick={() => setShowHistory((x) => !x)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
          showHistory
            ? 'border-stone-300 bg-stone-100 text-stone-800'
            : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50',
        )}
      >
        <History size={13} className="text-stone-500" />
        История
      </button>
      <button
        onClick={() => regulation && setDraft(structuredClone(regulation) as Regulation)}
        disabled={!dirty}
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-40"
      >
        <CircleSlash size={13} className="text-stone-500" /> Отменить
      </button>
      <button
        onClick={() => draft && save.mutate(draft)}
        disabled={!dirty || save.isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
      >
        <Save size={13} />
        {save.isPending ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </>
  )

  const subHeader = (
    <>
      <div className="border-t border-stone-200 bg-white/60 px-5 py-1.5">
        <div className="flex items-center gap-1 rounded-md border border-stone-200 bg-white p-0.5 w-fit">
          {TABS.map((t) => {
            const TIcon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition',
                  t.id === tab ? 'bg-primary/10 text-primary' : 'text-stone-600 hover:bg-stone-50',
                )}
              >
                <TIcon size={12} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {save.data?.upstream_error && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-1.5 text-xs text-amber-800">
          Сохранено локально, но не получилось отправить в upstream: {save.data.upstream_error}
        </div>
      )}
      {save.isSuccess && !save.data?.upstream_error && (
        <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-1.5 text-xs text-emerald-700">
          Сохранено · версия {save.data.version.slice(0, 8)}
        </div>
      )}
    </>
  )

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <RegulationHeader
        regulation={regulation}
        isLoading={isLoading}
        sourceId={id}
        active="edit"
        stats={stats}
        actions={actions}
        subHeader={subHeader}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {!draft && <div className="text-sm text-stone-500">Загрузка…</div>}
          {draft && tab === 'form' && (
            <FormView draft={draft} setDraft={setDraft} />
          )}
          {draft && tab === 'sliders' && (
            <SlidersView draft={draft} setDraft={setDraft} />
          )}
          {draft && tab === 'source' && (
            <SourceView sourceId={id} draft={draft} />
          )}
        </div>
        {showHistory && <HistoryPanel id={id} onRestore={() => qc.invalidateQueries({ queryKey: ['regulation', id] })} />}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// View 1 — Form (поля)
// ──────────────────────────────────────────────────────────

function FormView({
  draft,
  setDraft,
}: {
  draft: Regulation
  setDraft: (r: Regulation) => void
}) {
  const patch = (p: Partial<Regulation>) => setDraft({ ...draft, ...p })
  const patchParam = (idx: number, p: Partial<Parameter>) => {
    const next = draft.parameters.map((par, i) => (i === idx ? { ...par, ...p } : par))
    setDraft({ ...draft, parameters: next })
  }
  const addParam = () => {
    const np: Parameter = {
      id: `p_${nanoid(5)}`,
      name: `param_${draft.parameters.length + 1}`,
      datatype: 'decimal',
      referenceValue: 0,
      deviationAllowed: 0,
      unit: null,
      minInclusive: null,
      maxInclusive: null,
    }
    setDraft({ ...draft, parameters: [...draft.parameters, np] })
  }
  const removeParam = (idx: number) => {
    setDraft({ ...draft, parameters: draft.parameters.filter((_, i) => i !== idx) })
  }
  const recText = draft.recommendations[0]?.text ?? ''
  const recPriority = draft.recommendations[0]?.priority ?? 2
  const setRec = (text: string, priority?: number) => {
    const first = draft.recommendations[0]
    const next = {
      id: first?.id ?? `rec_${draft.id}`,
      text,
      priority: ((priority ?? recPriority) as 1 | 2 | 3),
      linkedParameters: first?.linkedParameters ?? draft.parameters.map((p) => p.id),
    }
    setDraft({ ...draft, recommendations: [next] })
  }

  return (
    <div className="space-y-4">
      {/* Метаданные */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-stone-700">Метаданные</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormRow label="Название">
            <textarea
              rows={2}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Дата принятия">
            <input
              type="date"
              value={draft.date ?? ''}
              onChange={(e) => patch({ date: e.target.value || null })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Версия">
            <input
              value={draft.version}
              onChange={(e) => patch({ version: e.target.value })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Статус">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => patch({ status: s.id })}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
                    draft.status === s.id ? s.color : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </FormRow>
        </div>
      </section>

      {/* Параметры */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-700">
            Параметры <span className="ml-1 text-xs font-normal text-stone-500">{draft.parameters.length}</span>
          </h3>
          <button
            onClick={addParam}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-stone-50"
          >
            <Plus size={12} className="text-stone-500" /> Добавить параметр
          </button>
        </div>
        <div className="space-y-2">
          {draft.parameters.length === 0 && (
            <div className="rounded-md border border-dashed border-stone-300 p-4 text-center text-sm text-stone-400">
              Нет параметров. Нажмите «Добавить параметр».
            </div>
          )}
          {draft.parameters.map((p, idx) => (
            <div key={p.id} className="rounded-md border border-stone-200 bg-stone-50/50 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <FormRow label="Имя" compact>
                  <input value={p.name} onChange={(e) => patchParam(idx, { name: e.target.value })} className={tx} />
                </FormRow>
                <FormRow label="Reference" compact>
                  <input
                    type="number"
                    value={p.referenceValue ?? ''}
                    onChange={(e) => patchParam(idx, { referenceValue: e.target.value === '' ? null : Number(e.target.value) })}
                    className={tx}
                    step="any"
                  />
                </FormRow>
                <FormRow label="Deviation" compact>
                  <input
                    type="number"
                    value={p.deviationAllowed ?? ''}
                    onChange={(e) => patchParam(idx, { deviationAllowed: e.target.value === '' ? null : Number(e.target.value) })}
                    className={tx}
                    step="any"
                  />
                </FormRow>
                <FormRow label="Ед. изм." compact>
                  <input
                    value={p.unit ?? ''}
                    onChange={(e) => patchParam(idx, { unit: e.target.value || null })}
                    className={tx}
                  />
                </FormRow>
                <div className="flex items-end pb-0.5">
                  <button
                    onClick={() => removeParam(idx)}
                    title="Удалить"
                    className="rounded-md p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500">
                <FormRow label="SHACL min ≥" compact>
                  <input
                    type="number"
                    value={p.minInclusive ?? ''}
                    onChange={(e) => patchParam(idx, { minInclusive: e.target.value === '' ? null : Number(e.target.value) })}
                    className={tx}
                    step="any"
                  />
                </FormRow>
                <FormRow label="SHACL max ≤" compact>
                  <input
                    type="number"
                    value={p.maxInclusive ?? ''}
                    onChange={(e) => patchParam(idx, { maxInclusive: e.target.value === '' ? null : Number(e.target.value) })}
                    className={tx}
                    step="any"
                  />
                </FormRow>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Рекомендация */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-stone-700">Рекомендация</h3>
        <FormRow label="Приоритет">
          <div className="flex gap-1">
            {[1, 2, 3].map((pr) => (
              <button
                key={pr}
                onClick={() => setRec(recText, pr)}
                className={cn(
                  'rounded-md border px-2.5 py-0.5 text-xs',
                  recPriority === pr
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                )}
              >
                {pr === 1 ? '1 — критический' : pr === 2 ? '2 — важный' : '3 — обычный'}
              </button>
            ))}
          </div>
        </FormRow>
        <FormRow label="Текст">
          <textarea
            rows={6}
            value={recText}
            onChange={(e) => setRec(e.target.value)}
            className={cn(tx, 'leading-relaxed')}
            placeholder="При возникновении ситуации: 1) … 2) … 3) …"
          />
        </FormRow>
      </section>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// View 2 — Sliders (быстрая настройка ref/dev)
// ──────────────────────────────────────────────────────────

function SlidersView({
  draft,
  setDraft,
}: {
  draft: Regulation
  setDraft: (r: Regulation) => void
}) {
  const update = (idx: number, p: Partial<Parameter>) => {
    setDraft({
      ...draft,
      parameters: draft.parameters.map((par, i) => (i === idx ? { ...par, ...p } : par)),
    })
  }

  if (draft.parameters.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        Нет параметров для настройки. Перейдите во вкладку «Поля» и добавьте параметр.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-blue-100 bg-blue-50/40 px-4 py-3 text-xs text-blue-900">
        Слайдеры — быстрая калибровка <b>reference</b> и <b>deviation</b> каждого параметра. Диапазон слайдера берётся
        из SHACL <code>sh:minInclusive</code> / <code>sh:maxInclusive</code>, шаг — эвристика. Точные значения можно
        править на вкладке «Поля». Сохранение — общее, кнопкой «Сохранить» в шапке.
      </div>
      {draft.parameters.map((p, idx) => (
        <ParameterSliderRow key={p.id} param={p} onChange={(patch) => update(idx, patch)} />
      ))}
    </div>
  )
}

function deriveSliderRange(p: Parameter): { min: number; max: number; step: number } {
  const ref = p.referenceValue ?? 0
  const dev = p.deviationAllowed ?? 1
  const lo = p.minInclusive
  const hi = p.maxInclusive

  // Используем SHACL bounds если они есть, иначе строим диапазон вокруг ref±5*dev.
  let min = lo !== null && lo !== undefined ? lo : ref - 5 * (dev || 1)
  let max = hi !== null && hi !== undefined ? hi : ref + 5 * (dev || 1)
  if (min >= max) {
    min = ref - 10
    max = ref + 10
  }
  const span = max - min
  // Шаг — эвристика: 1/100 диапазона, округлённая до «красивого» значения.
  const niceSteps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
  const target = span / 100
  const step = niceSteps.find((s) => s >= target) ?? 10

  return { min, max, step }
}

function ParameterSliderRow({
  param,
  onChange,
}: {
  param: Parameter
  onChange: (p: Partial<Parameter>) => void
}) {
  const { min, max, step } = deriveSliderRange(param)
  const refValue = param.referenceValue ?? 0
  const devValue = param.deviationAllowed ?? 0
  // Слайдер deviation — от 0 до половины диапазона.
  const devMax = Math.max((max - min) / 2, 1)

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-stone-800">{param.name}</span>
          {param.unit && <span className="text-xs text-stone-500">{param.unit}</span>}
        </div>
        <div className="rounded-md bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-700">
          {refValue} ± {devValue}
        </div>
      </div>

      <SliderRow
        label="reference"
        value={refValue}
        min={min}
        max={max}
        step={step}
        onChange={(v) => onChange({ referenceValue: v })}
        accent="emerald"
      />
      <SliderRow
        label="deviation"
        value={devValue}
        min={0}
        max={devMax}
        step={step}
        onChange={(v) => onChange({ deviationAllowed: v })}
        accent="amber"
      />

      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>min: {min}</span>
        {param.minInclusive !== null && param.minInclusive !== undefined && (
          <span className="text-emerald-700">SHACL ≥ {param.minInclusive}</span>
        )}
        {param.maxInclusive !== null && param.maxInclusive !== undefined && (
          <span className="text-emerald-700">SHACL ≤ {param.maxInclusive}</span>
        )}
        <span>max: {max}</span>
      </div>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  accent,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  accent: 'emerald' | 'amber'
}) {
  const accentClass = accent === 'emerald' ? 'accent-emerald-500' : 'accent-amber-500'
  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-stone-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('flex-1', accentClass)}
      />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 shrink-0 rounded border border-stone-200 px-1.5 py-1 text-right font-mono text-xs"
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// View 3 — Source Turtle (read-only preview)
// ──────────────────────────────────────────────────────────

function SourceView({ sourceId, draft }: { sourceId: string; draft: Regulation }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['regulation-raw', sourceId, JSON.stringify(draft)],
    queryFn: () => api.regulations.raw(sourceId),
    // Здесь показываем что лежит в backend; при правке draft пересоберётся в Turtle уже после save.
  })

  return (
    <div>
      <div className="mb-3 rounded-md border border-stone-200 bg-stone-50/60 p-3 text-xs text-stone-600">
        Сырой Turtle из локального store (DuckDB). Изменения в редакторе появятся здесь после «Сохранить» — это и есть
        то, что мы отдаём наружу через <code>GET /api/regulations/{sourceId}/raw</code> (и при <code>WRITEBACK_UPSTREAM=true</code>
        отправляем в upstream <code>PUT /data</code>).
        <button onClick={() => refetch()} className="ml-2 underline">Обновить</button>
      </div>
      {isLoading && <div className="text-sm text-stone-500">Загрузка…</div>}
      {error && <div className="text-sm text-rose-700">Ошибка: {(error as Error).message}</div>}
      {data && (
        <pre className="overflow-auto rounded-lg border border-stone-200 bg-stone-900 p-4 font-mono text-xs leading-relaxed text-stone-100">
          {data}
        </pre>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// History panel (правая колонка)
// ──────────────────────────────────────────────────────────

function HistoryPanel({ id, onRestore }: { id: string; onRestore: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['regulation-history', id],
    queryFn: () => api.regulations.history(id),
  })
  const restore = useMutation({
    mutationFn: (vid: string) => api.regulations.restore(id, vid),
    onSuccess: onRestore,
  })

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-3 text-sm">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-stone-500">
        <span>История правок</span>
        {data && <span className="rounded-full bg-stone-100 px-2 py-0.5">{data.length}</span>}
      </div>
      {isLoading && <div className="text-stone-500">Загрузка…</div>}
      {(data ?? []).map((v, idx) => {
        const isLatest = idx === 0
        const isInitial = v.diff_counts.initial && v.diff_counts.initial > 0
        const expanded = expandedId === v.version_id
        return (
          <div
            key={v.version_id}
            className={cn(
              'mb-1.5 overflow-hidden rounded-md border bg-white transition',
              isLatest ? 'border-primary/40 ring-1 ring-primary/20' : 'border-stone-200',
            )}
          >
            <div className="p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-stone-500">{v.version_id.slice(0, 8)}</span>
                  {isLatest && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                      текущая
                    </span>
                  )}
                  {isInitial && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                      seed
                    </span>
                  )}
                </div>
                <DiffBadges counts={v.diff_counts} />
              </div>
              <div className="mt-0.5 text-[11px] text-stone-600">
                {new Date(v.created_at).toLocaleString('ru-RU')} · {v.author}
              </div>
              <div className="mt-1 text-xs leading-snug text-stone-800">
                <span className="font-medium">{v.diff_summary}</span>
              </div>
              {v.comment && v.comment !== 'UI edit' && (
                <div className="mt-1 line-clamp-2 text-[11px] italic text-stone-500">{v.comment}</div>
              )}

              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => setExpandedId(expanded ? null : v.version_id)}
                  className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-[10px] text-stone-700 hover:bg-stone-50"
                  disabled={!!isInitial}
                  title={isInitial ? 'Это первая версия — сравнивать не с чем' : ''}
                >
                  {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  {expanded ? 'Скрыть' : 'Что изменилось'}
                </button>
                <button
                  onClick={() => restore.mutate(v.version_id)}
                  disabled={isLatest || restore.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                >
                  <RotateCcw size={11} className="text-amber-500" />
                  Восстановить
                </button>
              </div>
            </div>

            {expanded && <DiffDetail id={id} versionId={v.version_id} />}
          </div>
        )
      })}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="text-stone-400">Правок ещё не было.</div>
      )}
    </aside>
  )
}

function DiffBadges({ counts }: { counts: { changed?: number; added?: number; removed?: number; initial?: number } }) {
  return (
    <div className="flex items-center gap-0.5">
      {!!counts.added && (
        <span className="rounded-full bg-emerald-100 px-1.5 text-[9px] font-medium text-emerald-700">+{counts.added}</span>
      )}
      {!!counts.removed && (
        <span className="rounded-full bg-rose-100 px-1.5 text-[9px] font-medium text-rose-700">−{counts.removed}</span>
      )}
      {!!counts.changed && (
        <span className="rounded-full bg-blue-100 px-1.5 text-[9px] font-medium text-blue-700">~{counts.changed}</span>
      )}
    </div>
  )
}

function DiffDetail({ id, versionId }: { id: string; versionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['regulation-diff', id, versionId],
    queryFn: () => api.regulations.diff(id, versionId),
  })
  if (isLoading) {
    return <div className="border-t border-stone-100 bg-stone-50 px-2 py-1.5 text-[11px] text-stone-400">Загрузка diff…</div>
  }
  if (!data || data.changes.length === 0) {
    return <div className="border-t border-stone-100 bg-stone-50 px-2 py-1.5 text-[11px] text-stone-400">Без структурных изменений</div>
  }
  return (
    <div className="border-t border-stone-100 bg-stone-50 px-2 py-1.5">
      <ul className="space-y-1">
        {data.changes.map((c, i) => (
          // R5: устойчивый ключ — комбинация op + path (уникальна в рамках одной версии).
          // Index-only key давал ложное reuse при смене версии и потерю focus в полях,
          // которых здесь нет, но рекомендации Sigma audit единообразны.
          <li key={`${c.op}-${c.path}-${i}`} className="text-[11px] leading-snug">
            <div className="flex items-center gap-1">
              {c.op === 'changed' && <span className="rounded bg-blue-100 px-1 font-mono text-[9px] text-blue-700">~</span>}
              {c.op === 'added' && <span className="rounded bg-emerald-100 px-1 font-mono text-[9px] text-emerald-700">+</span>}
              {c.op === 'removed' && <span className="rounded bg-rose-100 px-1 font-mono text-[9px] text-rose-700">−</span>}
              <span className="font-medium text-stone-800">{c.label || c.path}</span>
            </div>
            {c.op === 'changed' && (
              <div className="ml-3.5 mt-0.5 break-words text-[11px] text-stone-600">
                <span className="rounded bg-rose-50 px-1 line-through text-rose-700">{String(c.before)}</span>
                <span className="mx-1 text-stone-400">→</span>
                <span className="rounded bg-emerald-50 px-1 text-emerald-700">{String(c.after)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

const tx = 'mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40'

function FormRow({
  label,
  children,
  compact,
}: {
  label: string
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <label className={cn('block', compact ? '' : 'space-y-0.5')}>
      <div className={cn('text-xs text-stone-500', compact ? 'mb-0.5' : '')}>{label}</div>
      {children}
    </label>
  )
}
