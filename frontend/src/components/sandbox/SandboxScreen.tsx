import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Beaker,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Cpu,
  ExternalLink,
  FileSearch,
  Loader2,
  MessageSquare,
  PackagePlus,
  Pencil,
  RotateCcw,
  Send,
  Settings2,
  Sliders,
  Square,
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
import { RaguStudioContent } from '@/components/ragu/RaguStudioScreen'
import { ContextPanel } from './ContextPanel'
import {
  BUILTIN_PRESETS,
  createUserPreset,
  loadUserPresets,
  saveUserPresets,
  type SystemPromptPreset,
} from './systemPromptPresets'

type Tab = 'search' | 'extract' | 'ragu'

function isTab(value: string | null): value is Tab {
  return value === 'search' || value === 'extract' || value === 'ragu'
}

export function SandboxScreen() {
  // ?tab=extract в URL открывает сразу нужную вкладку — используется
  // «Извлечь из текста» из CreateRegulationDialog и можно шарить ссылкой.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'search'
  const [tab, setTab] = useState<Tab>(initialTab)

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

  const tabs: TabDef<Tab>[] = [
    { id: 'search', label: 'Диалог с RAGU', icon: MessageSquare },
    { id: 'extract', label: 'Извлечь параметры', icon: Wand2 },
    // RAGU Studio переехала в табы из верхней навигации — оба раздела про
    // одну и ту же сущность («ИИ-помощник аналитика»), теперь они вместе.
    { id: 'ragu', label: 'RAGU Studio', icon: Sparkles },
  ]

  return (
    <PageShell>
      {/* Шапка стала компактной: длинное описание убрано в tooltip на title,
          бейдж «RAGU подключён» снят (RAGU теперь дефолтный модуль), кнопки
          «Что такое RAGU?» и «Бэклог демо» переехали внутрь таба RAGU Studio,
          LLMStatusBar — в подвал правой панели чата. */}
      <PageHeader
        icon={Beaker}
        tone="author"
        title="Студия аналитика"
        titleTooltip={
          'ИИ-помощник для разбора документов (приказы, СНиПы, регламенты) и сборки ' +
          'структурированных регламентов. Сами регламенты живут в разделе «Регламенты», ' +
          'исполняются в будущем разделе «Исполнение» (runtime, без ИИ — детерминированно по датчикам).'
        }
        badges={<Badge tone="author" uppercase>Author Layer</Badge>}
      >
        <div className="mt-3">
          <Tabs tabs={tabs} active={tab} onChange={setTab} tone="author" />
        </div>
      </PageHeader>

      {tab === 'search' && (
        // LM-Studio-style: 3 колонки внутри вкладки «Диалог».
        //   ▸ Слева — таб'ы «Документы | Регламенты» (ContextPanel).
        //   ▸ Центр — чат-история + поле ввода прижато к низу.
        //   ▸ Справа — collapsible sections: системный промпт + пресеты,
        //              параметры генерации, RAGU-overrides.
        // SearchDemo рисует и центр, и правую панель, и оборачивает левую —
        // потому что disabled-список регламентов держит он как per-chat state.
        <SearchDemo />
      )}
      {tab === 'extract' && (
        <PageBody>
          <ExtractDemo />
        </PageBody>
      )}
      {tab === 'ragu' && <RaguStudioContent />}
    </PageShell>
  )
}

// TabButton удалён — замещён `<Tabs>` из @/components/ui (DESIGN_SYSTEM.md §2).

// ── LLM Status: footer для развёрнутой панели + dot для свёрнутой ─────
//
// Раньше LLMStatusBar занимал полоску в шапке Студии. Теперь:
//   • Полная информация (модель / embed / индекс) — в подвале правой панели,
//     когда она развёрнута.
//   • Когда панель свёрнута — узкая полоска показывает только точку-индикатор:
//     🟢 загружено в RAM • 🟡 на связи но не в RAM • 🔴 Ollama не отвечает.
// Поллинг раз в 10 сек — реагируем на загрузку/выгрузку модели в Ollama.

function useLLMStatus() {
  return useQuery({
    queryKey: ['sandbox-llm-info'],
    queryFn: () => api.sandbox.llmInfo(),
    refetchInterval: 10_000,
  })
}

type LLMStatusTone = 'ok' | 'warm' | 'cold' | 'mock' | 'unknown'

function llmStatusTone(data: ReturnType<typeof useLLMStatus>['data']): LLMStatusTone {
  if (!data) return 'unknown'
  if (data.mode === 'mock') return 'mock'
  if (!data.llm_reachable) return 'cold'
  return data.llm_loaded_in_memory ? 'ok' : 'warm'
}

