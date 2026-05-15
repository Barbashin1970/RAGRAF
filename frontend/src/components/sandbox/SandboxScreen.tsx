import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Beaker,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Cpu,
  FileSearch,
  Lightbulb,
  Loader2,
  MessageSquare,
  Network,
  PackagePlus,
  RotateCcw,
  ScanText,
  Search,
  Send,
  Settings2,
  Sparkles,
  User,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DOMAIN_VISUALS, getDomainVisual } from '@/lib/domains'
import { Badge, Button, PageBody, PageHeader, PageShell, Tabs, type TabDef } from '@/components/ui'
import { DocumentsPanel } from './DocumentsPanel'

type Tab = 'search' | 'extract'

function isTab(value: string | null): value is Tab {
  return value === 'search' || value === 'extract'
}

export function SandboxScreen() {
  // ?tab=extract в URL открывает сразу нужную вкладку — используется
  // «Извлечь из текста» из CreateRegulationDialog и можно шарить ссылкой.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'search'
  const [tab, setTab] = useState<Tab>(initialTab)
  // Подробная справка про RAGU+RAGRAF спрятана за кнопкой — раньше она «съедала»
  // полстраницы поверх рабочего интерфейса.
  const [showInfo, setShowInfo] = useState(false)

  // Если юзер кликает по табу — обновляем query string. Это даёт честный back-button
  // и копируемые ссылки. replace=true чтобы не засорять history стек переключениями.
  useEffect(() => {
    const current = searchParams.get('tab')
    if (current !== tab) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', tab)
      setSearchParams(next, { replace: true })
    }
    // searchParams не включаем в deps чтобы не циклить при setSearchParams
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const { data: status } = useQuery({
    queryKey: ['sandbox-status'],
    queryFn: () => api.sandbox.status(),
  })

  const tabs: TabDef<Tab>[] = [
    { id: 'search', label: 'Диалог с RAGU', icon: MessageSquare },
    { id: 'extract', label: 'Извлечь параметры', icon: Wand2 },
  ]

  return (
    <PageShell>
      <PageHeader
        icon={Beaker}
        tone="author"
        title="Студия аналитика"
        badges={
          <>
            {status?.mode === 'real' ? (
              <Badge tone="success" dot>RAGU подключён</Badge>
            ) : (
              <Badge tone="warning">mock-режим</Badge>
            )}
            <Badge tone="author" uppercase>Author Layer</Badge>
          </>
        }
        description={
          <>
            ИИ-помощник для разбора документов (приказы, СНиПы, регламенты) и сборки
            структурированных регламентов. Сами регламенты живут в разделе{' '}
            <Link to="/regulations" className="font-medium text-stone-700 underline-offset-2 hover:underline">
              «Регламенты»
            </Link>
            , исполняются в будущем разделе «Исполнение» (runtime, без ИИ —
            детерминированно по датчикам).
            {status?.mode === 'mock' && (
              <>
                {' '}Сейчас <b>mock-режим</b> (без LLM-ключей и внешних сервисов) —
                см. справку справа про переключение на настоящий RAGU.
              </>
            )}
          </>
        }
        actions={
          <div className="hidden items-center gap-2 sm:flex">
            <Button
              variant="author"
              icon={<BookOpen size={14} />}
              iconRight={
                <ChevronDown
                  size={14}
                  className={cn('transition-transform', showInfo && 'rotate-180')}
                />
              }
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
              title="Краткая справка: что такое RAGU и зачем она в связке с RAGRAF"
              className={cn(!showInfo && 'bg-violet-500')}
            >
              {showInfo ? 'Скрыть' : 'Что такое RAGU?'}
            </Button>
            <Link to="/sandbox/backlog" title="Бэклог: следующие RAGU-сценарии">
              <Button
                variant="secondary"
                icon={<Lightbulb size={14} className="text-amber-600" />}
                iconRight={<ChevronRight size={14} className="text-stone-400" />}
              >
                Бэклог демо
              </Button>
            </Link>
          </div>
        }
      >
        {/* Info-блок: появляется только по клику «Что такое RAGU?» — компактная
            выжимка, полная версия живёт на странице бэклога. */}
        {showInfo && (
          <div className="mt-3 rounded-md border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-3 text-xs text-stone-700 shadow-sm">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                <BookOpen size={12} /> RAGU + RAGRAF — что это и зачем
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowInfo(false)}
                aria-label="Скрыть справку"
                className="h-6 w-6 p-0 text-violet-400 hover:text-violet-700"
              >
                <X size={12} />
              </Button>
            </div>
            <p className="leading-relaxed">
              <b>RAGU</b> — движок <i>GraphRAG</i>, который понимает технические тексты:
              приказы, регламенты, СНиПы, ГОСТы. Из произвольного документа он вытаскивает
              <b> параметры с диапазонами</b>, ищет похожие документы <b>по смыслу запроса</b>{' '}
              (а не по совпадению слов), и связывает регламенты в <b>граф знаний</b> — где
              видно, что один параметр (скажем <code className="rounded bg-stone-100 px-1">temperature</code>)
              живёт в 4 регламентах разных ведомств.
            </p>
            <p className="mt-1.5 leading-relaxed">
              <b>RAGRAF</b> — визуальный редактор и виз-карта поверх этих данных: слайдеры,
              Rule DSL Flow, SHACL-ограничения, версионирование. В связке получается переход{' '}
              <b>«текст → структурированные данные → калибровка → проверка»</b>:
              новый приказ разбирается за минуты, противоречия видны на графе, ответ на
              «что делать если давление упало?» приходит из всей базы, а не из одного документа.
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <li className="flex items-start gap-1.5">
                <ScanText size={11} className="mt-0.5 shrink-0 text-violet-600" />
                <span><b>Разбор за минуты:</b> extractor из приказа предлагает 5-10 параметров с уставками и допусками — не нужно вбивать руками.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Search size={11} className="mt-0.5 shrink-0 text-violet-600" />
                <span><b>Поиск по смыслу:</b> «куда звонить при пожаре в серверной?» находит регламент даже без слова «пожар» в тексте.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Network size={11} className="mt-0.5 shrink-0 text-violet-600" />
                <span><b>Связи между документами:</b> унификация регуляторной базы, поиск противоречий, кросс-доменные параметры.</span>
              </li>
            </ul>
            <div className="mt-2 border-t border-violet-100 pt-2 text-[11px] text-stone-500">
              Полная версия с примерами и обоснованием — на{' '}
              <Link to="/sandbox/backlog" className="font-medium text-violet-700 underline-offset-2 hover:underline">
                странице бэклога
              </Link>
              .
            </div>
          </div>
        )}

        <LLMStatusBar />

        <div className="mt-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} tone="author" />
        </div>
      </PageHeader>

      {tab === 'search' ? (
        // NotebookLM-style: левая колонка с источниками + центр с чатом.
        // Только для диалога — на вкладке «Извлечь параметры» документы не нужны.
        <div className="flex min-h-0 flex-1">
          <DocumentsPanel />
          <PageBody>
            <SearchDemo />
          </PageBody>
        </div>
      ) : (
        <PageBody>
          <ExtractDemo />
        </PageBody>
      )}
    </PageShell>
  )
}

