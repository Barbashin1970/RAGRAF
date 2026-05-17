import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CornerDownRight,
  Database,
  FileCode2,
  HelpCircle,
  Info,
  Lightbulb,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { api, type RaguConfig, type RaguPrompt } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Badge, Button, PageShell } from '@/components/ui'

/**
 * RAGU Studio — каталог системных промптов RAGU + debug-панель.
 *
 * Что показывает:
 *  - Слева: 18 промптов (group'ed по префиксу: artifact / global / local /
 *    naive / mix / ragu_lm / query / cluster).
 *  - Справа: редактор выбранного промпта — default-текст внизу для сверки,
 *    редактируемое поле override сверху, badge variables, кнопки Save/Restore.
 *  - Сверху: read-only снепшот RaguConfig (модели / language / builder defaults).
 *
 * Зачем: RAGU был "чёрным ящиком" — пользователь не видел, *чем* библиотека
 * просит LLM-у. Эта панель выводит все системные prompts наружу + позволяет
 * переписать без форка graph_ragu.
 */

// Префикс → человекочитаемая группа + одна строчка «что эти промпты делают».
// Используется и для сайдбара и для всплывающей подсказки над заголовком группы,
// чтобы пользователь сразу понимал «зачем мне трогать эти 4 шаблона».
const GROUP_LABELS: {
  match: (n: string) => boolean
  label: string
  icon: typeof Sparkles
  hint: string
}[] = [
  {
    match: (n) => n.startsWith('artifact_'),
    label: 'Извлечение сущностей',
    icon: Database,
    hint: 'Когда RAGU читает регламент и тащит из него именованные сущности (PERSON, ORGANIZATION, …) и связи между ними. Меняй если в графе появляется мусор или, наоборот, что-то важное теряется.',
  },
  {
    match: (n) => n.startsWith('community_') || n === 'cluster_summarize',
    label: 'Общины и кластеры',
    icon: Boxes,
    hint: 'После Leiden-кластеризации RAGU генерирует отчёт по каждой общине — title + 5–10 key findings. Меняй если хочется другого формата сводки (короче, длиннее, с акцентом на риски и т.п.).',
  },
  {
    match: (n) => n.startsWith('entity_') || n.startsWith('relation_'),
    label: 'Слияние дублей',
    icon: RefreshCw,
    hint: 'Когда одна сущность найдена в разных кусках текста по-разному (например, «РСО» и «Ресурсоснабжающая организация»), RAGU сливает их и просит LLM написать одно описание.',
  },
  {
    match: (n) =>
      n.startsWith('global_') ||
      n.startsWith('local_') ||
      n.startsWith('naive_') ||
      n.startsWith('mix_'),
    label: 'Поисковые движки',
    icon: Search,
    hint: 'Финальный шаг — синтез ответа на пользовательский вопрос. Local = по entity-окрестностям, Global = по community-отчётам, Naive = vector-RAG без графа, Mix = ансамбль. Меняй стиль/формат ответа.',
  },
  {
    match: (n) => n.startsWith('ragu_lm_'),
    label: 'RAGU-lm пайплайн',
    icon: Server,
    hint: 'Альтернативный extractor: вместо одного жирного промпта — 4 коротких стадии (NER → нормализация → описание сущности → описание связи). Подходит для малых LLM (phi3 / llama-3.2:3b).',
  },
  {
    match: (n) => n.startsWith('query_'),
    label: 'Query Planning',
    icon: FileCode2,
    hint: 'Когда пользователь задаёт сложный вопрос, QueryPlanEngine сначала разбивает его на простые подзапросы с зависимостями (DAG), потом отвечает по каждому отдельно. Меняй логику декомпозиции.',
  },
]

function groupOf(name: string): { label: string; icon: typeof Sparkles; hint: string } {
  for (const g of GROUP_LABELS) if (g.match(name)) return g
  return { label: 'Прочее', icon: Sparkles, hint: '' }
}

