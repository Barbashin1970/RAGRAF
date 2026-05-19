import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CalendarClock,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  CopyCheck,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Flag,
  GitCommit,
  Hash,
  History,
  Info,
  Link2,
  Loader2,
  type LucideIcon,
  ListTodo,
  MessageSquare,
  Network,
  Paperclip,
  Plus,
  Quote,
  Radio,
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
  Upload,
  Zap,
} from 'lucide-react'
import { api, type Parameter, type Regulation, type RegulationTrigger } from '@/lib/api'
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

  // ───────────── Edit-tab state (Поля / Слайдеры) ─────────────
  // `draft` — рабочая копия Regulation, редактируется во вкладках «Поля»
  // и «Слайдеры». Сохраняется через PUT /regulations/{id}.
  const [draft, setDraft] = useState<Regulation | null>(null)
  const [tab, setTab] = useState<Tab>('form')
  const [showHistory, setShowHistory] = useState(false)

  // Инициализация draft. Срабатывает только когда:
  //   - draft ещё пуст (первичный mount); или
  //   - в URL открыт другой регламент (regulation.id поменялся).
  // Фоновые refetch (window focus, invalidate соседних query) НЕ затирают
  // local edits — иначе любая правка пропадает.
  useEffect(() => {
    if (!regulation) return
    setDraft((current) => {
      if (current === null || current.id !== regulation.id) {
        return structuredClone(regulation) as Regulation
      }
      return current
    })
  }, [regulation])

  const formDirty = useMemo(() => {
    if (!regulation || !draft) return false
    const norm = (obj: unknown): string =>
      JSON.stringify(obj, (key, v) => {
        if (Array.isArray(v) && (key === 'parameters' || key === 'triggers')) {
          return [...v].sort((a, b) => {
            const ai = (a as { id?: string })?.id ?? ''
            const bi = (b as { id?: string })?.id ?? ''
            return ai.localeCompare(bi)
          })
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
            const val = (v as Record<string, unknown>)[k]
            acc[k] = val === undefined ? null : val
            return acc
          }, {})
        }
        return v
      })
    return norm(regulation) !== norm(draft)
  }, [regulation, draft])

  // ───────────── Turtle-tab state (вербатим-редактор) ─────────────
  // Поднято на родителя, чтобы верхняя кнопка «Сохранить» решала, что
  // именно сохранять в зависимости от активной вкладки. Так у юзера ОДИН
  // понятный canon: «есть несохранённые правки — кнопка тёмно-зелёная;
  // сохранил — бледная». Без дублирующейся кнопки внутри SourceView.
  const { data: turtleData } = useQuery({
    queryKey: ['regulation-raw', id],
    queryFn: () => api.regulations.raw(id),
    enabled: !!id,
    refetchOnWindowFocus: false,
  })
  const [turtleBuffer, setTurtleBuffer] = useState<string | null>(null)
  const [turtleBaseline, setTurtleBaseline] = useState<string | null>(null)
  useEffect(() => {
    if (turtleData !== undefined && turtleBaseline === null) {
      setTurtleBuffer(turtleData)
      setTurtleBaseline(turtleData)
    }
  }, [turtleData, turtleBaseline])
  const turtleDirty =
    turtleBuffer !== null && turtleBaseline !== null && turtleBuffer !== turtleBaseline

  // ───────────── Dispatch по активной вкладке ─────────────
  // dirty — единый флаг для верхней кнопки. На Turtle-вкладке смотрит на
  // turtleDirty, на остальных — на formDirty. Это устраняет проблему,
  // когда после Turtle-save верхняя «Сохранить» загоралась как «Form
  // dirty» (backend перегенерил draft, useQuery refetched, регламент
  // изменился, но локальный draft остался прежним → norm() расходился).
  const dirty = tab === 'source' ? turtleDirty : formDirty
  const onTurtleTab = tab === 'source'

  // После любого save — синкаем regulation с сервера и обновляем draft.
  // Заодно перетянем raw turtle если правились структурные поля (там
  // регенерится канон). Если правился Turtle — baseline уже знаем, не
  // делаем лишний raw-fetch.
  const syncRegulationFromServer = async (resetTurtleFromServer: boolean) => {
    // BUG-FIX 2026-05-19 (баг «первый сейв возвращает старое имя»):
    // глобальный staleTime=30s (см. main.tsx) делал кэш ['regulation', id]
    // «свежим» сразу после save'а — fetchQuery возвращал старое значение из
    // кэша, и setDraft(fresh) затирал только что введённое пользователем имя.
    // На второй сейв кэш успевал обновиться через фоновую инвалидацию из
    // соседних запросов, и баг «исчезал» — отсюда симптом «первый сейв
    // ломает, второй работает». Принудительно invalidate + refetch стабилизирует.
    await qc.invalidateQueries({ queryKey: ['regulation', id] })
    const fresh = await qc.fetchQuery({
      queryKey: ['regulation', id],
      queryFn: () => api.regulations.get(id),
      // staleTime: 0 — дополнительная подстраховка на случай если invalidate
      // выше всё-таки не сделал данные stale (race с другим observer).
      staleTime: 0,
    })
    if (fresh) setDraft(structuredClone(fresh) as Regulation)
    qc.invalidateQueries({ queryKey: ['datasets'] })
    qc.invalidateQueries({ queryKey: ['regulation-history', id] })
    qc.invalidateQueries({ queryKey: ['regulation-triggered-by', id] })
    qc.refetchQueries({ queryKey: ['flow', id] })
    if (resetTurtleFromServer) {
      // Form-save → backend инвалидировал raw_turtle → GET /raw регенерит
      // канон. Перетягиваем, обновляем baseline и buffer (если пользователь
      // не в Turtle-вкладке, его буфер не trump'ируем — но если он там и
      // не правил, baseline === buffer, замена безопасна).
      try {
        const freshRaw = await qc.fetchQuery({
          queryKey: ['regulation-raw', id],
          queryFn: () => api.regulations.raw(id),
        })
        if (freshRaw !== undefined) {
          setTurtleBaseline(freshRaw)
          // Не трогаем буфер если у юзера несохранённые правки в Turtle —
          // иначе он их потеряет.
          setTurtleBuffer((cur) =>
            cur === null || cur === turtleBaseline ? freshRaw : cur,
          )
        }
      } catch {
        // Не критично — следующий visit вкладки подтянет.
      }
    }
  }

  const saveForm = useMutation({
    mutationFn: (next: Regulation) => api.regulations.save(id, next),
    onSuccess: () => syncRegulationFromServer(true),
  })
  const saveTurtle = useMutation({
    mutationFn: async (turtle: string) => {
      await api.regulations.updateRaw(id, turtle)
      return turtle
    },
    onSuccess: async (savedText) => {
      setTurtleBaseline(savedText)
      qc.setQueryData(['regulation-raw', id], savedText)
      // Backend пересобрал структуру из распарсенного Turtle — обновляем
      // draft, чтобы вкладки «Поля» / «Слайдеры» видели актуальные
      // параметры. resetTurtleFromServer=false: мы УЖЕ знаем baseline
      // (это savedText), не нужно перезапрашивать.
      await syncRegulationFromServer(false)
    },
  })
  const saving = saveForm.isPending || saveTurtle.isPending

  const handleSave = () => {
    if (onTurtleTab && turtleDirty && turtleBuffer !== null) {
      saveTurtle.mutate(turtleBuffer)
    } else if (!onTurtleTab && formDirty && draft) {
      saveForm.mutate(draft)
    }
  }
  const handleUndo = () => {
    if (onTurtleTab && turtleBaseline !== null) {
      setTurtleBuffer(turtleBaseline)
    } else if (regulation) {
      setDraft(structuredClone(regulation) as Regulation)
    }
  }

  const publish = useMutation({
    mutationFn: () => api.regulations.publish(id),
    onSuccess: () => syncRegulationFromServer(true),
  })
  const archive = useMutation({
    mutationFn: () => api.regulations.archive(id),
    onSuccess: () => syncRegulationFromServer(true),
  })

  const stats = [
    { icon: Sliders, value: draft?.parameters.length ?? 0, label: 'параметров' },
  ]

  const currentStatus = regulation?.status ?? 'draft'
  const saveTitle = onTurtleTab
    ? (turtleDirty ? 'Сохранить Turtle (вкладка «Turtle»)' : 'Нет несохранённых правок')
    : (formDirty ? 'Сохранить правки полей' : 'Нет несохранённых правок')
  const actions = (
    <>
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
        variant="ghost"
        icon={<Download size={13} className="text-emerald-600" />}
        onClick={() => {
          window.location.href = `/api/regulations/${encodeURIComponent(id)}/export-bundle`
        }}
        title="Скачать ZIP с data.ttl + shapes.ttl + manifest.json для загрузки в СИГМУ"
      >
        Экспорт в СИГМУ
      </Button>
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
        onClick={handleUndo}
        disabled={!dirty}
      >
        Отменить
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon={<Save size={13} />}
        onClick={handleSave}
        loading={saving}
        disabled={!dirty || saving}
        title={saveTitle}
      >
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </Button>
    </>
  )

  const editorTabs: TabDef<Tab>[] = TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))

  const subHeader = (
    <>
      <div className="border-t border-stone-200 bg-white/60 px-5 py-1.5">
        <Tabs tabs={editorTabs} active={tab} onChange={setTab} tone="primary" />
      </div>
      {saveForm.data?.upstream_error && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-1.5 text-xs text-amber-800">
          Сохранено локально, но не получилось отправить в upstream: {saveForm.data.upstream_error}
        </div>
      )}
      {saveForm.isSuccess && !saveForm.data?.upstream_error && (
        <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-1.5 text-xs text-emerald-700">
          Сохранено · версия {saveForm.data.version.slice(0, 8)}
        </div>
      )}
      {saveTurtle.isSuccess && (
        <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-1.5 text-xs text-emerald-700">
          Turtle сохранён
        </div>
      )}
      {saveTurtle.isError && (
        <div className="border-t border-rose-200 bg-rose-50 px-5 py-1.5 text-xs text-rose-700">
          Ошибка сохранения Turtle: {(saveTurtle.error as Error).message}
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
            <SourceView
              sourceId={id}
              buffer={turtleBuffer}
              setBuffer={setTurtleBuffer}
              baseline={turtleBaseline}
              onReloadFromServer={async () => {
                const fresh = await qc.fetchQuery({
                  queryKey: ['regulation-raw', id],
                  queryFn: () => api.regulations.raw(id),
                })
                if (fresh !== undefined) {
                  setTurtleBuffer(fresh)
                  setTurtleBaseline(fresh)
                }
              }}
            />
          )}
        </div>
        {showHistory && (
          <HistoryPanel id={id} onRestore={() => syncRegulationFromServer(true)} />
        )}
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
    // Удаляем параметр + его триггер (если был). Без этого триггер становится
    // orphan'ом и подсвечивается красной рамкой; пользователь сам бы потом
    // его удалял — лишний шаг. param_ref — это p.id (стабильный идентификатор),
    // не p.name (отображаемое имя). Иначе после переименования параметра
    // триггер становился сиротой даже если связь логически сохранена.
    const removedParam = draft.parameters[idx]
    setDraft({
      ...draft,
      parameters: draft.parameters.filter((_, i) => i !== idx),
      triggers: (draft.triggers ?? []).filter((t) => t.param_ref !== removedParam?.id),
    })
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

  // Триггеры — теперь рисуются inline в карточке каждого параметра.
  // Один параметр = (опционально) один триггер. UI не показывает отдельную
  // секцию «Триггеры» — это устраняет orphan-триггеры и делает UX логичным
  // («параметр + откуда он наполняется» — одно понятие).
  //
  // КОНТРАКТ param_ref: всегда p.id (стабильный schema-идентификатор —
  // напр. `inletPressure`), НЕ p.name (отображаемое имя, может быть
  // переименовано в «Давление узла»). flow.json input.paramRef и
  // регламент Turtle :paramRef хранят тот же p.id. Без этого после
  // переименования параметра триггер не находил input в reconcile,
  // sensor-нода не появлялась в Flow.
  const triggers = draft.triggers ?? []
  const triggerForParam = (paramId: string): RegulationTrigger | undefined =>
    triggers.find((t) => t.param_ref === paramId)
  const upsertTriggerForParam = (
    paramId: string,
    paramName: string,
    patch: Partial<RegulationTrigger>,
  ) => {
    const idx = triggers.findIndex((t) => t.param_ref === paramId)
    if (idx >= 0) {
      const next = triggers.map((t, i) => (i === idx ? { ...t, ...patch } : t))
      setDraft({ ...draft, triggers: next })
    } else {
      // Новый триггер. id триггера — стабильный slug от p.id (не от p.name —
      // иначе при ренейме параметра менялся бы trigger.id, что нарушает
      // append-only историю и SHACL-валидацию URI).
      const nt: RegulationTrigger = {
        id: `trig-${paramId}`,
        label: paramName,
        param_ref: paramId,
        sensor_subtype: null,
        event_type: null,
        source_regulation: null,
        source_output: null,
        description: null,
        ...patch,
      }
      setDraft({ ...draft, triggers: [...triggers, nt] })
    }
  }
  const removeTriggerForParam = (paramId: string) => {
    setDraft({ ...draft, triggers: triggers.filter((t) => t.param_ref !== paramId) })
  }

  return (
    <div className="space-y-4">
      {/* Reverse-lookup: «этот регламент — триггер для N других». Видно сразу
          при открытии Edit/«Поля», чтобы аналитик понимал, что этот регламент
          участвует в event-driven цепочке. Загружается через отдельный query —
          инвалидируется одновременно с регламентом. */}
      <TriggeredByBanner regulationId={draft.id} />

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

      {/* Документ-основание — PROV-O attachment (вариант B: URL + цитата +
          локальный кэш). Сценарий: оцифровали бумажный приказ, держим PDF
          под рукой для самопроверки «откуда взялись 20.5 атм» перед
          заказчиком. См. README §«Документ-основание». */}
      <SourceAttachmentSection draft={draft} setDraft={setDraft} />

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
                <ParamTriggerInline
                  paramId={p.id}
                  paramName={p.name}
                  trigger={triggerForParam(p.id)}
                  currentRegulationId={draft.id}
                  onUpsert={(patch) => upsertTriggerForParam(p.id, p.name, patch)}
                  onRemove={() => removeTriggerForParam(p.id)}
                />
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

      {/* Секция «Триггеры» удалена — триггеры теперь рисуются inline на
          карточке каждого параметра, как «откуда наполняется этот вход». */}

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
// Reverse-lookup плашка: «этот регламент является триггером для N других».
// Делает event-driven композицию видимой со стороны регламента-источника,
// аналогично бэйджу подтипа датчика в Sensor Library.
// ──────────────────────────────────────────────────────────

function TriggeredByBanner({ regulationId }: { regulationId: string }) {
  const { data } = useQuery({
    queryKey: ['regulation-triggered-by', regulationId],
    queryFn: () => api.regulations.triggeredBy(regulationId),
    enabled: Boolean(regulationId),
  })
  if (!data || data.count === 0) return null

  // Группируем триггеры по regulation_id чтобы каждый регламент показать
  // одной строкой со списком его триггер-action'ов (если у одного потребителя
  // несколько триггеров на наш output — слипнутся в один пункт).
  const grouped = new Map<string, {
    regulation_id: string
    regulation_name: string
    domain?: string | null
    outputs: string[]
  }>()
  for (const t of data.triggers) {
    const key = t.regulation_id
    const cur = grouped.get(key)
    if (cur) {
      if (t.source_output && !cur.outputs.includes(t.source_output)) {
        cur.outputs.push(t.source_output)
      }
    } else {
      grouped.set(key, {
        regulation_id: t.regulation_id,
        regulation_name: t.regulation_name,
        domain: t.domain,
        outputs: t.source_output ? [t.source_output] : [],
      })
    }
  }
  const consumers = Array.from(grouped.values())

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/60 p-3 text-violet-900">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
        <Network size={13} className="text-violet-600" />
        <span>
          Этот регламент является триггером для{' '}
          <span className="font-mono">{consumers.length}</span>{' '}
          {consumers.length === 1 ? 'регламента' : 'регламентов'}
        </span>
      </div>
      <ul className="ml-5 list-disc space-y-0.5 text-[11px]">
        {consumers.map((c) => (
          <li key={c.regulation_id}>
            <Link
              to={`/regulations/${encodeURIComponent(c.regulation_id)}/edit`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {c.regulation_name}
            </Link>
            <span className="ml-1 font-mono text-[10px] text-violet-700/70">
              ({c.regulation_id})
            </span>
            {c.outputs.length > 0 && (
              <span className="ml-1.5 text-violet-700/80">
                — слушает: {c.outputs.map((o) => (
                  <span key={o} className="ml-0.5 rounded bg-white/70 px-1 py-px font-mono text-[10px]">
                    {o}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}


// ──────────────────────────────────────────────────────────
// Inline-форма триггера в карточке параметра.
// Архитектурное решение: «один параметр = (опционально) один триггер»
// делается визуально явным — триггер живёт там же, где параметр, а не в
// отдельной секции ниже. Это устраняет orphan-триггеры (id триггера и
// param_ref выводятся из имени параметра) и делает UX логичным:
// карточка параметра отвечает на оба вопроса — «что за параметр» и
// «откуда он наполняется».
//
// Backend модель не меняется: триггер по-прежнему отдельная сущность
// (DuckDB regulation_triggers + Turtle :hasTrigger) для онтологической
// чистоты и O(1) reverse-lookup. Меняется только UI-метафора.
// ──────────────────────────────────────────────────────────

function ParamTriggerInline({
  paramId: _paramId,  // используется родителем для трекинга; здесь только props passthrough
  paramName,
  trigger,
  currentRegulationId,
  onUpsert,
  onRemove,
}: {
  paramId: string
  paramName: string
  trigger: RegulationTrigger | undefined
  currentRegulationId: string
  onUpsert: (patch: Partial<RegulationTrigger>) => void
  onRemove: () => void
}) {
  const { data: classes = [] } = useQuery({
    queryKey: ['sensor-subtypes'],
    queryFn: () => api.sensorSubtypes.list(),
  })
  const { data: datasetsRaw } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const allRegulations = useMemo<Array<{ id: string; name: string; domain?: string | null }>>(() => {
    if (!datasetsRaw) return []
    const items: Array<{ id: string; name?: string; domain?: string | null }> =
      Array.isArray(datasetsRaw)
        ? datasetsRaw
        : ('items' in datasetsRaw && Array.isArray(datasetsRaw.items) ? datasetsRaw.items : [])
    return items
      .filter((r) => r.id !== currentRegulationId)
      .map((r) => ({ id: r.id, name: r.name ?? r.id, domain: r.domain }))
      .sort(
        (a, b) =>
          (a.domain ?? '').localeCompare(b.domain ?? '') ||
          a.name.localeCompare(b.name),
      )
  }, [datasetsRaw, currentRegulationId])

  // Если триггера нет — компактная кнопка-плашка «Привязать датчик/регламент»;
  // клик создаёт триггер без источника (mode='sensor' открывается следующим
  // рендером, потому что upsert поставит дефолты).
  if (!trigger) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-stone-300 bg-stone-50/60 px-2.5 py-1.5">
        <Zap size={12} className="text-stone-400" />
        <span className="text-[11px] text-stone-500">
          Источник этого входа не указан.
        </span>
        <button
          type="button"
          onClick={() => onUpsert({})}
          className="ml-auto inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
        >
          <Plus size={11} />
          Привязать источник
        </button>
      </div>
    )
  }

  const mode = inferSourceMode(trigger)
  const accent =
    mode === 'regulation'
      ? 'border-violet-200 bg-violet-50/40'
      : mode === 'sensor'
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-stone-200 bg-stone-50/40'

  return (
    <div className={cn('mt-2 rounded-md border p-2.5', accent)}>
      <div className="mb-2 flex items-center gap-2">
        <Zap size={12} className={mode === 'regulation' ? 'text-violet-600' : 'text-amber-600'} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-600">
          Триггер
        </span>
        <span className="text-[10px] font-mono text-stone-400">{trigger.id}</span>
        <button
          type="button"
          onClick={onRemove}
          title="Убрать привязку источника"
          className="ml-auto rounded p-0.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.4fr]">
        <FormRow label="Метка" icon={Tag} compact>
          <input
            value={trigger.label ?? ''}
            onChange={(e) => onUpsert({ label: e.target.value || null })}
            className={tx}
            placeholder={paramName}
          />
        </FormRow>
        <FormRow label="Тип события" icon={Send} compact>
          <input
            value={trigger.event_type ?? ''}
            onChange={(e) => onUpsert({ event_type: e.target.value || null })}
            className={tx}
            placeholder="telemetry.pressure"
          />
        </FormRow>
      </div>
      <TriggerSourcePicker
        trigger={trigger}
        classes={classes}
        allRegulations={allRegulations}
        onPatch={(patch) => onUpsert(patch)}
      />
    </div>
  )
}


// ──────────────────────────────────────────────────────────
// Источник триггера — сегмент «Датчик / Регламент / —» + соответствующие селекты.
// Реализует event-driven композицию: триггер может слушать либо физический
// датчик из Sensor Library (sensor_subtype), либо output другого регламента
// (source_regulation + source_output). Взаимоисключающие источники — при
// переключении сбрасываем поля прошлого режима.
// ──────────────────────────────────────────────────────────

type TriggerSourceMode = 'sensor' | 'regulation' | 'none'

function inferSourceMode(t: RegulationTrigger): TriggerSourceMode {
  if (t.source_regulation) return 'regulation'
  if (t.sensor_subtype) return 'sensor'
  return 'none'
}

function TriggerSourcePicker({
  trigger,
  classes,
  allRegulations,
  onPatch,
}: {
  trigger: RegulationTrigger
  classes: Array<{ class_id: string; subtypes: Array<{ subtype_id: string; label: string }> }>
  allRegulations: Array<{ id: string; name: string; domain?: string | null }>
  onPatch: (p: Partial<RegulationTrigger>) => void
}) {
  // Mode хранится локально, потому что нужно показать селект подтипа сразу
  // после клика «Датчик» — даже когда sensor_subtype ещё пустой. Если
  // выводить mode из самих полей триггера (inferSourceMode), пустой триггер
  // после клика останется в mode='none' и пользователь не увидит селекта.
  // Инициализируем из trigger один раз; при внешних изменениях триггера
  // (например, sync с flow на бэке) подстраиваемся через useEffect.
  const [mode, setModeRaw] = useState<TriggerSourceMode>(() => inferSourceMode(trigger))
  useEffect(() => {
    // Если родительская модель триггера стала указывать на регламент, а у нас
    // mode был 'sensor' — синхронизируемся; то же в обратную сторону.
    const next = inferSourceMode(trigger)
    if (next !== 'none') setModeRaw(next)
  }, [trigger.sensor_subtype, trigger.source_regulation])

  // Output-actions выбранного source_regulation — для второго селекта.
  const { data: outputData } = useQuery({
    queryKey: ['regulation-output-actions', trigger.source_regulation],
    queryFn: () => api.regulations.outputActions(trigger.source_regulation as string),
    enabled: mode === 'regulation' && !!trigger.source_regulation,
  })
  const outputActions = outputData?.actions ?? []

  const setMode = (next: TriggerSourceMode) => {
    setModeRaw(next)  // визуальное переключение немедленно
    if (next === 'sensor') {
      onPatch({ source_regulation: null, source_output: null })
    } else if (next === 'regulation') {
      onPatch({ sensor_subtype: null })
    } else {
      onPatch({ sensor_subtype: null, source_regulation: null, source_output: null })
    }
  }

  const segmentOption = (
    label: string,
    icon: typeof Radio,
    value: TriggerSourceMode,
  ) => {
    const Icon = icon
    const active = mode === value
    return (
      <button
        key={value}
        type="button"
        onClick={() => setMode(value)}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 text-[11px] transition',
          active
            ? 'bg-white font-semibold text-stone-800 shadow-sm'
            : 'text-stone-500 hover:bg-stone-50',
        )}
      >
        <Icon size={11} />
        {label}
      </button>
    )
  }

  return (
    <div className="mt-2.5 rounded-md border border-stone-200 bg-stone-50/60 p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          Источник
        </span>
        <div className="inline-flex overflow-hidden rounded border border-stone-200 bg-stone-100">
          {segmentOption('Датчик', Radio, 'sensor')}
          {segmentOption('Регламент', Network, 'regulation')}
          {segmentOption('—', CircleSlash, 'none')}
        </div>
      </div>

      {mode === 'sensor' && (
        <div>
          <select
            value={trigger.sensor_subtype ?? ''}
            onChange={(e) => onPatch({ sensor_subtype: e.target.value || null })}
            className={cn(tx, 'pr-7')}
          >
            <option value="">— выберите подтип датчика —</option>
            {classes.map((c) => (
              <optgroup key={c.class_id} label={c.class_id}>
                {c.subtypes.map((s) => (
                  <option key={s.subtype_id} value={s.subtype_id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {mode === 'regulation' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FormRow label="Регламент-источник" icon={Network} compact>
            <select
              value={trigger.source_regulation ?? ''}
              onChange={(e) => onPatch({
                source_regulation: e.target.value || null,
                // При смене источника сбрасываем выбранный action — он мог быть
                // у прошлого регламента, у нового его может не быть.
                source_output: null,
              })}
              className={cn(tx, 'pr-7')}
            >
              <option value="">— выберите регламент —</option>
              {allRegulations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Output (action)" icon={Send} compact>
            <select
              value={trigger.source_output ?? ''}
              onChange={(e) => onPatch({ source_output: e.target.value || null })}
              className={cn(tx, 'pr-7')}
              disabled={!trigger.source_regulation}
              title={
                !trigger.source_regulation
                  ? 'Сначала выберите регламент-источник'
                  : outputActions.length === 0
                    ? 'У выбранного регламента нет output-action`ов в flow.json'
                    : undefined
              }
            >
              <option value="">— любой вердикт —</option>
              {outputActions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label} ({a.action})
                </option>
              ))}
            </select>
          </FormRow>
        </div>
      )}

      {mode === 'none' && (
        <p className="text-[11px] text-stone-500">
          Триггер без источника — может быть наполнен вручную оператором или ETL'ом по `event_type`.
        </p>
      )}
    </div>
  )
}


// TriggersList удалён — секция «Триггеры» как отдельный список больше не
// используется. Триггер рисуется inline в карточке параметра через
// `ParamTriggerInline` выше.

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
// View 3 — Source Turtle (presentation-only)
//
// Состояние (buffer/baseline) и save mutation подняты в родителя
// (RegulationEditorScreen). Это даёт ОДНУ верхнюю кнопку «Сохранить»,
// которая решает, что именно коммитить (Form/Sliders или Turtle)
// исходя из активной вкладки. SourceView сам не управляет сохранением —
// только рендерит textarea и кнопки «Сбросить» / «Перезагрузить».
// ──────────────────────────────────────────────────────────

function SourceView({
  sourceId: _sourceId,
  buffer,
  setBuffer,
  baseline,
  onReloadFromServer,
}: {
  sourceId: string
  buffer: string | null
  setBuffer: (v: string) => void
  baseline: string | null
  onReloadFromServer: () => Promise<void>
}) {
  const dirty = buffer !== null && baseline !== null && buffer !== baseline
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-md border border-stone-200 bg-stone-50/60 p-3 text-xs text-stone-600">
        Сырой Turtle регламента из локального DuckDB-store. Правки сохраняются
        verbatim — комментарии и порядок triplet'ов не теряются. Сохранение
        — общее: верхняя кнопка <b>«Сохранить»</b> на этой же странице.
        Структурированное представление на вкладках «Поля» / «Слайдеры»
        пересобирается из обновлённого Turtle.
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw size={13} />}
          onClick={() => baseline !== null && setBuffer(baseline)}
          disabled={!dirty}
        >
          Сбросить правки в этой вкладке
        </Button>
        <button
          onClick={() => {
            void onReloadFromServer()
          }}
          className="ml-2 text-xs text-stone-500 underline hover:text-stone-700"
        >
          Перезагрузить с сервера
        </button>
        {dirty && (
          <span className="ml-auto text-[11px] text-amber-700">
            Несохранённые правки в Turtle — нажмите «Сохранить» вверху
          </span>
        )}
      </div>
      {buffer === null && <div className="text-sm text-stone-500">Загрузка…</div>}
      {buffer !== null && (
        <textarea
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          spellCheck={false}
          className="min-h-[520px] flex-1 resize-y overflow-auto rounded-lg border border-stone-300 bg-stone-900 p-4 font-mono text-xs leading-relaxed text-stone-100 caret-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          style={{ tabSize: 2 }}
        />
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
// Source attachment (PROV-O: документ-основание)
// ──────────────────────────────────────────────────────────

function SourceAttachmentSection({
  draft,
  setDraft,
}: {
  draft: Regulation
  setDraft: (r: Regulation) => void
}) {
  const id = draft.id
  const qc = useQueryClient()
  const hasFile = !!draft.source_file_path

  // Mutations: upload / delete / verify. После каждой — invalidate чтобы
  // редактор подхватил новые поля (path/checksum/mime).
  const upload = useMutation({
    mutationFn: (f: File) => api.regulations.uploadSourceDocument(id, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['regulation', id] }),
  })
  const remove = useMutation({
    mutationFn: () => api.regulations.deleteSourceDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['regulation', id] }),
  })
  const verify = useMutation({
    mutationFn: () => api.regulations.verifySourceDocument(id),
  })

  const filename = draft.source_file_path?.split('/').pop() ?? ''

  return (
    <Section
      title={<SectionTitle icon={Paperclip} label="Документ-основание" />}
      description="Где живёт оригинал приказа/постановления и текст-цитата, из которой выведены значения параметров. Используется для самопроверки и обоснования перед заказчиком (PROV-O: prov:wasDerivedFrom)."
      elevated
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormRow label="Ссылка на оригинал" icon={Link2}>
          <div className="flex gap-1">
            <input
              value={draft.source_url ?? ''}
              onChange={(e) => setDraft({ ...draft, source_url: e.target.value || null })}
              placeholder="https://disk.yandex.ru/i/abc123 или intranet-URL"
              className={tx}
            />
            {draft.source_url && (
              <a
                href={draft.source_url}
                target="_blank"
                rel="noopener noreferrer"
                title="Открыть оригинал в новой вкладке"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 transition hover:border-primary/40 hover:text-primary"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </FormRow>
        <FormRow label="Локальная копия (PDF / DOCX)" icon={FileText}>
          {hasFile ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-2 py-1.5 text-xs">
              <FileText size={14} className="shrink-0 text-emerald-600" />
              <a
                href={api.regulations.sourceDocumentUrl(id)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate font-medium text-emerald-800 hover:underline"
                title={`Открыть ${filename}`}
              >
                {filename}
              </a>
              <button
                onClick={() => verify.mutate()}
                disabled={verify.isPending}
                className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                title="Сверить SHA-256 локального файла с записанным хешем"
              >
                {verify.isPending ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                Сверить
              </button>
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                title="Удалить только локальный файл; URL и цитата сохранятся"
              >
                <Trash2 size={10} />
                Удалить файл
              </button>
            </div>
          ) : (
            <label
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-600 transition hover:border-primary/40 hover:bg-primary/5',
                upload.isPending && 'cursor-wait opacity-60',
              )}
            >
              {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {upload.isPending ? 'Загрузка…' : 'Загрузить файл (PDF / DOCX / изображение, до 25 МБ)'}
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload.mutate(f)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          )}
        </FormRow>
      </div>

      <FormRow label="Текст-цитата (откуда взялись значения)" icon={Quote}>
        <textarea
          rows={4}
          value={draft.source_excerpt ?? ''}
          onChange={(e) => setDraft({ ...draft, source_excerpt: e.target.value || null })}
          placeholder="Например: «Давление в трубопроводе должно поддерживаться на уровне 20.5 атм, при этом допустимое отклонение по давлению не должно превышать 1.5 атм.»"
          className={cn(tx, 'leading-relaxed font-serif')}
        />
      </FormRow>

      {/* Inline-статусы по mutations: вместо модалок — лёгкие баннеры. */}
      {upload.isError && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
          Не удалось загрузить файл: {(upload.error as Error).message}
        </div>
      )}
      {verify.data && (
        <div
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            verify.data.matches
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {verify.data.matches ? (
            <>
              <CheckCircle2 size={12} /> Файл соответствует записанному хешу — оригинал не изменён
            </>
          ) : (
            <>
              <AlertTriangle size={12} /> Хеш не сошёлся
              {verify.data.reason === 'no_local_file' && ' — локальный файл отсутствует'}
              {verify.data.reason !== 'no_local_file' && ' — оригинал мог быть подменён, перезагрузите файл'}
            </>
          )}
        </div>
      )}

      {/* Read-only метадата — checksum и mime, для прозрачности. */}
      {(draft.source_checksum || draft.source_mime_type) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-stone-500">
          {draft.source_mime_type && (
            <span>
              <b>тип:</b> <code className="rounded bg-stone-100 px-1">{draft.source_mime_type}</code>
            </span>
          )}
          {draft.source_checksum && (
            <span title={draft.source_checksum}>
              <b>хеш:</b> <code className="rounded bg-stone-100 px-1 font-mono">{draft.source_checksum.slice(0, 18)}…</code>
            </span>
          )}
        </div>
      )}
    </Section>
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