const TONE_DOT: Record<LLMStatusTone, string> = {
  ok: 'text-emerald-500',
  warm: 'text-amber-500',
  cold: 'text-rose-500',
  mock: 'text-amber-500',
  unknown: 'text-stone-300',
}

function llmStatusLabel(tone: LLMStatusTone): string {
  switch (tone) {
    case 'ok':
      return 'LLM на связи и загружена в RAM — следующий запрос будет быстрым.'
    case 'warm':
      return 'Ollama на связи, но модель не в памяти — первый запрос будет медленным.'
    case 'cold':
      return 'Ollama не отвечает. Проверь что сервис запущен на base_url.'
    case 'mock':
      return 'Mock-режим: без LLM, retrieval по TF-IDF. Включи RAGU_ENABLED=true для реальной LLM.'
    case 'unknown':
      return 'Состояние LLM ещё не получено.'
  }
}

/** Компактный индикатор для свёрнутой правой панели (одна точка + tooltip). */
function LLMStatusDot() {
  const { data } = useLLMStatus()
  const tone = llmStatusTone(data)
  return (
    <div className="flex items-center justify-center px-1 py-1.5" title={llmStatusLabel(tone)}>
      <Circle size={10} className={cn('fill-current', TONE_DOT[tone])} />
    </div>
  )
}