// Подсказки к самым частым Jinja2-переменным в RAGU. Если переменной нет в карте,
// используется fallback-текст. Это не валидация — просто помощь пользователю
// понять «что сюда подставится в момент LLM-вызова».
const VARIABLE_HINTS: Record<string, string> = {
  query: 'Вопрос пользователя, как он пришёл в /api/search.',
  context: 'Извлечённый из графа контекст (entities + relations + chunks), преобразованный в текст.',
  language: 'Язык генерации (russian/english) из Settings.language.',
  entity_types: 'Допустимый набор типов сущностей (NEREL: PERSON/ORGANIZATION/…), направляет NER.',
  relation_types: 'Допустимый набор типов связей (SPOUSE/WORKS_AS/LOCATED_IN/…).',
  entity: 'Объект сущности: entity_name, entity_type, description.',
  relation: 'Объект связи: subject_name, object_name, description, strength.',
  community: 'Кластер из Leiden: entities[] + relations[].',
  artifacts: 'Существующие триплеты, которые валидатор должен дополнить.',
  text: 'Сырой текстовый фрагмент документа.',
  content: 'Список описаний, которые нужно слить в одно.',
  payload: 'Многоуровневая структура с результатами разных движков (для mix_search).',
  section_label: '«chunk» или «summary» — что объединяется в mix_search.',
  original_query: 'Исходный подзапрос до rewrite (для query_rewrite).',
  source_entity: 'Ненормализованная сущность (для ragu_lm_entity_normalization).',
  source_text: 'Контекстный текст вокруг сущности (для ragu_lm).',
  normalized_entity: 'Лемматизированная сущность (для ragu_lm_entity_description).',
  first_normalized_entity: 'Первая сущность в паре (для ragu_lm_relation_description).',
  second_normalized_entity: 'Вторая сущность в паре (для ragu_lm_relation_description).',
}

/**
 * Контент RAGU Studio без обёртки PageShell/PageHeader — встраивается
 * как 3-й таб внутри Студии аналитика. Standalone-маршрут /ragu редиректит
 * в `/sandbox?tab=ragu` (см. App.tsx), так что fullscreen-вариант (RaguStudioScreen
 * ниже) теперь не используется в роутах, но оставлен для возможной интеграции
 * в другие места приложения.
 */
