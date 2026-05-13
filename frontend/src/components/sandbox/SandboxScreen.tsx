import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Beaker,
  Check,
  ChevronRight,
  FileSearch,
  Lightbulb,
  Loader2,
  PackagePlus,
  Search,
  SearchCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DOMAIN_VISUALS, getDomainVisual } from '@/lib/domains'

type Tab = 'search' | 'extract'

export function SandboxScreen() {
  const [tab, setTab] = useState<Tab>('search')

  const { data: status } = useQuery({
    queryKey: ['sandbox-status'],
    queryFn: () => api.sandbox.status(),
  })

  const modeBadge =
    status?.mode === 'real' ? (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        RAGU подключён
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
        mock-режим
      </span>
    )

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-6 pb-3 pt-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
                <Beaker size={18} className="text-violet-700" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
                Песочница
              </h1>
              {modeBadge}
            </div>
            <p className="mt-1 text-sm text-stone-500">
              Демо-сценарии RAGU поверх наших регламентов — изолированно от основного функционала.
              {status?.mode === 'mock' && (
                <>
                  {' '}Сейчас работает <b>mock-режим</b> (keyword scoring + regex), без LLM-ключей.
                  Включи <code className="rounded bg-stone-100 px-1 text-xs">RAGU_ENABLED=true</code>
                  {' '}в <code className="rounded bg-stone-100 px-1 text-xs">.env</code> для настоящего RAGU.
                </>
              )}
            </p>
          </div>
          <Link
            to="/sandbox/backlog"
            title="Бэклог: следующие RAGU-сценарии (Knowledge Graph, сравнение регламентов, авто-классификация, Q&A)"
            className="group hidden shrink-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 hover:shadow sm:inline-flex"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-200/70 group-hover:bg-amber-200">
              <Lightbulb size={14} className="text-amber-700" />
            </span>
            <span className="leading-tight">
              <span className="block">Бэклог демо</span>
              <span className="block text-[10px] font-normal text-amber-700/80">следующие сценарии RAGU</span>
            </span>
            <ChevronRight size={14} className="text-amber-500 transition group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="mt-4 inline-flex rounded-md border border-stone-200 bg-white p-0.5">
          <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon={SearchCheck} label="Поиск регламентов" />
          <TabButton active={tab === 'extract'} onClick={() => setTab('extract')} icon={Wand2} label="Извлечь параметры" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {tab === 'search' && <SearchDemo />}
        {tab === 'extract' && <ExtractDemo />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Beaker
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-violet-100 text-violet-800' : 'text-stone-600 hover:bg-stone-50',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

// ── Demo 1: Semantic search ────────────────────────────────────────────

const SEARCH_EXAMPLES = [
  'куда звонить при пожаре в серверной',
  'параметры зимней нормы давления',
  'что делать при штиле и pm2.5',
  'регламент протечки в общежитии',
]

function SearchDemo() {
  const [query, setQuery] = useState('')

  const search = useMutation({
    mutationFn: () => api.sandbox.search(query, 5),
  })

  const submit = () => {
    if (query.trim()) search.mutate()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-md border border-blue-100 bg-blue-50/40 px-4 py-3 text-xs text-blue-900">
        Поиск регламентов на естественном языке. Mock-скоринг: совпадение по имени (×3),
        домену (×2), параметрам (×2), тексту рекомендации (×1) с простой русско-морфологической
        нормализацией (стем-префикс). Подсветка matched terms в snippet'е.
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Спроси на естественном языке…"
            className="w-full rounded-md border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
          />
        </div>
        <button
          onClick={submit}
          disabled={!query.trim() || search.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
        >
          {search.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Найти
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-stone-500">Примеры:</span>
        {SEARCH_EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => {
              setQuery(q)
            }}
            className="rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-xs text-stone-600 transition hover:border-violet-300 hover:bg-violet-50"
          >
            {q}
          </button>
        ))}
      </div>

      {search.data && (
        <div>
          <div className="mb-2 text-xs text-stone-500">
            Найдено <b className="text-stone-800">{search.data.results.length}</b> релевантных регламентов
          </div>
          {search.data.results.length === 0 ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
              По запросу «{query}» ничего не нашлось. Попробуй переформулировать.
            </div>
          ) : (
            <ul className="space-y-2">
              {search.data.results.map((r) => (
                <SearchResultCard key={r.regulation_id} result={r} matchedTerms={r.matched_terms} />
              ))}
            </ul>
          )}
        </div>
      )}

      {search.isError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ошибка: {(search.error as Error).message}
        </div>
      )}
    </div>
  )
}

