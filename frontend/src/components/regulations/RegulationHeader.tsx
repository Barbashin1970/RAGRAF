import { Link } from 'react-router-dom'
import { ChevronRight, ListTree, Pencil, type LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api, type Domain, type Regulation } from '@/lib/api'
import { cn } from '@/lib/cn'
import { FALLBACK_VISUAL, getDomainVisual } from '@/lib/domains'

interface Stat {
  icon: LucideIcon
  value: number | string
  label: string
}

interface Props {
  /** Текущий регламент (для domain + name) */
  regulation: Regulation | undefined
  /** Загружается ли регламент */
  isLoading?: boolean
  /** ID источника — показываем как чип */
  sourceId: string
  /** Активная вкладка для подсветки в локальной мини-навигации */
  active: 'edit' | 'flow' | 'constraints' | 'graph'
  /** Live-счётчики, специфичные для экрана (узлы потока / строки таблицы / …) */
  stats?: Stat[]
  /** Кнопки действий справа в шапке */
  actions?: React.ReactNode
  /** Опциональная под-шапка (баннер ошибок валидации, статус и т.п.) */
  subHeader?: React.ReactNode
}

/**
 * Унифицированный header для детальных страниц регламента.
 * Включает breadcrumb, domain-визуал с акцентным цветом, мини-навигацию между
 * экранами (поток / ограничения / граф) и слот для action-кнопок.
 *
 * Используется одинаково в FlowEditorScreen и ConstraintEditorScreen — это
 * гарантирует одинаковое визуальное качество и снимает риск «провала» при
 * переходе с главной.
 */
export function RegulationHeader({
  regulation,
  isLoading,
  sourceId,
  active,
  stats,
  actions,
  subHeader,
}: Props) {
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  const domain = regulation?.domain ?? null
  const v = getDomainVisual(domain)
  const Icon = v.icon
  const domainMeta: Domain | undefined = domains.find((d) => d.id === domain)

  return (
    <div className={cn('border-b border-stone-200 bg-white', v.sectionBg)}>
      {/* Accent strip — top border in domain color */}
      <div className={cn('h-1 w-full', v.accent)} />

      <div className="px-5 pb-3 pt-3">
        {/* Breadcrumb */}
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-stone-500">
          <Link to="/regulations" className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-stone-100 hover:text-stone-700">
            <ListTree size={11} /> Регламенты
          </Link>
          {domainMeta && (
            <>
              <ChevronRight size={11} className="text-stone-300" />
              <Link
                to={`/regulations#${domainMeta.id}`}
                className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium', v.chipBg, v.chipFg)}
              >
                <Icon size={11} />
                {domainMeta.label}
              </Link>
            </>
          )}
          <ChevronRight size={11} className="text-stone-300" />
          <span className="font-mono text-[10px] text-stone-500">{sourceId}</span>
        </nav>

        {/* Two-panel layout: title (grows) | controls (fixed).
            На широких экранах title и actions — две отдельные «коробки», между
            ними не происходит вертикального конфликта. На <lg> стекаются —
            это естественный fallback на узких экранах. */}
        <div
          className={cn(
            'grid items-stretch gap-3',
            actions ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
          )}
        >
          {/* Left panel — Title */}
          <div className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  v.iconBg,
                )}
              >
                <Icon size={20} className={v.iconFg} />
              </div>
              <div className="min-w-0">
                <h1 className="line-clamp-2 break-words text-base font-semibold leading-snug text-stone-900">
                  {isLoading ? 'Загрузка…' : (regulation?.name ?? sourceId)}
                </h1>
                {regulation?.date && (
                  <div className="mt-0.5 text-xs text-stone-500">
                    Дата принятия: {regulation.date} · версия {regulation.version}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right panel — Controls */}
          {actions && (
            <div className="flex items-center rounded-lg border border-stone-200 bg-white px-2.5 py-2 shadow-sm">
              <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
                {actions}
              </div>
            </div>
          )}
        </div>

        {/* Stats + tabs row.
            Допускаем wrap здесь — это второстепенная информация, может
            опуститься ниже без потери смысла. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {stats && stats.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
              {stats.map((s) => {
                const SIcon = s.icon
                return (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1"
                  >
                    <SIcon size={11} className="text-stone-400" />
                    <span className="font-semibold tabular-nums text-stone-800">{s.value}</span>
                    <span className="text-stone-500">{s.label}</span>
                  </span>
                )
              })}
            </div>
          )}

          <TabSwitcher sourceId={sourceId} active={active} domain={domain} />
        </div>
      </div>

      {subHeader}
    </div>
  )
}

function TabSwitcher({
  sourceId,
  active,
  domain,
}: {
  sourceId: string
  active: 'edit' | 'flow' | 'constraints' | 'graph'
  domain: string | null | undefined
}) {
  type TabId = 'edit' | 'flow' | 'constraints' | 'graph'
  const tabs: Array<{ id: TabId; label: string; to: string; icon?: LucideIcon }> = [
    { id: 'edit',        label: 'Редактировать', to: `/regulations/${sourceId}/edit`,        icon: Pencil },
    { id: 'flow',        label: 'Поток',         to: `/regulations/${sourceId}/flow` },
    { id: 'constraints', label: 'Ограничения',   to: `/regulations/${sourceId}/constraints` },
    { id: 'graph',       label: 'Граф',          to: domain ? `/graph?domain=${domain}` : '/graph' },
  ]
  const v = getDomainVisual(domain)

  return (
    <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
      {tabs.map((t) => {
        const TIcon = t.icon
        return (
          <Link
            key={t.id}
            to={t.to}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition',
              t.id === active
                ? cn(v.chipBg, v.chipFg)
                : 'text-stone-600 hover:bg-stone-50',
            )}
          >
            {TIcon && <TIcon size={11} />}
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