// TabButton удалён — замещён `<Tabs>` из @/components/ui (DESIGN_SYSTEM.md §2).

// ── LLM Status Bar ─────────────────────────────────────────────────────
//
// Короткая полоска с самыми важными фактами про работающий LLM-стек:
// какая модель, достижима ли Ollama, сколько регламентов проиндексировано.
// Тёмная side — в шапке Песочницы постоянно на виду; обеспечивает доверие
// «я знаю что под капотом, ничего не отправляется наружу».

function LLMStatusBar() {
  const { data, isError } = useQuery({
    queryKey: ['sandbox-llm-info'],
    queryFn: () => api.sandbox.llmInfo(),
    // Поллим раз в 10 сек чтобы реагировать на загрузку модели в RAM,
    // ручное переключение модели в .env, разрыв связи с Ollama.
    refetchInterval: 10_000,
  })

  if (isError || !data) return null

  // В mock-режиме показываем кратко: «нет LLM, всё локально».
  if (data.mode === 'mock') {
    return (
      <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px] text-amber-900">
        <Cpu size={12} className="text-amber-600" />
        <span><b>Mock-режим</b>: TF-IDF без LLM, ключи и сети не нужны</span>
        <span className="text-amber-700/60">·</span>
        <span>индекс: {data.index_size > 0 ? `${data.index_size} рег.` : 'не построен'}</span>
      </div>
    )
  }

  const reachable = data.llm_reachable
  const loaded = data.llm_loaded_in_memory
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[11px] text-stone-700">
      {/* Ollama reachability */}
      <span className="inline-flex items-center gap-1">
        <Circle
          size={8}
          className={cn(
            'fill-current',
            reachable ? 'text-emerald-500' : 'text-rose-500',
          )}
        />
        <span className="text-stone-500">Ollama:</span>
        <b className={reachable ? 'text-emerald-700' : 'text-rose-700'}>
          {reachable ? 'на связи' : 'не отвечает'}
        </b>
      </span>
      <span className="text-stone-300">·</span>

      {/* LLM модель */}
      <span className="inline-flex items-center gap-1" title="LLM модель в Ollama">
        <Cpu size={11} className="text-violet-500" />
        <span className="text-stone-500">LLM:</span>
        <code className="rounded bg-violet-50 px-1 font-mono text-[10px] text-violet-800">
          {data.llm_model}
        </code>
        {loaded && (
          <span title="модель уже загружена в RAM — следующий запрос будет быстрым">
            <Zap size={10} className="text-amber-500" />
          </span>
        )}
      </span>
      <span className="text-stone-300">·</span>

      {/* Embedding модель */}
      <span className="inline-flex items-center gap-1" title="Embedding модель для retrieval">
        <span className="text-stone-500">Embed:</span>
        <code className="rounded bg-stone-100 px-1 font-mono text-[10px] text-stone-700">
          {data.embed_model}
        </code>
      </span>
      <span className="text-stone-300">·</span>

      {/* Index size */}
      <span className="inline-flex items-center gap-1" title="Сколько регламентов проиндексировано">
        <span className="text-stone-500">Индекс:</span>
        <b className="text-stone-800">{data.index_size}</b>
        <span className="text-stone-500">рег.</span>
        {data.index_size > 0 && !data.index_fresh && (
          <span title="индекс устарел — пересоберётся при следующем запросе">
            <RotateCcw size={10} className="text-amber-500" />
          </span>
        )}
      </span>
    </div>
  )
}

