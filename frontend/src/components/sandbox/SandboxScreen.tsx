import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Beaker,
  ChevronRight,
  FileSearch,
  Loader2,
  Search,
  SearchCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDomainVisual } from '@/lib/domains'

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
          <div className="hidden text-xs text-stone-400 sm:block">
            Бэклог:{' '}
            <Link to="/sandbox/backlog" className="underline hover:text-stone-600">
              следующие сценарии
            </Link>
          </div>
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

function ExtractDemo() {
  const [text, setText] = useState(EXTRACT_SAMPLE)

  const extract = useMutation({
    mutationFn: () => api.sandbox.extractParameters(text),
  })

  const submit = () => {
    if (text.trim()) extract.mutate()
  }

  type ExtractedParam = (NonNullable<typeof extract.data>)['extracted'][number]
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-md border border-blue-100 bg-blue-50/40 px-4 py-3 text-xs text-blue-900">
        Извлечение параметров из произвольного текста регламента. Mock: regex по числам с
        единицами + словарь контекстных слов (давление → pressure, температура → temperature и т.д.).
        Берётся ЛЕВЫЙ контекст ~80 символов (имя параметра в русском всегда перед числом),
        с отсечением по `,;.\\n`. Хорошо работает на формулировках вида «параметр N ± M ед».
      </div>

      <textarea
        rows={10}
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

      {extract.data && extract.data.extracted.length > 0 && (
        <div className="space-y-2">
          {Array.from(grouped.entries()).map(([name, items]) => (
            <div key={name} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-stone-800">{name}</div>
                <div className="text-[10px] uppercase tracking-wide text-stone-400">
                  {items.length} вхождение{items.length === 1 ? '' : items.length < 5 ? 'я' : 'й'}
                </div>
              </div>
              <ul className="space-y-1.5">
                {items.map((e) => (
                  <li key={e.id} className="rounded border border-stone-100 bg-stone-50 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-stone-900">
                        {e.value}{' '}
                        {e.deviation !== null && e.deviation !== undefined && (
                          <span className="text-stone-500">± {e.deviation}</span>
                        )}{' '}
                        <span className="text-stone-500">{e.unit}</span>
                      </span>
                      <ConfidenceBadge value={e.confidence} />
                    </div>
                    <div className="mt-1 line-clamp-2 italic text-stone-600">«{e.source_text}»</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