/** Подвал развёрнутой панели с полной инфой про LLM. */
function LLMStatusFooter({
  regulationsTotal,
  regulationsEnabled,
}: {
  regulationsTotal: number
  regulationsEnabled: number
}) {
  const { data, isError } = useLLMStatus()
  // Параллельно подтягиваем кол-во ВКЛЮЧЁННЫХ документов — это даёт цельную
  // картинку «что сейчас в контексте» рядом с числом регламентов из индекса.
  // Кэш React Query шерится с ContextPanel, лишних запросов не плодим.
  const { data: docs } = useQuery({
    queryKey: ['sandbox-documents'],
    queryFn: () => api.sandbox.listDocuments(),
  })
  const docsEnabled = docs?.limits.enabled_count ?? 0
  const docsTotal = docs?.limits.current_count ?? 0
  if (isError || !data) return null

  const tone = llmStatusTone(data)
  if (data.mode === 'mock') {
    return (
      <div className="border-t border-stone-200 bg-amber-50/40 px-3 py-2 text-[10px] text-amber-900">
        <div className="flex items-center gap-1.5">
          <Circle size={8} className={cn('fill-current', TONE_DOT[tone])} />
          <span><b>Mock-режим</b> — без LLM, TF-IDF поиск</span>
        </div>
        <div className="mt-0.5 text-amber-700">
          Индекс: {data.index_size > 0 ? `${data.index_size} рег.` : 'не построен'}
        </div>
      </div>
    )
  }

  return (
    <div
      className="border-t border-stone-200 bg-white px-3 py-2 text-[10px] text-stone-700"
      title={llmStatusLabel(tone)}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Circle size={8} className={cn('fill-current', TONE_DOT[tone])} />
        <span className="font-semibold text-stone-800">
          Ollama:{' '}
          <span className={tone === 'cold' ? 'text-rose-700' : 'text-emerald-700'}>
            {data.llm_reachable ? 'на связи' : 'не отвечает'}
          </span>
        </span>
        {data.llm_loaded_in_memory && (
          <Zap size={10} className="text-amber-500" aria-label="в памяти" />
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 leading-tight">
        <div className="flex items-center gap-1.5">
          <Cpu size={9} className="text-violet-500" />
          <span className="text-stone-500">LLM:</span>
          <code className="truncate rounded bg-violet-50 px-1 font-mono text-[9px] text-violet-800">
            {data.llm_model}
          </code>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500">Embed:</span>
          <code className="truncate rounded bg-stone-100 px-1 font-mono text-[9px] text-stone-700">
            {data.embed_model}
          </code>
        </div>
        <div
          className="flex items-center gap-1.5"
          title={
            regulationsTotal === 0
              ? `В корпусе ${data.index_size} регламентов в индексе.`
              : regulationsEnabled === regulationsTotal
                ? `Все ${regulationsTotal} регламентов включены в контекст чата.`
                : `${regulationsEnabled} из ${regulationsTotal} регламентов включены (галки в левой панели). Отключённые не попадают в retrieval.`
          }
        >
          <span className="text-stone-500">Регл.:</span>
          <b
            className={cn(
              regulationsEnabled > 0 ? 'text-stone-800' : 'text-stone-400',
            )}
          >
            {regulationsEnabled}
          </b>
          {regulationsTotal > 0 && regulationsEnabled !== regulationsTotal && (
            <span className="text-stone-400">/ {regulationsTotal}</span>
          )}
          {data.index_size > 0 && !data.index_fresh && (
            <span title="индекс устарел — пересоберётся при следующем запросе">
              <RotateCcw size={9} className="text-amber-500" />
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-1.5"
          title={
            docsTotal === 0
              ? 'Документы аналитика не загружены — слева вкладка «Документы», кнопка «+ Источник»'
              : `${docsEnabled} из ${docsTotal} документов включены в контекст чата (галки в левой панели)`
          }
        >
          <span className="text-stone-500">Док.:</span>
          <b className={cn(docsEnabled > 0 ? 'text-stone-800' : 'text-stone-400')}>
            {docsEnabled}
          </b>
          {docsTotal > 0 && docsTotal !== docsEnabled && (
            <span className="text-stone-400">/ {docsTotal}</span>
          )}
        </div>
      </div>
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

// Дефолты LLM-параметров — те же что использует бэк когда клиент не передаёт.
// Заведены в константу, чтобы и слайдеры и кнопка «Сбросить» брали из одного места.
const DEFAULT_TEMPERATURE = 0.1
const DEFAULT_TOP_K = 4
const DEFAULT_MAX_TOKENS = 600
// Дефолт контекстного окна. Ollama сама по себе использует 2048-4096 — этого
// мало даже для нескольких регламентов + истории. 8192 — sweet spot:
// влезает 5-6 регламентов + chat history + ответ, RAM-нагрузка ещё разумная.
// Для длинных документов поднять до 16384/24576 вручную.
const DEFAULT_NUM_CTX = 8192

function SearchDemo() {
  // Чат живёт в LM-Studio-style layout'е:
  //   • Лента сообщений растягивается на весь центр и скроллится сама.
  //   • Поле ввода прижато к низу (sticky-style — обычный flex column tail).
  //   • Справа — панель настроек: системный промпт + параметры генерации.
  // История держится в памяти — follow-up'ы работают между турнами.
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  // Параметры генерации.
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE)
  const [topK, setTopK] = useState<number>(DEFAULT_TOP_K)
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_MAX_TOKENS)
  const [numCtx, setNumCtx] = useState<number>(DEFAULT_NUM_CTX)
  // Доп-инструкция «стиль/тон/формат» — приклеивается к встроенному
  // system-промпту на бэке. Не заменяет анти-галлюц правила, только добавляет.
  const [extraSystemPrompt, setExtraSystemPrompt] = useState<string>('')
  // Регламенты, ИСКЛЮЧЁННЫЕ из retrieval'а для этого чата. Set-семантика.
  // Дефолт: ВСЕ регламенты выключены (opt-in модель — пользователь сам
  // решает что подмешать в контекст). Раньше было «все включены» — это
  // делало первый «Привет» медленным, потому что LLM тащила весь корпус.
  // Live state, без persistence — на каждый новый чат начинается с нуля.
  // Заполняется реально после загрузки списка регламентов (см. useEffect ниже).
  const [disabledRegulationIds, setDisabledRegulationIds] = useState<Set<string>>(() => new Set())
  // Маркер «дефолт ещё не применён» — чтобы не перезатереть выбор пользователя
  // при повторных перерисовках. Раз применили — больше не применяем автоматически.
  const defaultsAppliedRef = useRef(false)
  // AbortController текущего in-flight chat-запроса. Хранится в ref'е чтобы
  // мутация и обработчик «Стоп» видели один и тот же экземпляр, и чтобы при
  // re-render'ах не пересоздавался.
  const abortRef = useRef<AbortController | null>(null)
  // Активный пресет (id). null = «свой текст» / не выбран. Не персистится —
  // пресеты применяются по клику, дальше пользователь может править руками.
  const [activePresetId, setActivePresetId] = useState<string | null>('default')
  const [userPresets, setUserPresets] = useState<SystemPromptPreset[]>(() => loadUserPresets())
  // Список всех регламентов нужен для эффекта «снять все галки» при выборе
  // пресета «Резюме документа». Берём из react-query кэша, чтобы не дублить.
  const { data: regsRaw } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const allRegulationIds = useMemo<string[]>(() => {
    if (!regsRaw) return []
    const arr: unknown[] = Array.isArray(regsRaw)
      ? regsRaw
      : 'items' in regsRaw && Array.isArray(regsRaw.items)
        ? regsRaw.items
        : []
    const ids: string[] = []
    for (const d of arr) {
      if (typeof d === 'string') ids.push(d)
      else if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>
        const id = (o.id ?? o.source_id ?? o.dataset_id) as string | undefined
        if (typeof id === 'string') ids.push(id)
      }
    }
    return ids
  }, [regsRaw])

  // Применяем дефолт «все регламенты отключены» ОДИН РАЗ после первой загрузки
  // корпуса. Если пользователь потом включает галки — не трогаем (флаг
  // defaultsAppliedRef уже true, useEffect больше не сработает по существу).
  useEffect(() => {
    if (defaultsAppliedRef.current) return
    if (allRegulationIds.length === 0) return
    defaultsAppliedRef.current = true
    setDisabledRegulationIds(new Set(allRegulationIds))
  }, [allRegulationIds])

  const scrollRef = useRef<HTMLDivElement | null>(null)

  type ChatVars = {
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    /** Для стартового «Привет, что ты умеешь?» — принудительно отключаем
     *  retrieval регламентов на ЭТОТ запрос, не трогая UI-state. Бэк попадёт
     *  в LEAN-ветку, ответ намного быстрее. */
    forceSkipRegulations?: boolean
  }
  const chat = useMutation({
    mutationFn: ({ history, forceSkipRegulations }: ChatVars) => {
      // Создаём новый AbortController на каждый запрос. Старый (если был)
      // уже отработал — useMutation не отстреливает параллельные запросы,
      // он ждёт завершения предыдущего.
      const controller = new AbortController()
      abortRef.current = controller
      const effectiveDisabled = forceSkipRegulations
        ? allRegulationIds
        : disabledRegulationIds.size > 0
          ? Array.from(disabledRegulationIds)
          : undefined
      return api.sandbox.chat(
        history,
        {
          top_k: topK,
          temperature,
          max_tokens: maxTokens,
          num_ctx: numCtx,
          extra_system_prompt: extraSystemPrompt.trim() || undefined,
          disabled_regulation_ids: effectiveDisabled,
        },
        controller.signal,
      )
    },
    onSuccess: (data) => {
      abortRef.current = null
      setTurns((t) => [
        ...t,
        { role: 'assistant', content: data.answer, sources: data.sources, mode: data.mode },
      ])
    },
    onError: (err) => {
      abortRef.current = null
      // AbortError специально — пользователь нажал «Стоп», не показываем
      // как красную ошибку, а спокойным curated-сообщением.
      const e = err as Error
      const wasAborted = e.name === 'AbortError' || /aborted/i.test(e.message)
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: wasAborted
            ? '⏹ Запрос остановлен. Попробуй уменьшить контекст или переформулировать.'
            : `❌ Ошибка: ${e.message}`,
          sources: [],
          mode: 'mock',
        },
      ])
    },
  })

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
  }

  // Авто-скролл вниз при появлении нового сообщения.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, chat.isPending])

  const send = (text?: string, opts?: { forceSkipRegulations?: boolean }) => {
    const content = (text ?? input).trim()
    if (!content || chat.isPending) return
    const next: ChatTurn[] = [...turns, { role: 'user', content }]
    setTurns(next)
    setInput('')
    // Передаём в API только plain {role, content} — без sources/mode.
    chat.mutate({
      history: next.map((m) => ({ role: m.role, content: m.content })),
      forceSkipRegulations: opts?.forceSkipRegulations,
    })
  }

  const reset = () => {
    setTurns([])
    setInput('')
    chat.reset()
  }

  // Признаки «настройки кастомизированы» — для индикаторов-точек в заголовках
  // секций справа (как в LM-Studio: точка = есть несохранённое/нестандартное).
  const customSystemPrompt = extraSystemPrompt.trim().length > 0
  const customGenParams =
    temperature !== DEFAULT_TEMPERATURE ||
    topK !== DEFAULT_TOP_K ||
    maxTokens !== DEFAULT_MAX_TOKENS ||
    numCtx !== DEFAULT_NUM_CTX

  // Helper'ы для регламентов — переданы в ContextPanel/RegulationsPanel.
  const toggleRegulation = (id: string, nextDisabled: boolean) => {
    setDisabledRegulationIds((prev) => {
      const next = new Set(prev)
      if (nextDisabled) next.add(id)
      else next.delete(id)
      return next
    })
    // Ручное переключение «отвязывает» пресет — иначе индикатор соврёт.
    setActivePresetId(null)
  }
  const setManyRegulations = (ids: string[], disabled: boolean) => {
    setDisabledRegulationIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (disabled) next.add(id)
        else next.delete(id)
      }
      return next
    })
    setActivePresetId(null)
  }

  const applyPreset = (preset: SystemPromptPreset) => {
    setExtraSystemPrompt(preset.template)
    setActivePresetId(preset.id)
    const fx = preset.effects
    if (fx?.disable_all_regulations && allRegulationIds.length > 0) {
      setDisabledRegulationIds(new Set(allRegulationIds))
    } else if (preset.id === 'default') {
      // «Стандарт» — возвращаем включёнными ВСЕ регламенты.
      setDisabledRegulationIds(new Set())
    }
    if (fx?.temperature !== undefined) setTemperature(fx.temperature)
    if (fx?.max_tokens !== undefined) setMaxTokens(fx.max_tokens)
    if (fx?.num_ctx !== undefined) setNumCtx(fx.num_ctx)
  }

  const saveCurrentAsPreset = (label: string) => {
    const preset = createUserPreset(label, extraSystemPrompt)
    const next = [...userPresets, preset]
    setUserPresets(next)
    saveUserPresets(next)
    setActivePresetId(preset.id)
  }

  const deleteUserPreset = (id: string) => {
    const next = userPresets.filter((p) => p.id !== id)
    setUserPresets(next)
    saveUserPresets(next)
    if (activePresetId === id) setActivePresetId(null)
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Левая колонка: документы + регламенты как табы */}
      <ContextPanel
        disabledRegulationIds={disabledRegulationIds}
        onToggleRegulation={toggleRegulation}
        onSetManyRegulations={setManyRegulations}
      />
      {/* Центр: чат */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Лента сообщений — flex-1, скроллится сама.
            Поле ввода ниже прижато к низу (классика всех чатов). */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-stone-50/30 px-4 py-4"
        >
          {turns.length === 0 && !chat.isPending && (
            <EmptyChatHint
              onPick={(text) => send(text)}
              onWarmup={() => send(WARMUP_QUERY, { forceSkipRegulations: true })}
              examples={CHAT_EXAMPLES}
            />
          )}
          {turns.map((t, i) => (
            <ChatBubble key={i} turn={t} />
          ))}
          {chat.isPending && <TypingIndicator />}
        </div>

        {/* Input bar — прижат к низу центральной колонки */}
        <div className="border-t border-stone-200 bg-white px-4 py-3">
          <div className="flex items-end gap-2">
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
              placeholder={
                chat.isPending
                  ? 'Жду ответ от LLM…'
                  : 'Задай вопрос про регламенты (Enter — отправить, Shift+Enter — перенос строки)'
              }
              disabled={chat.isPending}
              className="min-h-[42px] max-h-32 flex-1 resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-60"
            />
            {chat.isPending ? (
              <Button
                variant="danger"
                icon={<Square size={14} className="fill-current" />}
                onClick={stop}
                title="Остановить генерацию принудительно"
              >
                Стоп
              </Button>
            ) : (
              <Button
                variant="author"
                icon={<Send size={14} />}
                onClick={() => send()}
                disabled={!input.trim()}
              >
                Отправить
              </Button>
            )}
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
      </div>

      {/* Правая панель: настройки LLM — LM-Studio-style accordion */}
      <ChatSettingsPanel
        extraSystemPrompt={extraSystemPrompt}
        onExtraSystemPromptChange={(v) => {
          setExtraSystemPrompt(v)
          // Ручное редактирование отвязывает пресет — это уже «свой текст».
          if (activePresetId) setActivePresetId(null)
        }}
        customSystemPrompt={customSystemPrompt}
        temperature={temperature}
        topK={topK}
        maxTokens={maxTokens}
        numCtx={numCtx}
        customGenParams={customGenParams}
        onParamsChange={(p) => {
          if (p.temperature !== undefined) setTemperature(p.temperature)
          if (p.topK !== undefined) setTopK(p.topK)
          if (p.maxTokens !== undefined) setMaxTokens(p.maxTokens)
          if (p.numCtx !== undefined) setNumCtx(p.numCtx)
          setActivePresetId(null)
        }}
        onResetParams={() => {
          setTemperature(DEFAULT_TEMPERATURE)
          setTopK(DEFAULT_TOP_K)
          setMaxTokens(DEFAULT_MAX_TOKENS)
          setNumCtx(DEFAULT_NUM_CTX)
        }}
        presets={[...BUILTIN_PRESETS, ...userPresets]}
        activePresetId={activePresetId}
        onApplyPreset={applyPreset}
        onSaveAsPreset={saveCurrentAsPreset}
        onDeletePreset={deleteUserPreset}
        regulationsTotal={allRegulationIds.length}
        regulationsEnabled={Math.max(0, allRegulationIds.length - disabledRegulationIds.size)}
      />
    </div>
  )
}