export function RaguStudioContent() {
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['ragu-prompts'],
    queryFn: () => api.ragu.listPrompts(),
  })
  const { data: config } = useQuery({
    queryKey: ['ragu-config'],
    queryFn: () => api.ragu.getConfig(),
  })

  const prompts = data?.prompts ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return prompts
    return prompts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    )
  }, [prompts, search])

  // Группируем по семантике для UX-навигации.
  const grouped = useMemo(() => {
    const m = new Map<string, RaguPrompt[]>()
    for (const p of filtered) {
      const g = groupOf(p.name).label
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(p)
    }
    return m
  }, [filtered])

  const overridesCount = prompts.filter((p) => p.has_override).length

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Toolbar секции RAGU Studio: бейджи + 3 info-кнопки в одной строке.
          Раньше эти кнопки жили в шапке Студии аналитики — переехали сюда
          вместе с RAGU Studio чтобы не зашумлять основной экран чата. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-800">
          <Sparkles size={14} className="text-violet-600" /> RAGU Studio
        </div>
        <Badge tone="info" uppercase>Prompt Layer</Badge>
        <Badge tone="neutral">graph_ragu 0.0.2</Badge>
        {overridesCount > 0 && (
          <span title={`У ${overridesCount} промптов есть твои переопределения. Они применяются на следующем /api/search.`}>
            <Badge tone="warning">{overridesCount} overrides</Badge>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Единая точка справки: интро «Что такое RAGU» + workflow +
              ссылка на бэклог сценариев. Раньше было три отдельных входа
              (две кнопки + плашка) с пересекающимся контентом — объединили
              в один модал, чтобы не дублировать. */}
          <Button
            variant="author"
            size="sm"
            icon={<HelpCircle size={13} />}
            onClick={() => setHelpOpen(true)}
            title="Что такое RAGU, как пользоваться этим экраном, бэклог сценариев"
          >
            Справка RAGU
          </Button>
        </div>
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {config && <ConfigPanel config={config} />}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader2 size={14} className="animate-spin" /> Загрузка каталога промптов…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Не удалось загрузить промпты: {(error as Error).message}
          </div>
        )}
        {data && !data.available && (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <b>RAGU не установлен в окружении бэкенда.</b> Каталог промптов недоступен.
              Для активации: <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">pip install graph_ragu</code>
              {' '}и <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">RAGU_ENABLED=true</code> в .env.
            </div>
          </div>
        )}

        {data?.available && (
          <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
            {/* Сайдбар */}
            <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden rounded-md border border-stone-200 bg-white">
              <div className="border-b border-stone-200 p-2">
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск по имени/описанию"
                    className="w-full rounded border border-stone-200 py-1.5 pl-7 pr-2 text-xs placeholder:text-stone-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {[...grouped.entries()].map(([groupLabel, list]) => {
                  // Восстанавливаем hint по label'у — мы группируем уже по нему,
                  // но в map'е hint'ы лежат у спецификации, не у label'а.
                  const groupSpec = GROUP_LABELS.find((g) => g.label === groupLabel)
                  return (
                    <div key={groupLabel} className="mb-3">
                      <div
                        className="mb-1 inline-flex cursor-help items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500"
                        title={groupSpec?.hint}
                      >
                        {groupLabel}
                        {groupSpec?.hint && <Info size={9} className="text-stone-400" />}
                      </div>
                      <div className="space-y-0.5">
                        {list.map((p) => (
                          <PromptListItem
                            key={p.name}
                            prompt={p}
                            active={selected === p.name}
                            onClick={() => setSelected(p.name)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div className="px-1 py-4 text-center text-xs text-stone-500">
                    Ничего не найдено по «<b>{search}</b>».
                  </div>
                )}
              </div>
            </aside>

            {/* Редактор */}
            <section className="min-w-0 flex-1 overflow-hidden rounded-md border border-stone-200 bg-white">
              {selected ? (
                <PromptEditor name={selected} key={selected} />
              ) : (
                <EmptyEditor count={prompts.length} />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Standalone-страница RAGU Studio, обёрнутая в PageShell+PageHeader.
 * Сейчас не используется в роутах (/ragu редиректит в /sandbox?tab=ragu),
 * но оставлена как fallback на случай если понадобится отдельный полноэкранный
 * вариант.
 */
export function RaguStudioScreen() {
  return (
    <PageShell>
      <RaguStudioContent />
    </PageShell>
  )
}

function PromptListItem({
  prompt,
  active,
  onClick,
}: {
  prompt: RaguPrompt
  active: boolean
  onClick: () => void
}) {
  const overrideTooltip = prompt.has_override
    ? `У этого промпта есть твоё переопределение${
        prompt.override_updated_at
          ? ` от ${new Date(prompt.override_updated_at).toLocaleString('ru-RU')}`
          : ''
      }${prompt.override_comment ? `. Комментарий: ${prompt.override_comment}` : ''}. RAGU будет использовать его на следующем поиске.`
    : ''
  return (
    <button
      onClick={onClick}
      // title — нативный browser tooltip, удобен для длинного описания в сайдбаре
      // (не лезет в layout, не требует JS-popover). Появляется после ~1 сек hover.
      title={prompt.description ? `${prompt.name}\n\n${prompt.description}` : prompt.name}
      className={cn(
        'block w-full rounded px-2 py-1.5 text-left text-xs transition',
        active ? 'bg-violet-100 text-violet-900' : 'text-stone-700 hover:bg-stone-100',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-[11px]">{prompt.name}</span>
        {prompt.has_override && (
          <span
            className="ml-auto shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800"
            title={overrideTooltip}
          >
            override
          </span>
        )}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10px] text-stone-500">
        {prompt.description || 'без описания'}
      </div>
    </button>
  )
}

function EmptyEditor({ count }: { count: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-stone-500">
      <Sparkles size={32} className="text-stone-300" />
      <div className="text-sm font-medium text-stone-700">Выберите промпт слева</div>
      <p className="max-w-md text-xs leading-relaxed text-stone-500">
        В каталоге <b>{count}</b> системных промптов RAGU. Каждый отвечает за свою стадию
        (извлечение сущностей, отчёт по общинам, ответ поискового движка). Кликни любой, чтобы
        посмотреть текущий шаблон и при желании переписать.
      </p>
    </div>
  )
}

function PromptEditor({ name }: { name: string }) {
  const qc = useQueryClient()
  const { data: prompt, isLoading } = useQuery({
    queryKey: ['ragu-prompt', name],
    queryFn: () => api.ragu.getPrompt(name),
  })

  const [draft, setDraft] = useState<string | null>(null)
  const [comment, setComment] = useState<string>('')

  // Когда подгружается prompt — инициализируем draft текущим override или default.
  const initialValue = prompt
    ? prompt.override_template ?? prompt.default_template
    : ''

  const value = draft ?? initialValue
  const dirty = prompt ? value !== (prompt.override_template ?? prompt.default_template) : false

  const save = useMutation({
    mutationFn: () =>
      api.ragu.savePromptOverride(name, {
        template: value,
        role: (prompt?.role ?? 'user') as 'user' | 'system' | 'ai',
        comment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ragu-prompts'] })
      qc.invalidateQueries({ queryKey: ['ragu-prompt', name] })
      setDraft(null)
      setComment('')
    },
  })

  const restore = useMutation({
    mutationFn: () => api.ragu.deletePromptOverride(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ragu-prompts'] })
      qc.invalidateQueries({ queryKey: ['ragu-prompt', name] })
      setDraft(null)
    },
  })

  if (isLoading || !prompt) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-stone-500">
        <Loader2 size={14} className="mr-2 animate-spin" /> Загрузка…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-stone-200 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
            <Pencil size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800">
                {prompt.name}
              </code>
              <span title={`Сообщение отправляется LLM с ролью «${prompt.role}». system = инструкция, user = запрос, ai = пример ответа.`}>
                <Badge tone="neutral">{prompt.role}</Badge>
              </span>
              <span title={`RAGU ждёт ответ от LLM в формате Pydantic-схемы «${prompt.pydantic_schema}». Не правь структуру JSON-выхода в шаблоне — сломается парсер.`}>
                <Badge tone="info">{prompt.pydantic_schema}</Badge>
              </span>
              {prompt.has_override && (
                <span title="RAGU будет использовать твой шаблон вместо встроенного. Восстанови default кнопкой «Вернуть default» внизу.">
                  <Badge tone="warning">override</Badge>
                </span>
              )}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-stone-600">
              {prompt.description || 'Без описания.'}
            </div>
            {prompt.variables.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                <span
                  className="cursor-help text-stone-500"
                  title="Jinja2-плейсхолдеры внутри шаблона. RAGU подставит их значениями в момент LLM-вызова. Если удалить плейсхолдер — соответствующий контекст не попадёт в промпт."
                >
                  Переменные:
                </span>
                {prompt.variables.map((v) => (
                  <code
                    key={v}
                    className="cursor-help rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-700"
                    title={VARIABLE_HINTS[v] ?? `Подставляется значением переменной «${v}» в момент LLM-вызова.`}
                  >
                    {`{{ ${v} }}`}
                  </code>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
            Шаблон {prompt.has_override ? '(переопределённый)' : '(default RAGU)'}
          </label>
          {dirty && <span className="text-[10px] font-medium text-amber-700">не сохранено</span>}
        </div>
        <textarea
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="block min-h-[280px] w-full resize-y rounded-md border border-stone-200 bg-stone-50/60 px-3 py-2 font-mono text-xs leading-relaxed text-stone-800 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/30"
        />

        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-600">
            Комментарий (для аудита, опционально)
          </label>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="например: убрал упоминание markdown — phi3 на него реагирует литералом"
            maxLength={500}
            className="w-full rounded-md border border-stone-200 px-3 py-1.5 text-xs placeholder:text-stone-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>

        {prompt.has_override && (
          <details className="mt-4 rounded-md border border-stone-200 bg-stone-50/40 p-3">
            <summary className="cursor-pointer text-xs font-medium text-stone-700">
              Показать default-шаблон RAGU для сверки
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] leading-relaxed text-stone-700">
              {prompt.default_template}
            </pre>
          </details>
        )}

        {save.isError && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Не удалось сохранить: {(save.error as Error).message}
          </div>
        )}
        {restore.isError && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Не удалось откатить: {(restore.error as Error).message}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-stone-200 bg-stone-50/60 px-4 py-3">
        <div className="text-[10px] text-stone-500">
          {prompt.has_override && prompt.override_updated_at && (
            <>Override обновлён {new Date(prompt.override_updated_at).toLocaleString('ru-RU')}</>
          )}
        </div>
        <div className="flex items-center gap-2">
          {prompt.has_override && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={() => {
                if (window.confirm('Удалить override и вернуться к default RAGU?')) restore.mutate()
              }}
              disabled={restore.isPending}
              title="Удалить твоё переопределение и вернуть встроенный в graph_ragu шаблон. Запись из DuckDB удаляется."
            >
              {restore.isPending ? 'Откатываю…' : 'Вернуть default'}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            title={
              dirty
                ? 'Сохранить твой шаблон в DuckDB. Применится на следующем /api/search или /api/sandbox/chat — перезагружать сервер не нужно.'
                : 'Поменяй что-нибудь в шаблоне, чтобы сохранить override.'
            }
          >
            {save.isPending ? 'Сохраняю…' : 'Сохранить override'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

// Хинты для BuilderArguments — пользователю объясняем «что эта ручка делает».
// Если ключа нет — пустой fallback, тултип просто не показывается.
const BUILDER_HINTS: Record<string, string> = {
  use_llm_summarization: 'Сливать дубликаты сущностей/связей через LLM. Если выключить — будет тупой concat без переформулировки.',
  use_clustering: 'Кластеризовать похожие сущности перед summarization. На малом корпусе не нужно — overhead больше пользы.',
  build_only_vector_context: 'Пропустить extraction/summarization, построить только vector-индекс чанков (для NaiveSearch). Самый быстрый режим.',
  make_community_summary: 'Генерировать отчёт по каждой Leiden-общине. Нужен для GlobalSearch. Без него глобальный поиск не работает.',
  remove_isolated_nodes: 'Удалять сущности у которых не нашлось связей — они засоряют граф.',
  vectorize_chunks: 'Создавать embeddings для каждого чанка. Нужен для NaiveSearchEngine.',
  cluster_only_if_more_than: 'Порог запуска кластеризации (по числу сущностей). При маленьком графе кластеризация не нужна.',
  summarize_only_if_more_than: 'Порог запуска community-summarization. Маленькие общины не имеют смысла суммировать.',
  max_cluster_size: 'Максимум сущностей в одном кластере. Ограничивает потребление LLM на summarization.',
  random_seed: 'Seed для Leiden — обеспечивает воспроизводимость состава общин при повторном запуске.',
}

const CONFIG_HINTS: Record<string, string> = {
  LLM: 'Большая модель для генерации сводок, ответов и описаний (qwen2.5:7b у нас).',
  Embedder: 'Модель для построения векторных индексов (bge-m3 = 1024d). Используется и в Naive RAG, и в Local search.',
  Language: 'Язык для всех LLM-вызовов. Подставляется в Jinja как {{ language }}. Переключение на лету не пересобирает граф, но влияет на следующие запросы.',
  'Base URL': 'OpenAI-совместимый endpoint. У нас Ollama: http://localhost:11434/v1.',
  'Storage folder': 'Где RAGU хранит kv_*.json, vdb_*.json, knowledge_graph.gml. Используется как кэш + persist.',
  'Prompts в каталоге': 'Сколько системных промптов экспонировано из graph_ragu. На 0.0.2 — 18.',
}

function ConfigPanel({ config }: { config: RaguConfig }) {
  const builderDefaults = config.builder_defaults ?? {}
  return (
    <details className="mb-4 rounded-md border border-stone-200 bg-white">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-stone-800">
        <Settings size={14} className="text-stone-500" />
        Текущая конфигурация RAGU
        {!config.available && (
          <span title="Пакет graph_ragu не импортируется в текущем окружении бэкенда.">
            <Badge tone="danger">не установлен</Badge>
          </span>
        )}
        {!config.ragu_enabled && (
          <span title="В .env стоит RAGU_ENABLED=false — RAGU не инициализируется, /api/search возвращает 503.">
            <Badge tone="warning">RAGU_ENABLED=false</Badge>
          </span>
        )}
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-stone-100 px-4 py-3 text-xs md:grid-cols-2 lg:grid-cols-3">
        <ConfigItem label="LLM" value={config.llm_model} hint={CONFIG_HINTS.LLM} />
        <ConfigItem label="Embedder" value={config.embed_model} hint={CONFIG_HINTS.Embedder} />
        <ConfigItem label="Language" value={config.language ?? '—'} hint={CONFIG_HINTS.Language} />
        <ConfigItem label="Base URL" value={config.base_url ?? '—'} mono hint={CONFIG_HINTS['Base URL']} />
        <ConfigItem label="Storage folder" value={config.storage_folder} mono hint={CONFIG_HINTS['Storage folder']} />
        <ConfigItem label="Prompts в каталоге" value={String(config.prompt_count ?? 0)} hint={CONFIG_HINTS['Prompts в каталоге']} />
      </div>
      <div className="border-t border-stone-100 px-4 py-3">
        <div
          className="mb-2 inline-flex cursor-help items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600"
          title="Параметры сборки графа знаний. Подаются в KnowledgeGraph при инициализации. Сейчас редактируются только из .env / кода — runtime UI это backlog (Tier 4)."
        >
          <Info size={11} /> BuilderArguments (defaults)
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3 md:grid-cols-4">
          {Object.entries(builderDefaults).map(([k, v]) => (
            <div
              key={k}
              className="flex cursor-help items-center justify-between gap-2 border-b border-stone-100 py-0.5"
              title={BUILDER_HINTS[k] ?? ''}
            >
              <span className="font-mono text-stone-600">{k}</span>
              <span className="font-mono text-stone-800">{String(v)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-stone-500">
          Эти параметры пробрасываются в RAGU при инициализации KG. Сейчас редактируются
          только из <code className="font-mono">.env</code>; runtime UI — backlog.
        </p>
      </div>
    </details>
  )
}

// ── Help / Onboarding modal ────────────────────────────────────────────

function HelpModal({ onClose }: { onClose: () => void }) {
  // ESC закрывает — стандартный паттерн остальных модалок проекта.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-stone-200 bg-violet-50/40 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-100 text-violet-700">
              <BookOpen size={18} />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                Справка
              </div>
              <div className="text-sm font-semibold text-stone-900">RAGU: введение, workflow и бэклог</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-stone-700">
          {/* Раздел 1 — раньше жил в WhatIsRaguPanel (inline-плашка под шапкой).
              Объединили в этот же модал, чтобы у юзера была одна точка входа. */}
          <Section title="Что такое RAGU + RAGRAF" icon={Sparkles}>
            <p>
              <b>RAGU</b> — движок <i>GraphRAG</i>, который понимает технические тексты:
              приказы, регламенты, СНиПы, ГОСТы. Из произвольного документа он вытаскивает{' '}
              <b>параметры с диапазонами</b>, ищет похожие документы <b>по смыслу запроса</b>{' '}
              (не по совпадению слов) и связывает регламенты в <b>граф знаний</b> — где видно,
              что один параметр живёт в нескольких регламентах разных ведомств.
            </p>
            <p className="mt-2">
              <b>RAGRAF</b> — визуальный редактор и виз-карта поверх этих данных: слайдеры,
              Rule DSL Flow, SHACL-ограничения, версионирование, симулятор исполнения.
            </p>
          </Section>

          <Section title="Что это за экран (RAGU Studio)" icon={Lightbulb}>
            <p>
              Здесь — все <b>18 системных промптов</b> RAGU. Можно переписать любой и
              сохранить как override — RAGU подхватит твой текст на следующем запросе. Это
              работает <b>без форка библиотеки</b> и <b>без перезапуска бэкенда</b>: овверайды
              лежат в DuckDB и применяются через <code className="bg-stone-100 px-1 rounded">RaguGenerativeModule.update_prompt</code>.
            </p>
          </Section>

          <Section title="Когда стоит править промпт" icon={Lightbulb}>
            <ul className="ml-1 list-none space-y-1.5">
              <Bullet>
                <b>Граф пустой / в нём мусор</b> → правь <code className="bg-stone-100 px-1 rounded">artifact_extraction</code>.
                Часто помогает добавить инструкцию вроде «игнорируй типографские артефакты, заголовки страниц».
              </Bullet>
              <Bullet>
                <b>Сводки общин слишком длинные / короткие</b> → правь <code className="bg-stone-100 px-1 rounded">community_report</code>.
                Можно поменять количество findings (по умолчанию 5–10) или попросить акцент на риски.
              </Bullet>
              <Bullet>
                <b>Ответы поиска многословные / в markdown</b> → правь <code className="bg-stone-100 px-1 rounded">global_search</code>{' '}
                / <code className="bg-stone-100 px-1 rounded">local_search</code>. Малые модели (phi3, llama-3.2:3b)
                плохо понимают «не используй списки» — лучше переформулировать инструкцию.
              </Bullet>
              <Bullet>
                <b>NER пропускает важные термины</b> → правь <code className="bg-stone-100 px-1 rounded">artifact_extraction</code>{' '}
                или включи <code className="bg-stone-100 px-1 rounded">artifact_validation</code> (двухстадийный extractor).
              </Bullet>
            </ul>
          </Section>

          <Section title="Workflow за 4 шага" icon={CornerDownRight}>
            <ol className="ml-1 list-decimal space-y-1.5 pl-5">
              <li>
                Слева выбери группу промптов и конкретный — например{' '}
                <code className="bg-stone-100 px-1 rounded">global_search</code>.
              </li>
              <li>
                Прочитай default-шаблон (обрати внимание на <code className="bg-stone-100 px-1 rounded">{`{{ query }}`}</code>{' '}
                и другие Jinja2-переменные — они обязаны остаться, иначе контекст не попадёт в промпт).
              </li>
              <li>
                Перепиши текст в редакторе. Опционально добавь комментарий в поле снизу — пригодится
                через месяц «зачем я это поменял».
              </li>
              <li>
                Жми <b>«Сохранить override»</b> и переходи в Студию аналитика — задай вопрос в чате,
                посмотри как изменился стиль ответа. Не понравилось — <b>«Вернуть default»</b>.
              </li>
            </ol>
          </Section>

          <Section title="На что обращать внимание" icon={AlertTriangle} tone="warning">
            <ul className="ml-1 list-none space-y-1.5">
              <Bullet>
                <b>Pydantic-схема</b> (бейдж рядом с именем) — это формат, в котором RAGU ждёт
                ответ от LLM. Не выкидывай из шаблона требование «return as valid JSON», иначе
                парсер сломается и RAGU молча вернёт пустой результат.
              </Bullet>
              <Bullet>
                <b>Plain string</b> в схеме (например <code className="bg-stone-100 px-1 rounded">str</code> у{' '}
                <code className="bg-stone-100 px-1 rounded">global_search</code>) — можно писать
                свободно, JSON-обёртка не нужна.
              </Bullet>
              <Bullet>
                Все 18 шаблонов на английском — это сознательное решение авторов RAGU
                (английский лучше у малых LLM). При желании можно переводить — переменная{' '}
                <code className="bg-stone-100 px-1 rounded">{`{{ language }}`}</code>{' '}
                всё равно скажет модели «отвечай по-русски».
              </Bullet>
              <Bullet>
                После сохранения <b>не нужно перезапускать backend</b>. Овверайды лежат в DuckDB,
                читаются перед каждым search-вызовом.
              </Bullet>
            </ul>
          </Section>

          <Section title="Что под капотом" icon={Server}>
            <p>
              Овверайды живут в таблице <code className="bg-stone-100 px-1 rounded">ragu_prompt_overrides</code>{' '}
              (DuckDB). При каждом{' '}
              <code className="bg-stone-100 px-1 rounded">/api/search</code> бэкенд:
            </p>
            <ol className="mt-1.5 ml-1 list-decimal space-y-1 pl-5 text-xs">
              <li>Создаёт нужный <code className="bg-stone-100 px-1 rounded">SearchEngine</code> (Local / Global / Naive).</li>
              <li>Применяет твои оверрайды через <code className="bg-stone-100 px-1 rounded">engine.update_prompt(name, …)</code>.</li>
              <li>Запускает <code className="bg-stone-100 px-1 rounded">engine.search(query)</code>.</li>
            </ol>
            <p className="mt-2">
              Это нативный путь RAGU, работающий через <code className="bg-stone-100 px-1 rounded">RaguGenerativeModule.update_prompt</code>{' '}
              — то есть форк библиотеки не нужен.
            </p>
          </Section>

          {/* Раздел про будущие RAGU-сценарии — раньше открывался отдельной
              кнопкой «Бэклог демо», теперь живёт здесь как краткий список с
              ссылкой на полную страницу /sandbox/backlog. Полный контент со
              сложностью и RAGU-фичами — там; здесь — навигация. */}
          <Section title="Будущие сценарии (бэклог)" icon={Lightbulb}>
            <p className="mb-2 text-stone-600">
              Идеи следующих RAGU-демо. Реализуем когда станет ясно, что именно нужно
              аналитику или заказчику.
            </p>
            <ul className="ml-1 list-none space-y-1.5">
              <Bullet>
                <b>Knowledge Graph всех регламентов</b> — Cytoscape-карта с общими параметрами
                между регламентами. <i>GlobalSearchEngine + community detection.</i>
              </Bullet>
              <Bullet>
                <b>Сравнение двух регламентов</b> — RAGU подсвечивает общие / противоречащие
                параметры. <i>Embedding similarity, cross-query.</i>
              </Bullet>
              <Bullet>
                <b>Авто-классификация домена</b> — при создании регламента RAGU предсказывает
                domain через embeddings и центроиды. <i>Embedder + cosine.</i>
              </Bullet>
              <Bullet>
                <b>Q&A над регламентом</b> — панель «Спроси у RAGU» прямо на странице
                регламента. <i>LocalSearchEngine + QueryPlanEngine.</i>
              </Bullet>
            </ul>
            <div className="mt-3">
              <Link
                to="/sandbox/backlog"
                onClick={onClose}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-violet-700 underline-offset-2 hover:underline"
              >
                Открыть полную страницу бэклога →
              </Link>
            </div>
          </Section>
        </div>

        <footer className="border-t border-stone-200 bg-stone-50/60 px-5 py-3 text-right">
          <Button variant="primary" size="sm" onClick={onClose}>
            Понял, поехали
          </Button>
        </footer>
      </div>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string
  icon: typeof Sparkles
  tone?: 'warning'
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-md border px-4 py-3',
        tone === 'warning' ? 'border-amber-200 bg-amber-50/50' : 'border-stone-200 bg-white',
      )}
    >
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-700">
        <Icon size={13} className={tone === 'warning' ? 'text-amber-600' : 'text-violet-600'} />
        {title}
      </h3>
      <div className="text-[13px] leading-relaxed text-stone-700">{children}</div>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-violet-400" />
      <span>{children}</span>
    </li>
  )
}

function ConfigItem({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div
      className={cn('rounded border border-stone-100 bg-stone-50/60 px-2 py-1.5', hint && 'cursor-help')}
      title={hint}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
        {hint && <Info size={9} className="text-stone-400" />}
      </div>
      <div
        className={cn(
          'mt-0.5 truncate text-xs text-stone-800',
          mono && 'font-mono text-[11px]',
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
