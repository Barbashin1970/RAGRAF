import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  buildModelCatalog,
  DEFAULT_MODEL_KIND,
  loadModelKind,
  MODEL_CATALOG,
  type ModelKind,
  modelByKind,
  resolveModelTag,
  saveModelKind,
} from './llmModels'

type Tab = 'search' | 'ragu'

function isTab(value: string | null): value is Tab {
  return value === 'search' || value === 'ragu'
}

export function SandboxScreen() {
  // ?tab=ragu в URL открывает сразу нужную вкладку — можно шарить ссылкой.
  // (Старый ?tab=extract → редирект на /regulations/new-from-text в App.tsx.)
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'search'
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    const current = searchParams.get('tab')
    if (current !== tab) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', tab)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Студия аналитика теперь только про LLM-инструменты: чат с локальной LLM
  // + редактор RAGU-промптов. Извлечение параметров — это rules-based regex
  // без LLM, оно переехало в /regulations/new-from-text как отдельный экран.
  //
  // Лейблы вкладок честнее отражают что внутри:
  //  • «Локальная LLM» — чат с Ollama (qwen2.5 / llama-3.2 / …) на твоей
  //    машине. RAGU работает как retrieval-слой поверх LLM (подмешивает
  //    контекст из корпуса в системный промпт). Сама генерация — это LLM,
  //    а не RAGU. Раньше вкладка называлась «Диалог с RAGU» — это вводило
  //    в заблуждение, потому что RAGU без LLM ничего не возвращает.
  //  • «RAGU Studio» — редактор промптов самого retrieval-слоя.
  const tabs: TabDef<Tab>[] = [
    { id: 'search', label: 'Локальная LLM', icon: MessageSquare },
    { id: 'ragu', label: 'RAGU Studio', icon: Sparkles },
  ]

  return (
    <PageShell>
      <PageHeader
        icon={Beaker}
        tone="author"
        title="Студия аналитика"
        titleTooltip={
          'ИИ-помощник для разбора документов (приказы, СНиПы, регламенты) ' +
          'через LLM/RAGU. Сами регламенты живут в разделе «Регламенты» ' +
          '(там же rules-based извлечение параметров из текста). Исполняются ' +
          'регламенты в разделе «Исполнение» (runtime, симулятор).'
        }
        badges={<Badge tone="author" uppercase>Author Layer</Badge>}
      >
        <div className="mt-3">
          <Tabs tabs={tabs} active={tab} onChange={setTab} tone="author" />
        </div>
      </PageHeader>

      {tab === 'search' && <SearchDemo />}
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

type LLMStatusTone = 'ok' | 'warm' | 'cold' | 'mock' | 'unknown' | 'busy'

function llmStatusTone(
  data: ReturnType<typeof useLLMStatus>['data'],
  isGenerating?: boolean,
): LLMStatusTone {
  // «busy» — приоритетнее всего: пока идёт chat-запрос, показываем
  // пульсирующий фиолетовый, чтобы новичок видел что система работает.
  // Это особенно важно на Cerebras/Groq — там нет TypingIndicator-«троеточия»
  // если ответ возвращается крупным куском за раз.
  if (isGenerating) return 'busy'
  if (!data) return 'unknown'
  if (data.mode === 'mock') return 'mock'
  if (!data.llm_reachable) return 'cold'
  // Для cloud-провайдеров концепции «в RAM/не в RAM» нет — Cerebras/Groq всегда
  // готовы. Возвращаем 'ok' (зелёный) при reachable, иначе пользователь видит
  // постоянный оранжевый и думает что что-то не так.
  if (data.provider && data.provider !== 'ollama') return 'ok'
  return data.llm_loaded_in_memory ? 'ok' : 'warm'
}

const TONE_DOT: Record<LLMStatusTone, string> = {
  ok: 'text-emerald-500',
  warm: 'text-amber-500',
  cold: 'text-rose-500',
  mock: 'text-amber-500',
  unknown: 'text-stone-300',
  busy: 'text-violet-500 animate-pulse',
}

function llmStatusLabel(tone: LLMStatusTone): string {
  switch (tone) {
    case 'ok':
      return 'LLM на связи и готова отвечать.'
    case 'warm':
      return 'Ollama на связи, но модель не в памяти — первый запрос будет медленным.'
    case 'cold':
      return 'LLM-провайдер не отвечает. Проверь что сервис запущен и base_url корректен.'
    case 'mock':
      return 'Mock-режим: без LLM, retrieval по TF-IDF. Задай OPENAI_BASE_URL и OPENAI_API_KEY для подключения внешнего провайдера.'
    case 'unknown':
      return 'Состояние LLM ещё не получено.'
    case 'busy':
      return 'Идёт генерация ответа…'
  }
}

/** Компактный индикатор для свёрнутой правой панели (одна точка + tooltip). */
function LLMStatusDot({ isGenerating }: { isGenerating?: boolean }) {
  const { data } = useLLMStatus()
  const tone = llmStatusTone(data, isGenerating)
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
  selectedModel,
  isGenerating,
}: {
  regulationsTotal: number
  regulationsEnabled: number
  /** Ollama tag модели которую сейчас выберет чат — для кнопки load/unload. */
  selectedModel: string
  /** true пока chat-mutation в полёте — индикатор пульсирует, статус «генерация…». */
  isGenerating?: boolean
}) {
  const qc = useQueryClient()
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

  // Состояние «выбранная модель сейчас в RAM Ollama» — нужно для toggle-кнопки.
  // loaded_models приходит из llm-info, в нём список tags которые сейчас прогреты.
  const loadedModels = data?.loaded_models ?? (data?.llm_loaded_in_memory ? [data.llm_model] : [])
  const isSelectedLoaded = loadedModels.includes(selectedModel)

  const loadMut = useMutation({
    mutationFn: () => api.sandbox.loadModel(selectedModel),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sandbox-llm-info'] }),
  })
  const unloadMut = useMutation({
    mutationFn: () => api.sandbox.unloadModel(selectedModel),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sandbox-llm-info'] }),
  })
  const busy = loadMut.isPending || unloadMut.isPending

  if (isError || !data) return null

  const tone = llmStatusTone(data, isGenerating)
  const provider = data.provider ?? 'ollama'
  // Управление load/unload (keep_alive) — Ollama-specific. Для cloud-провайдеров
  // не показываем кнопки — там моделями управляет провайдер.
  const isOllama = provider === 'ollama'
  const providerLabel: Record<string, string> = {
    ollama: 'Ollama',
    cerebras: 'Cerebras',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    mock: 'Mock',
  }
  if (data.mode === 'mock') {
    return (
      <div className="border-t border-stone-200 bg-amber-50/40 px-3 py-2 text-[10px] text-amber-900">
        <div className="flex items-center gap-1.5">
          <Circle size={8} className={cn('fill-current', TONE_DOT[tone])} />
          <span><b>Mock-режим</b> — без LLM, TF-IDF поиск</span>
        </div>
        <div className="mt-0.5 text-amber-700">
          Задай OPENAI_BASE_URL и OPENAI_API_KEY для подключения провайдера.
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
          {providerLabel[provider] ?? provider}:{' '}
          {/* Пока идёт chat-запрос — пишем «генерация…» фиолетовым, чтобы
              новичок видел что модель работает (особенно важно на cloud:
              ответ может прилететь крупным куском без typing-троеточия). */}
          <span
            className={cn(
              isGenerating
                ? 'text-violet-700'
                : tone === 'cold'
                  ? 'text-rose-700'
                  : 'text-emerald-700',
            )}
          >
            {isGenerating
              ? 'генерация…'
              : data.llm_reachable
                ? 'на связи'
                : 'не отвечает'}
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
          <code
            className="truncate rounded bg-violet-50 px-1 font-mono text-[9px] text-violet-800"
            title={selectedModel}
          >
            {selectedModel.split(':')[0]}
            {selectedModel.includes(':') ? ':' + selectedModel.split(':')[1].split('-')[0] : ''}
          </code>
          {/* Toggle загрузки модели в RAM. Зелёная молния когда уже в памяти,
              серая иконка ⏏ для выгрузки; и наоборот — иконка ⚡ когда не
              загружена. Меняет состояние через Ollama keep_alive. Для облачных
              провайдеров эта кнопка не имеет смысла — модель не в нашей RAM. */}
          {isOllama && isSelectedLoaded ? (
            <button
              onClick={() => unloadMut.mutate()}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
              title={`Модель в RAM (~${selectedModel.includes('3b') ? '2' : '5'} ГБ). Кликни чтобы выгрузить и освободить память.`}
            >
              {unloadMut.isPending ? (
                <Loader2 size={9} className="animate-spin" />
              ) : (
                <Zap size={9} className="fill-current" />
              )}
              в RAM
            </button>
          ) : isOllama ? (
            <button
              onClick={() => loadMut.mutate()}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-stone-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"
              title={`Прогреть модель в RAM Ollama. Первый запрос займёт 10-30 сек на загрузку весов (~${selectedModel.includes('3b') ? '2' : '5'} ГБ), потом ответы быстрые.`}
            >
              {loadMut.isPending ? (
                <Loader2 size={9} className="animate-spin" />
              ) : (
                <Zap size={9} />
              )}
              прогреть
            </button>
          ) : null}
        </div>
        {(loadMut.isError || unloadMut.isError) && (
          <div className="text-[9px] text-rose-600">
            {((loadMut.error || unloadMut.error) as Error).message}
          </div>
        )}
        {data.embeddings_enabled !== false ? (
          <div className="flex items-center gap-1.5">
            <span className="text-stone-500">Embed:</span>
            <code className="truncate rounded bg-stone-100 px-1 font-mono text-[9px] text-stone-700">
              {data.embed_model}
            </code>
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 text-stone-500"
            title="Embeddings отключены — семантический поиск работает по ключевым словам. Загрузка PDF тоже недоступна."
          >
            <span>Embed:</span>
            <code className="rounded bg-stone-100 px-1 font-mono text-[9px] text-stone-600">
              keyword-only
            </code>
          </div>
        )}
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
  // llm-info нужен здесь чтобы корректно разрешить ModelKind → реальный tag
  // (для Cerebras precise=qwen-3-32b, для Ollama precise=qwen2.5:7b).
  const { data: llmInfo } = useLLMStatus()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  // Параметры генерации.
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE)
  const [topK, setTopK] = useState<number>(DEFAULT_TOP_K)
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_MAX_TOKENS)
  const [numCtx, setNumCtx] = useState<number>(DEFAULT_NUM_CTX)
  // Выбранная модель — точная (7b) или быстрая (3b). Persisted в localStorage.
  const [modelKind, setModelKindState] = useState<ModelKind>(() => loadModelKind())
  const setModelKind = (kind: ModelKind) => {
    setModelKindState(kind)
    saveModelKind(kind)
  }
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
      // num_ctx применим только к Ollama. Для cloud-провайдеров не отправляем —
      // бэк всё равно срежет, но не засоряем payload.
      const supportsNumCtx = llmInfo?.supports_num_ctx !== false
      return api.sandbox.chat(
        history,
        {
          top_k: topK,
          temperature,
          max_tokens: maxTokens,
          ...(supportsNumCtx ? { num_ctx: numCtx } : {}),
          extra_system_prompt: extraSystemPrompt.trim() || undefined,
          disabled_regulation_ids: effectiveDisabled,
          model: resolveModelTag(modelKind, llmInfo),
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
    if (fx?.model !== undefined) setModelKind(fx.model)
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
        modelKind={modelKind}
        onModelKindChange={(k) => {
          setModelKind(k)
          setActivePresetId(null)
        }}
        isGenerating={chat.isPending}
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
  modelKind,
  onModelKindChange,
  isGenerating,
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
  modelKind: ModelKind
  onModelKindChange: (k: ModelKind) => void
  isGenerating?: boolean
}) {
  // llm-info нужен здесь, чтобы передать в LLMStatusFooter правильный tag
  // выбранной модели для текущего провайдера (cerebras qwen-3-32b vs ollama qwen2.5:7b).
  const { data: llmInfoForPanel } = useLLMStatus()
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
        <LLMStatusDot isGenerating={isGenerating} />
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

        <ModelPickerSection
          modelKind={modelKind}
          onChange={onModelKindChange}
        />

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
              // Cloud-провайдеры (Cerebras Qwen3-235B, gpt-oss-120b) выдают
              // до 16K в одном ответе; Ollama на M2 практически — 4K потолок.
              // llm-info.limits.max_tokens отражает это автоматически.
              max={llmInfoForPanel?.limits.max_tokens[1] ?? 4000}
              step={(llmInfoForPanel?.limits.max_tokens[1] ?? 4000) >= 8000 ? 500 : 50}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`)}
              hint={
                llmInfoForPanel?.provider === 'cerebras'
                  ? 'Лимит длины ОТВЕТА. Cerebras Qwen3-235B / gpt-oss-120b cap’ятся на 16K; llama3.1-8b — 8K.'
                  : 'Лимит длины ОТВЕТА. 600 ≈ 3-5 пунктов, 200 ≈ короткий абзац'
              }
              onChange={(v) => onParamsChange({ maxTokens: v })}
            />
            {/* num_ctx применим только к Ollama (extra_body.options.num_ctx).
                Cloud-провайдеры выбирают context-окно сами по модели — слайдер
                не делает ничего. Скрываем чтобы не путать. */}
            {llmInfoForPanel?.supports_num_ctx !== false && (
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
            )}
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
        selectedModel={resolveModelTag(modelKind, llmInfoForPanel)}
        isGenerating={isGenerating}
      />
    </aside>
  )
}

// Селектор модели LLM. Каталог моделей провайдер-зависим:
// — Ollama: precise/fast с RAM/tok/s подсказками (MODEL_CATALOG).
// — Cerebras / Groq / OpenRouter: модели из llm-info.available_models,
//   с label/hint из PROVIDER_HINTS (см. llmModels.ts).
// «Не установлена» плашка имеет смысл только для Ollama (там можно `pull`),
// для cloud-провайдеров скрыта.
function ModelPickerSection({
  modelKind,
  onChange,
}: {
  modelKind: ModelKind
  onChange: (k: ModelKind) => void
}) {
  const { data: llmInfo } = useLLMStatus()
  const isOllama = !llmInfo?.provider || llmInfo.provider === 'ollama'
  const catalog = useMemo(
    () => buildModelCatalog(llmInfo?.provider, llmInfo?.available_models, llmInfo?.llm_model),
    [llmInfo?.provider, llmInfo?.available_models, llmInfo?.llm_model],
  )
  const availableModels = new Set(llmInfo?.available_models ?? [])
  // «customized» = выбрана не первая модель текущего каталога. Для Ollama это
  // эквивалент `!== DEFAULT_MODEL_KIND`; для cloud-провайдера дефолт — первый
  // tag из `available_models` (для Cerebras = qwen-3-235b).
  const customized = !!catalog[0] && modelKind !== catalog[0].kind
  const selected = catalog.find((m) => m.kind === modelKind) ?? catalog[0] ?? modelByKind(modelKind)
  const isSelectedInstalled =
    !isOllama || availableModels.size === 0 || availableModels.has(selected.ollama_tag)

  return (
    <SettingsSection icon={Cpu} title="Модель LLM" customized={customized}>
      <div className="space-y-2">
        {catalog.map((m, idx) => {
          const active = m.kind === modelKind
          // Только для Ollama имеет смысл проверять `installed` (доступность
          // в `/api/tags`). Для cloud-провайдеров считаем что все из preset'а
          // живые — проверка случится при первом chat-запросе.
          const installed = !isOllama || availableModels.size === 0 || availableModels.has(m.ollama_tag)
          return (
            <button
              key={`${m.ollama_tag}-${idx}`}
              onClick={() => onChange(m.kind)}
              className={cn(
                'block w-full rounded border px-2.5 py-2 text-left text-xs transition',
                active
                  ? 'border-violet-400 bg-violet-50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-violet-200 hover:bg-violet-50/40',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex h-3 w-3 items-center justify-center rounded-full border',
                    active ? 'border-violet-500 bg-violet-500' : 'border-stone-300 bg-white',
                  )}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className={cn('font-medium', active ? 'text-violet-900' : 'text-stone-800')}>
                  {m.label}
                </span>
                {!installed && (
                  <span
                    className="ml-auto rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800"
                    title={`Модель не установлена. Выполни: ollama pull ${m.ollama_tag}`}
                  >
                    нет
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] leading-tight text-stone-500">
                ~{m.tokens_per_sec} tok/s
                {m.ram_gb > 0 ? ` · ${m.ram_gb} ГБ RAM` : ''}
              </div>
              <div className="mt-0.5 text-[10px] leading-tight text-stone-500">
                {m.hint}
              </div>
            </button>
          )
        })}
        <p className="text-[10px] leading-tight text-stone-500">
          <b>Когда {selected.kind === 'precise' ? 'основная' : 'быстрая'}:</b>{' '}
          {selected.use_when}
        </p>
        {!isSelectedInstalled && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-tight text-amber-900">
            Модель не установлена в Ollama. В терминале:
            <code className="mt-0.5 block font-mono text-[10px] text-amber-900">
              ollama pull {selected.ollama_tag}
            </code>
          </div>
        )}
      </div>
    </SettingsSection>
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
              ? 'Очень долго. Возможно стоит уменьшить max_tokens или отключить лишний контекст.'
              : 'LLM отвечает дольше обычного — это нормально для длинных контекстов или большой модели.'}
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
                <Sparkles size={9} /> ответ LLM
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