// ── LM-Studio-style правый сайдбар настроек чата ─────────────────────────
//
// Секции (как в скриншоте LM-Studio):
//   1. Системный промпт — доп-инструкция «стиль/тон/формат». Приклеивается к
//      встроенному промпту на бэке, не заменяет анти-галлюц-правила.
//   2. Параметры генерации — temperature / top-k / max-tokens. Те же что и
//      раньше под кнопкой ⚙, только теперь раскрываются в боковой панели.
//   3. RAGU System Prompts — quick-link на RAGU Studio для тех кто хочет
//      менять не свой ad-hoc промпт, а сам RAGU-уровень.
//
// Дизайн: <details> + <summary> для аккордеона (нативно, без зависимостей,
// каждая секция запоминает своё open/close state).

const COLLAPSE_STORAGE_KEY = 'ragraf:sandbox:right-panel-collapsed'

function loadCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore — private mode / quota
  }
}

function ChatSettingsPanel({
  extraSystemPrompt,
  onExtraSystemPromptChange,
  customSystemPrompt,
  temperature,
  topK,
  maxTokens,
  numCtx,
  customGenParams,
  onParamsChange,
  onResetParams,
  presets,
  activePresetId,
  onApplyPreset,
  onSaveAsPreset,
  onDeletePreset,
  regulationsTotal,
  regulationsEnabled,
}: {
  extraSystemPrompt: string
  onExtraSystemPromptChange: (s: string) => void
  customSystemPrompt: boolean
  temperature: number
  topK: number
  maxTokens: number
  numCtx: number
  customGenParams: boolean
  onParamsChange: (p: { temperature?: number; topK?: number; maxTokens?: number; numCtx?: number }) => void
  onResetParams: () => void
  presets: SystemPromptPreset[]
  activePresetId: string | null
  onApplyPreset: (p: SystemPromptPreset) => void
  onSaveAsPreset: (label: string) => void
  onDeletePreset: (id: string) => void
  regulationsTotal: number
  regulationsEnabled: number
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed())
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      saveCollapsed(next)
      return next
    })
  }

  if (collapsed) {
    // Свёрнутая полоска: шеврон сверху для раскрытия + точка-индикатор LLM
    // снизу. Иконка Sliders в середине — чтобы пользователь понимал что это
    // была за панель (визуальный якорь).
    return (
      <aside
        className="flex w-8 shrink-0 flex-col items-center justify-between border-l border-stone-200 bg-stone-50/40 py-2"
        aria-label="Свёрнутая панель настроек"
      >
        <button
          onClick={toggleCollapsed}
          className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
          title="Раскрыть панель настроек"
          aria-label="Раскрыть панель настроек"
        >
          <ChevronLeft size={14} />
        </button>
        <div
          className="flex flex-col items-center gap-2 text-stone-400"
          title="Настройки LLM скрыты — кликни шеврон сверху"
        >
          <Sliders size={13} />
          {customSystemPrompt && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-violet-500"
              title="Системный промпт переопределён"
            />
          )}
          {customGenParams && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-violet-500"
              title="Параметры генерации отличаются от дефолта"
            />
          )}
        </div>
        <LLMStatusDot />
      </aside>
    )
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-stone-50/40">
      <header className="flex items-start justify-between gap-2 border-b border-stone-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Sliders size={14} className="text-violet-600" />
            Настройки LLM
          </div>
          <p className="mt-1 text-[11px] text-stone-500">
            Применяются к следующему сообщению. На уже отправленные не влияют.
          </p>
        </div>
        <button
          onClick={toggleCollapsed}
          className="mt-0.5 shrink-0 rounded p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-800"
          title="Свернуть панель — даст чату больше места"
          aria-label="Свернуть панель настроек"
        >
          <ChevronRight size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <SettingsSection
          icon={Pencil}
          title="Системный промпт"
          customized={customSystemPrompt}
          defaultOpen
        >
          <PresetPicker
            presets={presets}
            activePresetId={activePresetId}
            onApply={onApplyPreset}
            onDelete={onDeletePreset}
          />

          <p className="mt-3 mb-1.5 text-[11px] leading-relaxed text-stone-600">
            Доп-инструкция «стиль / тон / формат». Приклеивается к встроенному
            промпту — антигаллюцинация и retrieval-контекст всегда остаются.
          </p>
          <textarea
            value={extraSystemPrompt}
            onChange={(e) => onExtraSystemPromptChange(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={'Выбери пресет выше или напиши свою инструкцию.\n\nПримеры:\n• «Отвечай в одном абзаце, без пунктов»\n• «Цитируй id регламента в скобках»'}
            className="w-full resize-y rounded border border-stone-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-stone-800 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-stone-500">
            <span className="shrink-0">{extraSystemPrompt.length} / 4000</span>
            <div className="flex items-center gap-2">
              {customSystemPrompt && (
                <button
                  onClick={() => {
                    const label = window.prompt('Название пресета:', 'Мой пресет')
                    if (label && label.trim()) onSaveAsPreset(label.trim())
                  }}
                  className="text-violet-700 underline hover:text-violet-900"
                  title="Сохранить текущий текст как новый пресет (в localStorage)"
                >
                  Сохранить как…
                </button>
              )}
              {customSystemPrompt && (
                <button
                  onClick={() => onExtraSystemPromptChange('')}
                  className="text-stone-500 underline hover:text-stone-700"
                  title="Очистить — следующий запрос пойдёт без доп-инструкции"
                >
                  Очистить
                </button>
              )}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Settings2}
          title="Параметры генерации"
          customized={customGenParams}
        >
          <div className="space-y-3">
            <ParamSlider
              label="temperature"
              value={temperature}
              min={0}
              max={1.5}
              step={0.05}
              format={(v) => v.toFixed(2)}
              hint="0 = детерминированно, 1+ = креативно/рискованно"
              onChange={(v) => onParamsChange({ temperature: v })}
            />
            <ParamSlider
              label="top-k regulations"
              value={topK}
              min={1}
              max={10}
              step={1}
              format={(v) => `${v}`}
              hint="Сколько регламентов в контекст. Меньше = точнее"
              onChange={(v) => onParamsChange({ topK: v })}
            />
            <ParamSlider
              label="max tokens"
              value={maxTokens}
              min={50}
              max={2000}
              step={50}
              format={(v) => `${v}`}
              hint="Лимит длины ОТВЕТА. 600 ≈ 3-5 пунктов, 200 ≈ короткий абзац"
              onChange={(v) => onParamsChange({ maxTokens: v })}
            />
            <ParamSlider
              label="num_ctx (контекст)"
              value={numCtx}
              min={2048}
              max={32768}
              step={2048}
              format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(0)}K` : `${v}`)}
              hint={
                numCtx >= 16384
                  ? '⚠ >16K — qwen2.5:7b займёт 6+ ГБ RAM, prompt-eval будет медленным'
                  : numCtx <= 4096
                    ? 'Короткий контекст: быстро, но длинный документ обрежется'
                    : 'Окно «видимого» текста — вход + ответ. 8K хватает на 5-6 регламентов + history'
              }
              onChange={(v) => onParamsChange({ numCtx: v })}
            />
            {customGenParams && (
              <button
                onClick={onResetParams}
                className="block text-[10px] text-violet-700 underline hover:text-violet-900"
                title={`Вернуть к дефолтам (temp=${DEFAULT_TEMPERATURE}, top-k=${DEFAULT_TOP_K}, max-tokens=${DEFAULT_MAX_TOKENS}, num_ctx=${DEFAULT_NUM_CTX / 1024}K)`}
              >
                Сбросить к дефолтам
              </button>
            )}
          </div>
        </SettingsSection>

        <SettingsSection icon={Sparkles} title="RAGU системные промпты">
          <p className="mb-2 text-[11px] leading-relaxed text-stone-600">
            Глобальные промпты graph_ragu (community report, entity extraction,
            search engines). Меняются отдельно — переопределение применяется ко
            всем будущим запросам, включая /api/search.
          </p>
          <Link
            to="/ragu"
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-50"
          >
            <Sparkles size={11} />
            Открыть RAGU Studio
            <ExternalLink size={10} className="text-violet-400" />
          </Link>
          <p className="mt-2 text-[10px] leading-relaxed text-stone-500">
            Текущий чат <b>не использует</b> RAGU search engines (у него свой
            retrieval-стек). RAGU-промпты влияют на cross-corpus анализ
            документов и /api/search.
          </p>
        </SettingsSection>
      </div>

      {/* Подвал с инфой про LLM-стек — переехал сюда из шапки страницы,
          чтобы не зашумлять основной экран. Когда панель свёрнута, точка
          из этого подвала показывается в w-8 полоске (см. ветку collapsed). */}
      <LLMStatusFooter
        regulationsTotal={regulationsTotal}
        regulationsEnabled={regulationsEnabled}
      />
    </aside>
  )
}

// Компактный pillow-picker пресетов: чипы в две колонки, активный подсвечен.
// Юзер-presets идут вторым блоком с кнопкой удаления.
function PresetPicker({
  presets,
  activePresetId,
  onApply,
  onDelete,
}: {
  presets: SystemPromptPreset[]
  activePresetId: string | null
  onApply: (p: SystemPromptPreset) => void
  onDelete: (id: string) => void
}) {
  const builtins = presets.filter((p) => p.builtin)
  const userOnes = presets.filter((p) => !p.builtin)
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        Шаблоны сценариев
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {builtins.map((p) => (
          <PresetChip
            key={p.id}
            preset={p}
            active={activePresetId === p.id}
            onApply={() => onApply(p)}
          />
        ))}
      </div>
      {userOnes.length > 0 && (
        <>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Мои пресеты
          </div>
          <div className="space-y-1">
            {userOnes.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <PresetChip
                  preset={p}
                  active={activePresetId === p.id}
                  onApply={() => onApply(p)}
                  className="flex-1"
                />
                <button
                  onClick={() => {
                    if (window.confirm(`Удалить пресет «${p.label}»?`)) onDelete(p.id)
                  }}
                  className="shrink-0 rounded p-1 text-stone-300 transition hover:bg-rose-50 hover:text-rose-600"
                  title="Удалить пресет"
                  aria-label={`Удалить пресет ${p.label}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PresetChip({
  preset,
  active,
  onApply,
  className,
}: {
  preset: SystemPromptPreset
  active: boolean
  onApply: () => void
  className?: string
}) {
  return (
    <button
      onClick={onApply}
      title={preset.description}
      className={cn(
        'rounded border px-2 py-1.5 text-left text-[11px] transition',
        active
          ? 'border-violet-400 bg-violet-50 font-semibold text-violet-900 shadow-sm'
          : 'border-stone-200 bg-white text-stone-700 hover:border-violet-200 hover:bg-violet-50/40',
        className,
      )}
    >
      <div className="line-clamp-1 leading-tight">{preset.label}</div>
      {preset.effects?.disable_all_regulations && (
        <div
          className={cn(
            'mt-0.5 text-[9px] leading-tight',
            active ? 'text-violet-700' : 'text-stone-500',
          )}
        >
          выключит регламенты
        </div>
      )}
    </button>
  )
}