// ── Demo 1: Conversational Q&A над регламентами ──────────────────────

const CHAT_EXAMPLES = [
  'куда звонить при пожаре в серверной?',
  'какие параметры зимней нормы давления?',
  'что делать при штиле и pm2.5 одновременно?',
  'регламент при ночной протечке в общежитии',
]

type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    regulation_id: string
    regulation_name: string
    domain?: string | null
    score: number
    matched_terms: string[]
    snippet: string
    parameters_count: number
  }>
  /** mode полученного ответа — на ассистенте; mock vs real */
  mode?: 'mock' | 'real'
}

function SearchDemo() {
  // ChatDemo: переименован остался — роутится из тaba 'search'. Внутри полный
  // chat с историей: каждый user-турн → API возвращает answer+sources; в UI
  // показываем как пузырьки, под ответом ассистента — карточки источников.
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  // Параметры генерации. null = «использовать дефолт сервера»; число = override.
  const [temperature, setTemperature] = useState<number>(0.1)
  const [topK, setTopK] = useState<number>(4)
  const [maxTokens, setMaxTokens] = useState<number>(600)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const chat = useMutation({
    mutationFn: (history: Array<{ role: 'user' | 'assistant'; content: string }>) =>
      api.sandbox.chat(history, { top_k: topK, temperature, max_tokens: maxTokens }),
    onSuccess: (data) => {
      setTurns((t) => [
        ...t,
        { role: 'assistant', content: data.answer, sources: data.sources, mode: data.mode },
      ])
    },
    onError: (err) => {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: `❌ Ошибка: ${(err as Error).message}`,
          sources: [],
          mode: 'mock',
        },
      ])
    },
  })

  // Авто-скролл вниз при появлении нового сообщения.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, chat.isPending])

  const send = (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || chat.isPending) return
    const next: ChatTurn[] = [...turns, { role: 'user', content }]
    setTurns(next)
    setInput('')
    // Передаём в API только plain {role, content} — без sources/mode.
    chat.mutate(next.map((m) => ({ role: m.role, content: m.content })))
  }

  const reset = () => {
    setTurns([])
    setInput('')
    chat.reset()
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3 rounded-md border border-blue-100 bg-blue-50/40 px-4 py-3 text-xs text-blue-900">
        Диалог с RAGU поверх корпуса регламентов. Каждый вопрос → семантический retrieval
        через embedding-модель (cosine similarity на bge-m3) → ответ от локальной LLM
        с опорой ТОЛЬКО на найденные документы. История разговора держится в памяти —
        follow-up'ы вроде «а ночью?» после «куда звонить при пожаре?» работают.
        Конкретная модель и состояние стека — в полоске под заголовком; параметры
        генерации (temperature, top-k, лимит длины) — за шестерёнкой справа от «Отправить».
      </div>

      {/* Лента сообщений */}
      <div
        ref={scrollRef}
        className="min-h-[300px] flex-1 space-y-3 overflow-y-auto rounded-md border border-stone-200 bg-stone-50/40 p-4"
      >
        {turns.length === 0 && !chat.isPending && (
          <EmptyChatHint onPick={send} examples={CHAT_EXAMPLES} />
        )}
        {turns.map((t, i) => (
          <ChatBubble key={i} turn={t} />
        ))}
        {chat.isPending && <TypingIndicator />}
      </div>

      {/* Панель параметров генерации — свернута по умолчанию.
          Не загромождает основной поток, но всегда доступна одним кликом. */}
      {showSettings && (
        <ChatSettings
          temperature={temperature}
          topK={topK}
          maxTokens={maxTokens}
          onChange={(p) => {
            if (p.temperature !== undefined) setTemperature(p.temperature)
            if (p.topK !== undefined) setTopK(p.topK)
            if (p.maxTokens !== undefined) setMaxTokens(p.maxTokens)
          }}
          onReset={() => {
            setTemperature(0.1)
            setTopK(4)
            setMaxTokens(600)
          }}
        />
      )}

      {/* Input bar */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter без Shift = отправить; Shift+Enter = перенос строки.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          placeholder={chat.isPending ? 'Жду ответ от LLM…' : 'Задай вопрос про регламенты (Enter — отправить, Shift+Enter — перенос строки)'}
          disabled={chat.isPending}
          className="min-h-[42px] max-h-32 flex-1 resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-60"
        />
        <Button
          variant="author"
          icon={chat.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          onClick={() => send()}
          disabled={!input.trim() || chat.isPending}
        >
          Отправить
        </Button>
        <Button
          variant={showSettings ? 'secondary' : 'ghost'}
          icon={<Settings2 size={14} />}
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          title={showSettings ? 'Скрыть параметры' : 'Параметры генерации (temperature, top-k, max-tokens)'}
          className={cn(showSettings && 'border-violet-300 bg-violet-50 text-violet-700')}
        >
          <span className="sr-only">Параметры</span>
        </Button>
        {turns.length > 0 && (
          <Button
            variant="ghost"
            icon={<RotateCcw size={14} />}
            onClick={reset}
            disabled={chat.isPending}
            title="Очистить разговор"
          >
            <span className="sr-only">Очистить</span>
          </Button>
        )}
      </div>
    </div>
  )
}

function ChatSettings({
  temperature,
  topK,
  maxTokens,
  onChange,
  onReset,
}: {
  temperature: number
  topK: number
  maxTokens: number
  onChange: (p: { temperature?: number; topK?: number; maxTokens?: number }) => void
  onReset: () => void
}) {
  return (
    <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-900">
          <Settings2 size={12} />
          Параметры генерации
        </div>
        <button
          onClick={onReset}
          className="text-[10px] text-violet-700 underline hover:text-violet-900"
          title="Вернуть к дефолтам (temp=0.1, top-k=4, max-tokens=600)"
        >
          Сбросить
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
        <ParamSlider
          label="temperature"
          value={temperature}
          min={0}
          max={1.5}
          step={0.05}
          format={(v) => v.toFixed(2)}
          hint="0 = детерминированно (одинаковые ответы), 1+ = креативно/рискованно"
          onChange={(v) => onChange({ temperature: v })}
        />
        <ParamSlider
          label="top-k regulations"
          value={topK}
          min={1}
          max={10}
          step={1}
          format={(v) => `${v}`}
          hint="Сколько регламентов кладём в контекст. Меньше = точнее, больше = шире покрытие"
          onChange={(v) => onChange({ topK: v })}
        />
        <ParamSlider
          label="max tokens"
          value={maxTokens}
          min={50}
          max={2000}
          step={50}
          format={(v) => `${v}`}
          hint="Лимит длины ответа. 600 ≈ 3–5 пунктов структурированного ответа"
          onChange={(v) => onChange({ maxTokens: v })}
        />
      </div>
      <div className="mt-2 text-[10px] text-violet-700/70">
        Изменения применяются к следующему сообщению; на текущий разговор уже отправленные не влияют.
      </div>
    </div>
  )
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  hint: string
}) {
  return (
    <label className="block">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="font-medium text-violet-900">{label}</span>
        <span className="font-mono text-violet-700">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-600"
      />
      <div className="mt-0.5 text-[10px] leading-tight text-violet-700/70">{hint}</div>
    </label>
  )
}

