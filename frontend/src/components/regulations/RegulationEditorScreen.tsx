import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CalendarClock,
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  CopyCheck,
  FileCode2,
  Flag,
  GitCommit,
  Hash,
  History,
  Info,
  type LucideIcon,
  ListTodo,
  MessageSquare,
  Plus,
  Ruler,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sliders,
  Tag,
  Target,
  Timer,
  Trash2,
} from 'lucide-react'
import { api, type Parameter, type Regulation } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { cn } from '@/lib/cn'
import { deriveSliderRange, fillPercent as computeFillPercent } from '@/lib/sliderDomain'
import { Badge, Button, Section, Tabs, type TabDef } from '@/components/ui'
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
      {/* Approval workflow: Опубликовать → Архивировать (зависит от статуса).
          Стили через ui Button: 'secondary' с success/neutral иконкой — не делаем
          их primary, чтобы основная primary-кнопка (Сохранить) визуально доминировала. */}
      {currentStatus !== 'active' && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Send size={13} className="text-emerald-600" />}
          onClick={() => publish.mutate()}
          loading={publish.isPending}
          disabled={publish.isPending || dirty}
          title={dirty ? 'Сначала сохраните черновик' : 'Перевести в статус active'}
        >
          {publish.isPending ? 'Публикую…' : 'Опубликовать'}
        </Button>
      )}
      {currentStatus === 'active' && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Archive size={13} />}
          onClick={() => archive.mutate()}
          loading={archive.isPending}
        >
          {archive.isPending ? 'Архивирую…' : 'Архивировать'}
        </Button>
      )}
      <Button
        size="sm"
        variant={showHistory ? 'secondary' : 'ghost'}
        icon={<History size={13} />}
        onClick={() => setShowHistory((x) => !x)}
        aria-pressed={showHistory}
        className={cn(showHistory && 'border-stone-300 bg-stone-100 text-stone-800')}
      >
        История
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={<CircleSlash size={13} />}
        onClick={() => regulation && setDraft(structuredClone(regulation) as Regulation)}
        disabled={!dirty}
      >
        Отменить
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon={<Save size={13} />}
        onClick={() => draft && save.mutate(draft)}
        loading={save.isPending}
        disabled={!dirty || save.isPending}
      >
        {save.isPending ? 'Сохраняю…' : 'Сохранить'}
      </Button>
    </>
  )

  // Sub-табы режима редактора (Поля / Слайдеры / Turtle) — внутри Model Layer
  // (regulation), поэтому tone='primary'. См. DESIGN_SYSTEM.md §1.
  const editorTabs: TabDef<Tab>[] = TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))

  const subHeader = (
    <>
      <div className="border-t border-stone-200 bg-white/60 px-5 py-1.5">
        <Tabs tabs={editorTabs} active={tab} onChange={setTab} tone="primary" />
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
      <Section
        title={<SectionTitle icon={Info} label="Метаданные" />}
        elevated
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormRow label="Название" icon={Tag}>
            <textarea
              rows={2}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Дата принятия" icon={Calendar}>
            <input
              type="date"
              value={draft.date ?? ''}
              onChange={(e) => patch({ date: e.target.value || null })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Версия" icon={GitCommit}>
            <input
              value={draft.version}
              onChange={(e) => patch({ version: e.target.value })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Статус" icon={Flag}>
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
      </Section>

      {/* Нормативное основание — SIGMA §4.1.3, §4.2.2 #3 (объяснимость).
          Указываем где «живёт» правило в исходном нормативном поле и до
          какой даты оно действует. Используется для аудита решений. */}
      <Section
        title={<SectionTitle icon={BookOpen} label="Нормативное основание" />}
        description="Источник правила в нормативной базе и период действия. Используется для объяснимости решений и аудита (SIGMA §4.1.3)."
        elevated
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormRow label="Нормативный документ" icon={BookOpen}>
            <input
              value={draft.source_document ?? ''}
              onChange={(e) => patch({ source_document: e.target.value || null })}
              placeholder="напр. СП 124.13330.2012 «Тепловые сети»"
              className={tx}
            />
          </FormRow>
          <FormRow label="Пункт / раздел" icon={Hash}>
            <input
              value={draft.source_clause ?? ''}
              onChange={(e) => patch({ source_clause: e.target.value || null })}
              placeholder="напр. §5.10 или п. 7.2.3"
              className={tx}
            />
          </FormRow>
          <FormRow label="Действует с" icon={CalendarClock}>
            <input
              type="date"
              value={draft.valid_from ?? ''}
              onChange={(e) => patch({ valid_from: e.target.value || null })}
              className={tx}
            />
          </FormRow>
          <FormRow label="Действует по" icon={Timer}>
            <input
              type="date"
              value={draft.valid_to ?? ''}
              onChange={(e) => patch({ valid_to: e.target.value || null })}
              className={tx}
            />
          </FormRow>
        </div>
      </Section>

      {/* Параметры */}
      <Section
        title={
          <SectionTitle icon={Sliders} label="Параметры">
            <Badge tone="neutral">{draft.parameters.length}</Badge>
          </SectionTitle>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={12} />}
            onClick={addParam}
          >
            Добавить параметр
          </Button>
        }
        elevated
      >
        <div className="space-y-2">
          {draft.parameters.length === 0 && (
            <div className="rounded-md border border-dashed border-stone-300 p-4 text-center text-sm text-stone-400">
              Нет параметров. Нажмите «Добавить параметр».
            </div>
          )}
          {draft.parameters.map((p, idx) => (
            <div
              key={p.id}
              className="flex overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm transition hover:border-primary/40"
            >
              {/* Node-RED-style accent strip с иконкой типа параметра */}
              <div className="flex w-9 shrink-0 items-start justify-center bg-primary/90 pt-3 text-white">
                <Sliders size={14} />
              </div>
              <div className="min-w-0 flex-1 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-stone-400">#{idx + 1}</span>
                  <button
                    onClick={() => removeParam(idx)}
                    title="Удалить параметр"
                    className="rounded-md p-1 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
                  <FormRow label="Имя" icon={Tag} compact>
                    <input value={p.name} onChange={(e) => patchParam(idx, { name: e.target.value })} className={tx} />
                  </FormRow>
                  <FormRow label="Reference" icon={Target} compact>
                    <input
                      type="number"
                      value={p.referenceValue ?? ''}
                      onChange={(e) => patchParam(idx, { referenceValue: e.target.value === '' ? null : Number(e.target.value) })}
                      className={tx}
                      step="any"
                    />
                  </FormRow>
                  <FormRow label="Deviation" icon={Sliders} compact>
                    <input
                      type="number"
                      value={p.deviationAllowed ?? ''}
                      onChange={(e) => patchParam(idx, { deviationAllowed: e.target.value === '' ? null : Number(e.target.value) })}
                      className={tx}
                      step="any"
                    />
                  </FormRow>
                  <FormRow label="Ед. изм." icon={Ruler} compact>
                    <input
                      value={p.unit ?? ''}
                      onChange={(e) => patchParam(idx, { unit: e.target.value || null })}
                      className={tx}
                    />
                  </FormRow>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-md border border-emerald-100 bg-emerald-50/40 p-2">
                  <FormRow label="SHACL min ≥" icon={ShieldCheck} compact>
                    <input
                      type="number"
                      value={p.minInclusive ?? ''}
                      onChange={(e) => patchParam(idx, { minInclusive: e.target.value === '' ? null : Number(e.target.value) })}
                      className={tx}
                      step="any"
                    />
                  </FormRow>
                  <FormRow label="SHACL max ≤" icon={ShieldCheck} compact>
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
            </div>
          ))}
        </div>
      </Section>

      {/* Рекомендация */}
      <Section
        title={<SectionTitle icon={ListTodo} label="Рекомендация" />}
        description="Текст, который выдаём пользователю при срабатывании регламента."
        elevated
      >
        <FormRow label="Приоритет" icon={AlertTriangle}>
          <div className="flex gap-1">
            {[1, 2, 3].map((pr) => {
              const labels: Record<number, { text: string; tone: 'danger' | 'warning' | 'neutral' }> = {
                1: { text: '1 — критический', tone: 'danger' },
                2: { text: '2 — важный', tone: 'warning' },
                3: { text: '3 — обычный', tone: 'neutral' },
              }
              const { text, tone } = labels[pr]
              const active = recPriority === pr
              const activeStyle =
                tone === 'danger' ? 'border-rose-300 bg-rose-50 text-rose-800'
                : tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-stone-300 bg-stone-100 text-stone-800'
              return (
                <button
                  key={pr}
                  onClick={() => setRec(recText, pr)}
                  className={cn(
                    'rounded-md border px-2.5 py-0.5 text-xs transition',
                    active ? activeStyle : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                  )}
                >
                  {text}
                </button>
              )
            })}
          </div>
        </FormRow>
        <FormRow label="Текст" icon={MessageSquare}>
          <textarea
            rows={6}
            value={recText}
            onChange={(e) => setRec(e.target.value)}
            className={cn(tx, 'leading-relaxed')}
            placeholder="При возникновении ситуации: 1) … 2) … 3) …"
          />
        </FormRow>
      </Section>
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children?: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={14} className="text-stone-500" />
      <span>{label}</span>
      {children}
    </span>
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
      <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs text-sky-900">
        <Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
        <div className="space-y-2">
          <div>
            Слайдеры — быстрая калибровка <b>reference</b> и <b>deviation</b> каждого параметра. Диапазон берётся из
            SHACL <code>sh:minInclusive</code> / <code>sh:maxInclusive</code>, шаг — эвристика. Точные значения можно
            править на вкладке «Поля». Сохранение — общее, кнопкой «Сохранить» в шапке.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sky-100 pt-2 text-[11px]">
            <span className="font-medium">Легенда трека:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-7 rounded-full bg-sky-500" />
              <span className="text-stone-700">слева от шарика — текущее значение</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-7 rounded-full bg-sky-200" />
              <span className="text-stone-700">справа — остаток до верхней границы SHACL</span>
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {draft.parameters.map((p, idx) => (
          <ParameterSliderRow key={p.id} param={p} onChange={(patch) => update(idx, patch)} />
        ))}
      </div>
    </div>
  )
}