function SettingsSection({
  icon: Icon,
  title,
  customized,
  defaultOpen,
  children,
}: {
  icon: typeof Pencil
  title: string
  customized?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-md border border-stone-200 bg-white"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50">
        <Icon size={12} className="text-stone-500" />
        <span className="flex-1">{title}</span>
        {customized && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
            title="Значение отличается от дефолта"
          />
        )}
        <ChevronDown size={13} className="text-stone-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-stone-100 px-3 py-2.5">{children}</div>
    </details>
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
    <label className="block text-xs">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-stone-700">{label}</span>
        <span className="font-mono text-[11px] font-semibold text-violet-700">{format(value)}</span>
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
      <div className="mt-0.5 text-[10px] leading-tight text-stone-500">{hint}</div>
    </label>
  )
}

// Стартовый промпт-разогрев: формулировка задаёт LLM чёткие правила,
// чтобы ответ был структурным и адекватным независимо от состояния retrieval'а
// (есть/нет регламентов в контексте). Side-effect — Ollama подгружает модель
// qwen2.5:7b в RAM (~4.4 ГБ), следующие запросы будут быстрее.
const WARMUP_QUERY =
  'Привет! Расскажи кратко (3-4 пункта, без цитирования регламентов) что ты ' +
  'умеешь как ИИ-помощник аналитика в RAGRAF: над какими данными работаешь, ' +
  'какие задачи решаешь, и как пользоваться пресетами справа («Резюме документа», ' +
  '«Извлечь параметры», «Сравнить регламенты», «Краткий ответ»).'