function EmptyChatHint({
  onPick,
  examples,
}: {
  onPick: (text: string) => void
  examples: string[]
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
        <Bot size={22} className="text-violet-700" />
      </div>
      <div className="mb-1 text-sm font-medium text-stone-800">Диалог пуст</div>
      <div className="mb-4 text-xs text-stone-500">
        Задай вопрос про регламенты — или начни с примера ниже.
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-1.5">
        {examples.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs text-violet-700 transition hover:border-violet-300 hover:bg-violet-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
        <Bot size={14} className="text-violet-700" />
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-stone-200 bg-white px-4 py-2.5">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user'
  return (
    <div className={cn('flex items-start gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-stone-200' : 'bg-violet-100',
        )}
      >
        {isUser ? (
          <User size={14} className="text-stone-700" />
        ) : (
          <Bot size={14} className="text-violet-700" />
        )}
      </div>
      <div className={cn('max-w-[80%] space-y-2', isUser && 'items-end')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
            isUser
              ? 'rounded-tr-sm bg-violet-600 text-white'
              : 'rounded-tl-sm border border-stone-200 bg-white text-stone-800',
          )}
        >
          {turn.content}
        </div>
        {!isUser && turn.mode && (
          <div className="text-[10px] text-stone-400">
            {turn.mode === 'real' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                <Sparkles size={9} /> ответ от локальной LLM (Ollama)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">
                mock-режим: без LLM
              </span>
            )}
          </div>
        )}
        {!isUser && turn.sources && turn.sources.length > 0 && (
          <details className="rounded-md border border-stone-200 bg-white/60">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-stone-600 hover:text-stone-800">
              📎 Источники ({turn.sources.length})
            </summary>
            <ul className="space-y-1.5 px-3 pb-2 pt-1">
              {turn.sources.map((r) => (
                <li key={r.regulation_id}>
                  <SearchResultCard result={r} matchedTerms={r.matched_terms} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
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

// Галерея текстов-примеров для прогонки экстрактора. Каждый пресет несёт:
//  - text: что подложить в textarea;
//  - suggestedDomain / suggestedName: что предложить в шаге «Сборка» —
//    чтобы при кликe «Газ · SMS-оповещение» сразу появились environment-домен
//    и осмысленное имя регламента, и юзер мог просто нажать «Создать».
// Тэги газ/уголь/mix окрашены, чтобы визуально различать типы станций.
interface ExtractPreset {
  id: string
  label: string
  tag: 'mix' | 'газ' | 'уголь'
  suggestedDomain: string
  suggestedName: string
  text: string
}

const TAG_COLORS: Record<ExtractPreset['tag'], { bg: string; fg: string }> = {
  mix:   { bg: 'bg-violet-100', fg: 'text-violet-700' },
  'газ': { bg: 'bg-orange-100', fg: 'text-orange-700' },
  'уголь': { bg: 'bg-stone-200', fg: 'text-stone-800' },
}

const EXTRACT_PRESETS: ExtractPreset[] = [
  {
    id: 'default',
    label: 'Базовый набор параметров',
    tag: 'mix',
    suggestedDomain: 'heating',
    suggestedName: 'Регламент трубопровода теплоносителя',
    text: `Регламент устанавливает: номинальный диаметр 5.0 см с максимальным
отклонением 0.2 см. Давление в трубопроводе поддерживается на уровне
20.5 атм при допустимом отклонении 1.5 атм.

Температура подачи теплоносителя — 70 ± 10 °C, расход 1.5 м³/ч.
SMS уведомления уязвимым группам отправляются за 6 ± 2 часа до пика.`,
  },
  {
    id: 'gas-hydraulic',
    label: 'Газ · гидравлический режим',
    tag: 'газ',
    suggestedDomain: 'heating',
    suggestedName: 'Газовая станция · гидравлический режим трубопровода',
    text: `Регламент устанавливает: номинальный диаметр трубопровода теплоносителя 5.0 см с максимальным отклонением 0.2 см. Давление в подающем трубопроводе поддерживается на уровне 20.5 атм при допустимом отклонении 1.5 атм.

Температура подачи теплоносителя устанавливается на уровне 70 ± 10 °C, расход теплоносителя — 1.5 м³/ч. Поддержание давления и температуры должно обеспечиваться средствами автоматического регулирования, а контроль параметров — датчиками, манометрами и средствами диспетчеризации.`,
  },
  {
    id: 'gas-notification',
    label: 'Газ · SMS-оповещение',
    tag: 'газ',
    suggestedDomain: 'environment',
    suggestedName: 'Газовая станция · оповещение уязвимых групп',
    text: `Регламент устанавливает: SMS-уведомления уязвимым группам потребителей, а также ответственным лицам объектов социальной инфраструктуры отправляются за 6 ± 2 часа до прогнозируемого пика нагрузки, планового ограничения или риска аварийного снижения параметров теплоснабжения.

Текст уведомления должен содержать время ожидаемого события, территорию действия и рекомендуемые меры. Для критически важных объектов допускается повторное сообщение не менее одного раза при изменении прогноза.`,
  },
  {
    id: 'coal-params',
    label: 'Уголь · параметры теплоносителя',
    tag: 'уголь',
    suggestedDomain: 'heating',
    suggestedName: 'Угольная станция · параметры теплоносителя',
    text: `Регламент устанавливает: номинальный диаметр трубопровода подачи теплоносителя 5.0 см с максимальным отклонением 0.2 см. Давление в трубопроводе поддерживается на уровне 20.5 атм при допустимом отклонении 1.5 атм, температура подачи теплоносителя — 70 ± 10 °C, расход — 1.5 м³/ч.

При эксплуатации печей и котлоагрегатов на угольном топливе параметры теплоносителя контролируются по утверждённому графику, а отклонения от уставок фиксируются в оперативном журнале. При выходе параметров за допустимые пределы подача топлива и режим горения корректируются немедленно.`,
  },
  {
    id: 'coal-fuel-feed',
    label: 'Уголь · подача топлива',
    tag: 'уголь',
    suggestedDomain: 'safety',
    suggestedName: 'Угольная станция · дробление и подача топлива',
    text: `Регламент устанавливает: устройства подготовки и транспортирования твердого топлива должны обеспечивать подачу в топочную часть дробленого и очищенного от посторонних предметов топлива.

Все виды угля и сланца подлежат дроблению до кусков размером до 25 мм, при этом остаток на сите 25 мм не должен превышать 5%. Подача топлива по тракту должна быть равномерной, а оборудование топливоподачи не допускается к работе при неисправных ограждающих или тормозных устройствах.`,
  },
  {
    id: 'coal-storage',
    label: 'Уголь · хранение и пожарная профилактика',
    tag: 'уголь',
    suggestedDomain: 'safety',
    suggestedName: 'Угольная станция · хранение и пожарная профилактика',
    text: `Регламент устанавливает: склады угля должны обеспечивать раздельное хранение топлива, механизированную разгрузку и укладку в штабеля, контроль температуры в штабелях и защиту от подтопления.

На оборудовании и конструкциях системы топливоподачи не допускается скопление угольной пыли; помещения должны убираться механизированно по утвержденному графику. При использовании влажного топлива бункеры должны полностью опорожняться и очищаться не реже одного раза в 10 дней.`,
  },
]

const DEFAULT_PRESET = EXTRACT_PRESETS[0]

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
  const [text, setText] = useState(DEFAULT_PRESET.text)
  const [activePresetId, setActivePresetId] = useState<string>(DEFAULT_PRESET.id)
  // По одному chosen-варианту на suggested_name (по умолчанию — первый из группы).
  // Хранение по ключу id извлечения позволяет надёжно отдиффить
  // выбранные при перезапуске extract.
  const [picked, setPicked] = useState<Record<string, string>>({})
  // suggested_name → включён ли в сборку (по умолчанию все включены).
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  // suggested_name (original, как пришёл с бэка) → переименованное юзером
  // имя. Когда parameter-extractor возвращает "параметр_1" или
  // "forecastLeadTime", аналитик хочет дать своё имя — `notificationLead`
  // или `pressureFallRate`. Используем original-name как стабильный key
  // для группировки/выбора варианта, а в payload передаём custom.
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [regName, setRegName] = useState(DEFAULT_PRESET.suggestedName)
  const [domain, setDomain] = useState<string>(DEFAULT_PRESET.suggestedDomain)

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
      setCustomNames({}) // сбрасываем кастомные имена при ре-extract
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

  // При выборе пресета: подкладываем текст, предлагаем доменное имя/категорию,
  // сбрасываем результат предыдущего извлечения чтобы не путать.
  const applyPreset = (p: ExtractPreset) => {
    setText(p.text)
    setActivePresetId(p.id)
    setRegName(p.suggestedName)
    setDomain(p.suggestedDomain)
    setPicked({})
    setIncluded({})
    setCustomNames({})
    extract.reset()
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
        // Если аналитик переименовал параметр — отдаём его имя.
        // Trim + fallback на оригинал, чтобы пустая строка не прошла валидацию.
        suggested_name: customNames[p.suggested_name]?.trim() || p.suggested_name,
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

      {/* Шаг 1 — текст + галерея примеров справа */}
      <StepHeader n={1} title="Вставь текст регламента или выбери пример справа" />
      <div className="flex flex-col gap-3 md:flex-row">
        <textarea
          rows={11}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // Юзер начал редактировать вручную — пресет «отвязывается»
            // (визуально на сайдбаре пропадёт выделение active).
            if (activePresetId !== '__custom__') setActivePresetId('__custom__')
          }}
          className="min-h-[220px] flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
          placeholder="Вставь сюда фрагмент Постановления или регламентного текста…"
        />
        <PresetGallery activeId={activePresetId} onPick={applyPreset} />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="author"
          icon={extract.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
          onClick={submit}
          disabled={!text.trim() || extract.isPending}
        >
          Извлечь параметры
        </Button>
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
                  customName={customNames[name] ?? ''}
                  items={items}
                  included={isIncluded}
                  pickedId={pickedId}
                  onToggle={() => setIncluded((s) => ({ ...s, [name]: !isIncluded }))}
                  onPick={(id) => setPicked((s) => ({ ...s, [name]: id }))}
                  onRename={(v) => setCustomNames((s) => ({ ...s, [name]: v }))}
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

function PresetGallery({
  activeId,
  onPick,
}: {
  activeId: string
  onPick: (p: ExtractPreset) => void
}) {
  return (
    <div className="w-full shrink-0 md:w-60">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-stone-600">Примеры регламентов</span>
        <span className="text-[10px] text-stone-400">{EXTRACT_PRESETS.length} шт.</span>
      </div>
      <div className="space-y-1">
        {EXTRACT_PRESETS.map((p) => {
          const active = activeId === p.id
          const tag = TAG_COLORS[p.tag]
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              title={p.suggestedName}
              className={cn(
                'group flex w-full items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition',
                active
                  ? 'border-violet-300 bg-violet-50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50',
              )}
            >
              <span className={cn('mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide', tag.bg, tag.fg)}>
                {p.tag}
              </span>
              <span className={cn('min-w-0 flex-1 leading-snug', active ? 'font-semibold text-violet-900' : 'text-stone-700')}>
                {p.label}
              </span>
            </button>
          )
        })}
      </div>
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
  customName,
  items,
  included,
  pickedId,
  onToggle,
  onPick,
  onRename,
}: {
  name: string
  customName: string
  items: ExtractedParam[]
  included: boolean
  pickedId: string
  onToggle: () => void
  onPick: (id: string) => void
  onRename: (v: string) => void
}) {
  // Авто-нейм может быть «параметр_1» (если контекстный стем не найден) или
  // нормальное «pressureFallRate». В обоих случаях даём аналитику переименовать.
  // Локальный state — чтобы не дёргать родителя на каждый keystroke.
  const [localName, setLocalName] = useState(customName || name)
  useEffect(() => setLocalName(customName || name), [customName, name])
  const isAutoplaceholder = name.startsWith('параметр_')

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-3 transition',
        included ? 'border-violet-200 shadow-sm' : 'border-stone-200 opacity-60',
      )}
    >
      <label className="flex cursor-pointer items-start justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            className="h-4 w-4 shrink-0 cursor-pointer accent-violet-600"
          />
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={() => onRename(localName.trim() === name ? '' : localName.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              disabled={!included}
              title="Имя параметра в регламенте — можно переименовать"
              className={cn(
                'w-full rounded border bg-transparent px-1.5 py-0.5 font-mono text-sm font-semibold transition',
                isAutoplaceholder
                  ? 'border-amber-300 bg-amber-50/40 text-amber-900 focus:bg-white'
                  : 'border-transparent text-stone-800 hover:border-stone-200 focus:border-violet-300 focus:bg-white',
              )}
            />
            {isAutoplaceholder && (
              <div className="ml-1.5 mt-0.5 text-[10px] text-amber-700">
                Авто-имя не угадано — задайте своё (например, `notificationLead`)
              </div>
            )}
          </div>
          {items.length > 1 && (
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
              {items.length} вариант{items.length < 5 ? 'а' : 'ов'}
            </span>
          )}
        </div>
        <div className="shrink-0 pt-1 text-[10px] uppercase tracking-wide text-stone-400">
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
            <Button
              variant="author"
              icon={isPending ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
              onClick={onCreate}
              disabled={!canCreate}
            >
              Создать регламент
            </Button>
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