function ParameterSliderRow({
  param,
  onChange,
}: {
  param: Parameter
  onChange: (p: Partial<Parameter>) => void
}) {
  // Snapshot диапазона: фиксируем при монтировании / при смене SHACL bounds.
  // Без этого был положительный feedback: тянешь reference вправо → ref растёт →
  // padding = 2·|ref| → max растёт → правый край уходит → можно тянуть ещё дальше →
  // экспоненциальный взрыв (на скриншоте: ref=5 → 78 млрд мм за несколько кликов).
  // Pure deriveSliderRange зависит от ref, и это правильно для чистой функции —
  // но в UI нам нужна стабильная шкала.
  const [snapshot, setSnapshot] = useState(() => deriveSliderRange(param))

  // Пересчитываем snapshot только при смене параметра или SHACL bounds —
  // именно тогда юзер ЯВНО хочет новый масштаб.
  useEffect(() => {
    setSnapshot(deriveSliderRange(param))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param.id, param.minInclusive, param.maxInclusive])

  const { min, max, step, devMax } = snapshot
  const refValue = param.referenceValue ?? 0
  const devValue = param.deviationAllowed ?? 0

  // Флаги переполнения пересчитываем по актуальному значению (не snapshot'у),
  // иначе они «застывают» с момента монтирования.
  const devOverflow = Math.abs(devValue) > devMax
  const devTooWide = refValue !== 0 && Math.abs(devValue) > Math.abs(refValue)
  const refOutOfRange = refValue < min || refValue > max

  const rebase = () => setSnapshot(deriveSliderRange(param))

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

      {refOutOfRange && <RefOutOfRangeBanner refValue={refValue} min={min} max={max} onRebase={rebase} />}

      {(devOverflow || devTooWide) && (
        <DeviationWarning
          overflow={devOverflow}
          tooWide={devTooWide}
          devMax={devMax}
          refValue={refValue}
        />
      )}

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

function RefOutOfRangeBanner({
  refValue,
  min,
  max,
  onRebase,
}: {
  refValue: number
  min: number
  max: number
  onRebase: () => void
}) {
  // ref вышел за зафиксированный snapshot — обычно когда юзер напечатал большое число
  // в number-input справа. Кнопка перерасчитывает масштаб ВРУЧНУЮ — это страховка от
  // случайного экспоненциального взрыва, но при явном желании всё работает.
  return (
    <div className="mt-1 flex items-center justify-between gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
      <span className="flex items-center gap-1.5">
        <AlertTriangle size={12} className="shrink-0 text-sky-600" />
        Значение <b className="font-mono">{refValue}</b> вне текущего масштаба [{min}, {max}] —
        слайдер прижат к краю.
      </span>
      <button
        type="button"
        onClick={onRebase}
        className="shrink-0 rounded border border-sky-300 bg-white px-2 py-0.5 font-medium text-sky-700 hover:bg-sky-100"
      >
        Перерасчитать масштаб
      </button>
    </div>
  )
}

function DeviationWarning({
  overflow,
  tooWide,
  devMax,
  refValue,
}: {
  overflow: boolean
  tooWide: boolean
  devMax: number
  refValue: number
}) {
  // Overflow важнее: рассинхрон визуального диапазона. tooWide — мягкая семантика.
  if (overflow) {
    return (
      <div className="mt-1 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
        <span>
          Отклонение не помещается в текущий диапазон (max ≈ {devMax.toFixed(2)}). Расширь SHACL
          <code className="mx-1 rounded bg-amber-100 px-1">maxInclusive</code> или уменьши deviation —
          сейчас шарик упирается в правый край.
        </span>
      </div>
    )
  }
  if (tooWide) {
    return (
      <div className="mt-1 flex items-start gap-1.5 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] text-stone-600">
        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-stone-500" />
        <span>
          Отклонение больше самого reference ({refValue}). Иногда это норма (например, PM2.5: 10 ± 10),
          но чаще — опечатка. Перепроверь.
        </span>
      </div>
    )
  }
  return null
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
  // `text-emerald-500` / `text-amber-500` управляет цветом thumb через `currentColor`
  // в .ragraf-range. Заполненная/пустая части track — sky-500/sky-200 через --fill.
  const accentClass = accent === 'emerald' ? 'text-emerald-500' : 'text-amber-500'

  // Доля «выдвинутой» части: сколько процентов диапазона уже выбрано.
  // По этой переменной CSS gradient на ::runnable-track красит левую часть
  // sky-500 (current), правую — sky-200 (доступный остаток). Кламп защищает
  // от value за пределами [min, max] — иначе fill ушёл бы > 100% или < 0%.
  const fillPercent = computeFillPercent(value, min, max)

  const trackTitle =
    `${label}: ${value.toFixed(step < 1 ? 2 : 0)} из диапазона [${min}, ${max}].` +
    `\nСлева от шарика (sky-500) — текущее значение, справа (sky-200) — куда ещё можно сдвинуть.`

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
        title={trackTitle}
        style={{ ['--fill' as never]: `${fillPercent}%` }}
        className={cn('ragraf-range flex-1', accentClass)}
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

// Node-RED-style input: чуть утолщённый border, заметный focus-ring, ровные
// 28px высоты для соразмерности с иконками подписей и Button size=sm.
const tx = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 placeholder:text-stone-400 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 hover:border-stone-400'

function FormRow({
  label,
  icon: Icon,
  children,
  compact,
}: {
  label: string
  icon?: LucideIcon
  children: React.ReactNode
  compact?: boolean
}) {
  // Node-RED-стиль: uppercase-капитель, заметнее чем lowercase-серый. Иконка
  // в primary/60 — выделяется относительно стоунового бэкграунда.
  return (
    <label className={cn('block', compact ? '' : 'space-y-1')}>
      <div className={cn(
        'inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600',
        compact ? 'mb-1' : '',
      )}>
        {Icon && <Icon size={12} className="text-primary/70" />}
        {label}
      </div>
      {children}
    </label>
  )
}