function EmptyChatHint({
  onPick,
  onWarmup,
  examples,
}: {
  onPick: (text: string) => void
  /** Warmup отправляется с принудительно отключённым retrieval'ом —
   *  это быстрый путь даже если у пользователя по дефолту включены все регламенты. */
  onWarmup: () => void
  examples: string[]
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
        <Bot size={22} className="text-violet-700" />
      </div>
      <div className="mb-1 text-sm font-medium text-stone-800">Диалог пуст</div>
      <div className="mb-4 max-w-md text-xs text-stone-500">
        Начни с приветствия — это заодно прогреет LLM в память. Или задай вопрос
        про регламенты, выбрав один из примеров.
      </div>

      {/* Главная стартовая кнопка — крупная, в виолетовом стиле Author Layer.
          Первый запрос грузит qwen2.5:7b в RAM (~4.4 ГБ, 30-60 сек на M2 Air);
          дальше всё быстро. Регламенты на этот запрос принудительно отключены
          (forceSkipRegulations=true), чтобы LEAN-ветка ответила быстро. */}
      <button
        onClick={onWarmup}
        className="mb-4 inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700"
        title="Отправляет приветствие + прогревает LLM (первый ответ 30-60 сек, дальше быстрее). Регламенты на это сообщение пропускаются — быстрее ответ."
      >
        <Sparkles size={14} />
        Привет, что ты умеешь?
      </button>

      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-400">
        или примеры
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
  // Таймер «сколько секунд уже ждём» — на медленной LLM (qwen2.5:7b на M2 Air
  // легко уходит в минуту-две на больших промптах) пользователь должен видеть
  // что система работает, а не зависла. Если >30 сек — добавляем подсказку.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
        <Bot size={14} className="text-violet-700" />
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-stone-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
          </div>
          <span className="font-mono text-[10px] text-stone-400 tabular-nums">
            {elapsed}s
          </span>
        </div>
        {elapsed >= 30 && (
          <div className="mt-1 max-w-[280px] text-[10px] leading-tight text-stone-500">
            {elapsed >= 90
              ? 'Очень долго. Возможно стоит уменьшить num_ctx или отключить лишний контекст.'
              : 'qwen2.5:7b на M2 Air медленный — обычно 30-90 сек на ответ.'}
          </div>
        )}
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
