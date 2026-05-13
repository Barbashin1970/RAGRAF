import { Link } from 'react-router-dom'
import { ChevronRight, ListTree, type LucideIcon } from 'lucide-react'
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
  active: 'flow' | 'constraints' | 'graph'
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
        <nav className="flex flex-wrap items-center gap-1 text-xs text-stone-500">
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

        {/* Title row */}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', v.iconBg)}>
              <Icon size={20} className={v.iconFg} />
            </div>
            <div className="min-w-0">
              <h1 className="line-clamp-2 text-base font-semibold leading-snug text-stone-900">
                {isLoading ? 'Загрузка…' : (regulation?.name ?? sourceId)}
              </h1>
              {regulation?.date && (
                <div className="mt-0.5 text-xs text-stone-500">
                  Дата принятия: {regulation.date} · версия {regulation.version}
                </div>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {actions}
            </div>
          )}
        </div>

        {/* Stats row + tab nav */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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
  active: 'flow' | 'constraints' | 'graph'
  domain: string | null | undefined
}) {
  const tabs: Array<{ id: 'flow' | 'constraints' | 'graph'; label: string; to: string }> = [
    { id: 'flow',        label: 'Поток',       to: `/regulations/${sourceId}/flow` },
    { id: 'constraints', label: 'Ограничения', to: `/regulations/${sourceId}/constraints` },
    { id: 'graph',       label: 'Граф',        to: domain ? `/graph?domain=${domain}` : '/graph' },
  ]
  const v = getDomainVisual(domain)

  return (
    <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
      {tabs.map((t) => (
        <Link
          key={t.id}
          to={t.to}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition',
            t.id === active
              ? cn(v.chipBg, v.chipFg)
              : 'text-stone-600 hover:bg-stone-50',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
