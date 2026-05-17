import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Check, FileSearch, Loader2, PackagePlus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DOMAIN_VISUALS, getDomainVisual } from '@/lib/domains'
import { Button } from '@/components/ui'

/**
 * Полноэкранный экран «Создать регламент из текста».
 *
 * Live до этого жил как вкладка `extract` в Sandbox. Перенесён в раздел
 * «Регламенты» потому что это RULES-BASED инструмент (regex + словарь
 * контекстных слов «давление→pressure»), а не AI-аналитика — нечего
 * было ему делать в студии аналитика рядом с LLM-чатом и RAGU.
 *
 * Backend: `/api/sandbox/extract-parameters` — без LLM, без Ollama,
 * без RAGU. См. `app/services/sandbox.py:extract_parameters` —
 * _PARAM_PATTERN (число ± deviation единица) + словарь контекстных
 * слов (давлен→pressure, температур→temperature, диаметр→diameter и т.д.).
 *
 * Поток:
 *   шаг 1: вставить текст / выбрать пример
 *   шаг 2: бэкенд возвращает кандидаты — выбираешь какие включить, можно
 *          переименовать, можно из нескольких упоминаний выбрать одно
 *   шаг 3: имя + домен → создаётся регламент через /api/sandbox/create-from-params,
 *          юзер сразу попадает в редактор для уточнения порогов и flow
 *
 * Опционально через `?domain=heating` URL-параметр пред-выбирается домен —
 * используется когда переходишь с CreateRegulationDialog.
 */

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

export function RegulationExtractScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetDomain = searchParams.get('domain')
  const [text, setText] = useState(DEFAULT_PRESET.text)
  const [activePresetId, setActivePresetId] = useState<string>(DEFAULT_PRESET.id)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [regName, setRegName] = useState(DEFAULT_PRESET.suggestedName)
  // Если в URL пришёл domain — берём его, иначе дефолт пресета.
  const [domain, setDomain] = useState<string>(presetDomain ?? DEFAULT_PRESET.suggestedDomain)

  const extract = useMutation({
    mutationFn: () => api.sandbox.extractParameters(text),
    onSuccess: (data) => {
      const newPicked: Record<string, string> = {}
      const newIncluded: Record<string, boolean> = {}
      for (const e of data.extracted) {
        if (!(e.suggested_name in newPicked)) newPicked[e.suggested_name] = e.id
        newIncluded[e.suggested_name] = true
      }
      setPicked(newPicked)
      setIncluded(newIncluded)
      setCustomNames({})
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

  const applyPreset = (p: ExtractPreset) => {
    setText(p.text)
    setActivePresetId(p.id)
    setRegName(p.suggestedName)
    if (!presetDomain) setDomain(p.suggestedDomain)
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
        suggested_name: customNames[p.suggested_name]?.trim() || p.suggested_name,
        value: p.value,
        deviation: p.deviation ?? null,
        unit: p.unit ?? null,
      })),
    })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="mb-2">
          <Link
            to="/regulations"
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
          >
            <ArrowLeft size={11} /> Назад к списку регламентов
          </Link>
        </div>
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-violet-100 p-2 text-violet-700">
            <FileSearch size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-stone-900">
              Создать регламент из фрагмента текста
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stone-600">
              Извлекаем числовые параметры из произвольного текста (Постановления,
              ТУ, ГОСТ) и собираем заготовку регламента. Работает <b>без LLM</b> —
              regex + словарь контекстных слов (давление→pressure, температура→
              temperature и т.д.). Подходит для формулировок вида «параметр N ± M ед.».
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-6 py-5">
        <StepHeader n={1} title="Вставь текст регламента или выбери пример справа" />
        <div className="flex flex-col gap-3 md:flex-row">
          <textarea
            rows={11}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
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
      </main>
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