function SearchResultCard({
  result,
  matchedTerms,
}: {
  result: {
    regulation_id: string
    regulation_name: string
    domain?: string | null
    score: number
    snippet: string
    parameters_count: number
  }
  matchedTerms: string[]
}) {
  const v = getDomainVisual(result.domain)
  const Icon = v.icon
  return (
    <li>
      <Link
        to={`/regulations/${result.regulation_id}/edit`}
        className="group flex items-stretch gap-3 rounded-lg border border-stone-200 bg-white p-3 transition hover:border-violet-300 hover:shadow-sm"
      >
        <div className={cn('w-1 shrink-0 rounded-full', v.accent)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded', v.iconBg)}>
                <Icon size={13} className={v.iconFg} />
              </div>
              <div className="line-clamp-2 text-sm font-medium text-stone-900 group-hover:text-violet-700">
                {result.regulation_name}
              </div>
            </div>
            <div className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              score {result.score}
            </div>
          </div>
          <div className="mt-1.5 text-[11px] text-stone-500">
            <code className="rounded bg-stone-100 px-1 py-0.5 font-mono">{result.regulation_id}</code>
            {' · '}
            {result.parameters_count} параметров
          </div>
          {result.snippet && (
            <div className="mt-1.5 line-clamp-2 text-xs leading-snug text-stone-700">
              <Highlight text={result.snippet} terms={matchedTerms} />
            </div>
          )}
          {matchedTerms.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {matchedTerms.map((t) => (
                <span key={t} className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronRight size={14} className="self-center text-stone-300 group-hover:text-violet-500" />
      </Link>
    </li>
  )
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  // Кейс-инсенситивный split по любому из matched-terms — каждое вхождение
  // оборачиваем в <mark>.
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-yellow-900">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

// ── Demo 2: Extract parameters ─────────────────────────────────────────

const EXTRACT_SAMPLE = `Регламент устанавливает: номинальный диаметр 5.0 см с максимальным
отклонением 0.2 см. Давление в трубопроводе поддерживается на уровне
20.5 атм при допустимом отклонении 1.5 атм.

Температура подачи теплоносителя — 70 ± 10 °C, расход 1.5 м³/ч.
SMS уведомления уязвимым группам отправляются за 6 ± 2 часа до пика.`

type ExtractedParam = {
  id: string
  suggested_name: string
  value: number
  deviation?: number | null
  unit: string
  source_text: string
  confidence: number
}

function ExtractDemo() {
  const navigate = useNavigate()
  const [text, setText] = useState(EXTRACT_SAMPLE)
  // По одному chosen-варианту на suggested_name (по умолчанию — первый из группы).
  // Хранение по ключу id извлечения позволяет надёжно отдиффить
  // выбранные при перезапуске extract.
  const [picked, setPicked] = useState<Record<string, string>>({})
  // suggested_name → включён ли в сборку (по умолчанию все включены).
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [regName, setRegName] = useState('Новый регламент из песочницы')
  const [domain, setDomain] = useState<string>('heating')

  const extract = useMutation({
    mutationFn: () => api.sandbox.extractParameters(text),
    onSuccess: (data) => {
      // Сбрасываем выбор на дефолтный после нового извлечения.
      const newPicked: Record<string, string> = {}
      const newIncluded: Record<string, boolean> = {}
      for (const e of data.extracted) {
        if (!(e.suggested_name in newPicked)) newPicked[e.suggested_name] = e.id
        newIncluded[e.suggested_name] = true
      }
      setPicked(newPicked)
      setIncluded(newIncluded)
    },
  })

  const create = useMutation({
    mutationFn: (payload: Parameters<typeof api.sandbox.createFromParams>[0]) =>
      api.sandbox.createFromParams(payload),
    onSuccess: (resp) => {
      navigate(`/regulations/${resp.regulation_id}/edit`)
    },
  })

  const submit = () => {
    if (text.trim()) extract.mutate()
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ExtractedParam[]>()
    if (!extract.data) return m
    for (const e of extract.data.extracted) {
      const arr = m.get(e.suggested_name) ?? []
      arr.push(e)
      m.set(e.suggested_name, arr)
    }
    return m
  }, [extract.data])

  const selectedParams = useMemo(() => {
    if (!extract.data) return []
    const out: ExtractedParam[] = []
    for (const [name, items] of grouped.entries()) {
      if (!included[name]) continue
      const pickedId = picked[name] ?? items[0]?.id
      const chosen = items.find((i) => i.id === pickedId) ?? items[0]
      if (chosen) out.push(chosen)
    }
    return out
  }, [extract.data, grouped, picked, included])

  const canCreate = selectedParams.length > 0 && regName.trim().length > 0 && !create.isPending

  const doCreate = () => {
    create.mutate({
      name: regName.trim(),
      domain,
      params: selectedParams.map((p) => ({
        suggested_name: p.suggested_name,
        value: p.value,
        deviation: p.deviation ?? null,
        unit: p.unit ?? null,
      })),
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-md border border-blue-100 bg-blue-50/40 px-4 py-3 text-xs text-blue-900">
        Извлечение параметров из произвольного текста регламента. Mock: regex по числам с
        единицами + словарь контекстных слов (давление → pressure, температура → temperature и т.д.).
        Берётся ЛЕВЫЙ контекст ~80 символов (имя параметра в русском всегда перед числом),
        с отсечением по `,;.\\n`. Хорошо работает на формулировках вида «параметр N ± M ед».
      </div>

      {/* Шаг 1 — текст */}
      <StepHeader n={1} title="Вставь текст регламента" />
      <textarea
        rows={9}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
        placeholder="Вставь сюда фрагмент Постановления или регламентного текста…"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!text.trim() || extract.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
        >
          {extract.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
          Извлечь параметры
        </button>
        <button
          onClick={() => setText(EXTRACT_SAMPLE)}
          className="text-xs text-stone-500 hover:text-stone-700 underline"
        >
          Восстановить пример
        </button>
        {extract.data && (
          <div className="ml-auto text-xs text-stone-500">
            Найдено: <b className="text-stone-800">{extract.data.count}</b>
          </div>
        )}
      </div>

      {/* Шаг 2 — извлечённые параметры с возможностью включить/исключить */}
      {extract.data && extract.data.extracted.length > 0 && (
        <>
          <StepHeader
            n={2}
            title="Что включить в регламент?"
            hint="Отключи лишнее; если параметр упомянут несколько раз — выбери конкретное значение."
          />
          <div className="space-y-2">
            {Array.from(grouped.entries()).map(([name, items]) => {
              const isIncluded = included[name] ?? true
              const pickedId = picked[name] ?? items[0].id
              return (
                <ParamGroupCard
                  key={name}
                  name={name}
                  items={items}
                  included={isIncluded}
                  pickedId={pickedId}
                  onToggle={() => setIncluded((s) => ({ ...s, [name]: !isIncluded }))}
                  onPick={(id) => setPicked((s) => ({ ...s, [name]: id }))}
                />
              )
            })}
          </div>
        </>
      )}

      {/* Шаг 3 — собрать регламент */}
      {extract.data && extract.data.extracted.length > 0 && (
        <BuildRegulationPanel
          selectedCount={selectedParams.length}
          regName={regName}
          onNameChange={setRegName}
          domain={domain}
          onDomainChange={setDomain}
          onCreate={doCreate}
          canCreate={canCreate}
          isPending={create.isPending}
          error={create.error as Error | null}
        />
      )}

      {extract.data && extract.data.extracted.length === 0 && (
        <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          В тексте не нашлось числовых параметров с известными единицами.
        </div>
      )}

      {extract.isError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Ошибка: {(extract.error as Error).message}
        </div>
      )}
    </div>
  )
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      {hint && <span className="text-xs text-stone-500">— {hint}</span>}
    </div>
  )
}

function ParamGroupCard({
  name,
  items,
  included,
  pickedId,
  onToggle,
  onPick,
}: {
  name: string
  items: ExtractedParam[]
  included: boolean
  pickedId: string
  onToggle: () => void
  onPick: (id: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-3 transition',
        included ? 'border-violet-200 shadow-sm' : 'border-stone-200 opacity-60',
      )}
    >
      <label className="flex cursor-pointer items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            className="h-4 w-4 cursor-pointer accent-violet-600"
          />
          <span className="font-semibold text-stone-800">{name}</span>
          {items.length > 1 && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
              {items.length} вариант{items.length < 5 ? 'а' : 'ов'}
            </span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-stone-400">
          {included ? 'включён' : 'исключён'}
        </div>
      </label>
      <ul className="mt-2 space-y-1.5">
        {items.map((e) => {
          const isActive = included && e.id === pickedId
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={!included || items.length === 1}
                onClick={() => onPick(e.id)}
                className={cn(
                  'w-full rounded border p-2 text-left text-xs transition',
                  isActive
                    ? 'border-violet-300 bg-violet-50'
                    : 'border-stone-100 bg-stone-50 hover:border-stone-200',
                  !included && 'cursor-not-allowed',
                )}
              >
                <div className="flex items-center gap-2">
                  {items.length > 1 && (
                    <span
                      className={cn(
                        'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                        isActive ? 'border-violet-500 bg-violet-500 text-white' : 'border-stone-300 bg-white',
                      )}
                    >
                      {isActive && <Check size={9} strokeWidth={3} />}
                    </span>
                  )}
                  <span className="font-mono font-semibold text-stone-900">
                    {e.value}
                    {e.deviation !== null && e.deviation !== undefined && (
                      <span className="text-stone-500"> ± {e.deviation}</span>
                    )}{' '}
                    <span className="text-stone-500">{e.unit}</span>
                  </span>
                  <ConfidenceBadge value={e.confidence} />
                </div>
                <div className="mt-1 line-clamp-2 italic text-stone-600">«{e.source_text}»</div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BuildRegulationPanel({
  selectedCount,
  regName,
  onNameChange,
  domain,
  onDomainChange,
  onCreate,
  canCreate,
  isPending,
  error,
}: {
  selectedCount: number
  regName: string
  onNameChange: (s: string) => void
  domain: string
  onDomainChange: (s: string) => void
  onCreate: () => void
  canCreate: boolean
  isPending: boolean
  error: Error | null
}) {
  const v = getDomainVisual(domain)
  return (
    <>
      <StepHeader
        n={3}
        title="Собрать регламент из выбранных параметров"
        hint="Имя + домен → готовая черновая заготовка в редакторе"
      />
      <div className={cn('rounded-lg border-2 bg-white p-4 transition', v.cardBorder.split(' ')[0])}>
        <div className="mb-3 flex items-center gap-2">
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', v.iconBg)}>
            <PackagePlus size={18} className={v.iconFg} />
          </div>
          <div>
            <div className="text-sm font-semibold text-stone-800">Новый регламент</div>
            <div className="text-xs text-stone-500">
              {selectedCount > 0
                ? `${selectedCount} параметр${selectedCount === 1 ? '' : selectedCount < 5 ? 'а' : 'ов'} попадёт в заготовку`
                : 'Включи хотя бы один параметр выше'}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium text-stone-700">Название</div>
            <input
              type="text"
              value={regName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Например: Регламент при перегреве серверной"
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
          </label>

          <div>
            <div className="mb-1 text-xs font-medium text-stone-700">Домен</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(DOMAIN_VISUALS).map(([id, vv]) => {
                const Icon = vv.icon
                const active = domain === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onDomainChange(id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md border p-2 text-left text-xs transition',
                      active
                        ? `${vv.cardBorder.split(' ')[0]} ${vv.chipBg} ring-2 ring-offset-1`
                        : 'border-stone-200 bg-white hover:border-stone-300',
                      active && DOMAIN_RING[id],
                    )}
                  >
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded', vv.iconBg)}>
                      <Icon size={12} className={vv.iconFg} />
                    </span>
                    <span className={cn('font-medium', active ? vv.chipFg : 'text-stone-700')}>
                      {DOMAIN_LABELS[id] ?? id}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-stone-500">
              После создания откроется редактор для уточнения порогов и flow.
            </div>
            <button
              onClick={onCreate}
              disabled={!canCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
              Создать регламент
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не получилось: {error.message}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const DOMAIN_LABELS: Record<string, string> = {
  heating: 'Теплоснабжение',
  housing: 'ЖКХ',
  safety: 'Безопасность',
  environment: 'Экология',
}

// ring-color Tailwind utility не умеет ring-orange-300 динамически — храним маппинг.
const DOMAIN_RING: Record<string, string> = {
  heating: 'ring-orange-300',
  housing: 'ring-blue-300',
  safety: 'ring-rose-300',
  environment: 'ring-emerald-300',
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    pct >= 80 ? 'bg-emerald-100 text-emerald-700' :
    pct >= 50 ? 'bg-amber-100 text-amber-700' :
                'bg-stone-100 text-stone-600'
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', tone)}>
      confidence {pct}%
    </span>
  )
}
