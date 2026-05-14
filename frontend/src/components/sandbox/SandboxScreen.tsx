import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Beaker,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Lightbulb,
  Loader2,
  Network,
  PackagePlus,
  ScanText,
  Search,
  SearchCheck,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DOMAIN_VISUALS, getDomainVisual } from '@/lib/domains'

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
                  {' '}Сейчас работает <b>mock-режим</b> (keyword scoring + regex) —{' '}
                  <b>без LLM-ключей и внешних сервисов</b>. Чтобы включить настоящий RAGU,
                  нужны pip-установка <code className="rounded bg-stone-100 px-1 text-xs">graph_ragu</code>{' '}
                  и доступ к LLM (облачный ключ или локальный llama-server) — см. справку справа.
                </>
              )}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {/* «Что такое RAGU?» — раскрывает подробную справку для руководителя.
                Раньше блок висел всегда и съедал полстраницы; теперь по требованию. */}
            <button
              onClick={() => setShowInfo((v) => !v)}
              title="Краткая справка: что такое RAGU и зачем она в связке с RAGRAF"
              aria-expanded={showInfo}
              className={cn(
                'group inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition',
                showInfo
                  ? 'border-violet-300 bg-violet-100 text-violet-900'
                  : 'border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-300 hover:bg-violet-100 hover:shadow',
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-200/70 group-hover:bg-violet-200">
                <BookOpen size={14} className="text-violet-700" />
              </span>
              <span className="leading-tight">
                <span className="block">Что такое RAGU?</span>
                <span className="block text-[10px] font-normal text-violet-700/80">
                  {showInfo ? 'скрыть справку' : 'короткое объяснение'}
                </span>
              </span>
              <ChevronDown
                size={14}
                className={cn('text-violet-500 transition-transform', showInfo && 'rotate-180')}
              />
            </button>
            <Link
              to="/sandbox/backlog"
              title="Бэклог: следующие RAGU-сценарии (Knowledge Graph, сравнение регламентов, авто-классификация, Q&A)"
              className="group inline-flex shrink-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 hover:shadow"
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
        </div>

        {/* Info-блок: появляется только по клику «Что такое RAGU?». Полная версия
            справки живёт на странице бэклога — здесь короткая выжимка. */}
        {showInfo && (
          <div className="mt-3 rounded-md border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-3 text-xs text-stone-700 shadow-sm">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                <BookOpen size={12} /> RAGU + RAGRAF — что это и зачем
              </div>
              <button
                onClick={() => setShowInfo(false)}
                aria-label="Скрыть справку"
                className="rounded p-0.5 text-violet-400 hover:bg-violet-100 hover:text-violet-700"
              >
                <X size={12} />
              </button>
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
        <button
          onClick={submit}
          disabled={!text.trim() || extract.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
        >
          {extract.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
          Извлечь параметры
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
