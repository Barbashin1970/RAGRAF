import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  Boxes,
  Building2,
  ChevronRight,
  FileText,
  Flame,
  Leaf,
  Loader2,
  type LucideIcon,
  Network,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  Sliders,
  Workflow,
} from 'lucide-react'
import { api, type Domain } from '@/lib/api'
import { cn } from '@/lib/cn'

interface RegRow {
  id: string
  name: string
  domain: string | null
  parameters_count?: number
  constraints_count?: number
  recommendations_count?: number
}

interface DomainVisual {
  icon: LucideIcon
  /** background of the icon chip */
  iconBg: string
  iconFg: string
  /** left accent stripe on the card */
  accent: string
  /** chip with count */
  chipBg: string
  chipFg: string
  /** subtle border for the card */
  cardBorder: string
}

const DOMAIN_VISUALS: Record<string, DomainVisual> = {
  heating: {
    icon: Flame,
    iconBg: 'bg-orange-100',
    iconFg: 'text-orange-700',
    accent: 'bg-orange-500',
    chipBg: 'bg-orange-50',
    chipFg: 'text-orange-700',
    cardBorder: 'border-orange-100 hover:border-orange-300',
  },
  housing: {
    icon: Building2,
    iconBg: 'bg-blue-100',
    iconFg: 'text-blue-700',
    accent: 'bg-blue-500',
    chipBg: 'bg-blue-50',
    chipFg: 'text-blue-700',
    cardBorder: 'border-blue-100 hover:border-blue-300',
  },
  safety: {
    icon: ShieldAlert,
    iconBg: 'bg-rose-100',
    iconFg: 'text-rose-700',
    accent: 'bg-rose-500',
    chipBg: 'bg-rose-50',
    chipFg: 'text-rose-700',
    cardBorder: 'border-rose-100 hover:border-rose-300',
  },
  environment: {
    icon: Leaf,
    iconBg: 'bg-emerald-100',
    iconFg: 'text-emerald-700',
    accent: 'bg-emerald-500',
    chipBg: 'bg-emerald-50',
    chipFg: 'text-emerald-700',
    cardBorder: 'border-emerald-100 hover:border-emerald-300',
  },
}

const FALLBACK_VISUAL: DomainVisual = {
  icon: Settings2,
  iconBg: 'bg-stone-100',
  iconFg: 'text-stone-700',
  accent: 'bg-stone-400',
  chipBg: 'bg-stone-50',
  chipFg: 'text-stone-700',
  cardBorder: 'border-stone-200 hover:border-stone-300',
}

function extractRow(d: unknown): RegRow | null {
  if (typeof d === 'string') return { id: d, name: d, domain: null }
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>
    const id = (o.id ?? o.source_id ?? o.dataset_id ?? o.uuid) as string | undefined
    if (typeof id !== 'string') return null
    const name = typeof o.name === 'string' ? o.name : id
    const domain = typeof o.domain === 'string' ? o.domain : null
    return {
      id,
      name,
      domain,
      parameters_count: typeof o.parameters_count === 'number' ? o.parameters_count : undefined,
      constraints_count: typeof o.constraints_count === 'number' ? o.constraints_count : undefined,
      recommendations_count: typeof o.recommendations_count === 'number' ? o.recommendations_count : undefined,
    }
  }
  return null
}

export function RegulationList() {
  const [query, setQuery] = useState('')
  const { data: rawDatasets, isLoading, error } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  const items: RegRow[] = useMemo(() => {
    if (!rawDatasets) return []
    const arr = Array.isArray(rawDatasets)
      ? rawDatasets
      : Array.isArray((rawDatasets as any).items) ? (rawDatasets as any).items : []
    return arr.map(extractRow).filter(Boolean) as RegRow[]
  }, [rawDatasets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((r) =>
      r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    )
  }, [items, query])

  const byDomain = useMemo(() => {
    const m = new Map<string | null, RegRow[]>()
    for (const it of filtered) {
      const key = it.domain ?? null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(it)
    }
    return m
  }, [filtered])

  const orderedKeys: Array<string | null> = useMemo(() => {
    const known = domains.map((d) => d.id)
    const others = Array.from(byDomain.keys()).filter(
      (k) => k && !known.includes(k as string),
    ) as string[]
    return [...known, ...others, null].filter((k, i, a) => a.indexOf(k) === i)
  }, [domains, byDomain])

  const totals = useMemo(() => {
    return items.reduce(
      (acc, r) => {
        acc.regs += 1
        acc.params += r.parameters_count ?? 0
        acc.constraints += r.constraints_count ?? 0
        return acc
      },
      { regs: 0, params: 0, constraints: 0 },
    )
  }, [items])

  return (
    <div className="flex h-full flex-col bg-stone-50">
      {/* Page header */}
      <div className="border-b border-stone-200 bg-white px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Регламенты</h1>
            <p className="mt-1 text-sm text-stone-500">
              Карта регламентов по доменам — правила, ограничения SHACL и потоки реагирования
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Stat icon={FileText}   value={totals.regs}        label="регламентов" tone="primary" />
            <Stat icon={Boxes}      value={domains.length}     label="доменов"     tone="indigo"  />
            <Stat icon={Sliders}    value={totals.params}      label="параметров"  tone="emerald" />
            <Stat icon={Shield}     value={totals.constraints} label="ограничений" tone="amber"   />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию или ID источника…"
              className="w-full rounded-md border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-stone-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="hidden text-xs text-stone-400 sm:block">
            источник: <span className="font-mono">upstream /admin/datasets</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader2 size={14} className="animate-spin" /> Загрузка регламентов…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle size={14} className="mt-0.5" />
            <div>
              Не удалось загрузить список: <span className="font-mono">{(error as Error).message}</span>
            </div>
          </div>
        )}

        {!isLoading && items.length === 0 && !error && (
          <EmptyState />
        )}

        {!isLoading && items.length > 0 && filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-500">
            По запросу «<b>{query}</b>» ничего не найдено.
          </div>
        )}

        {orderedKeys.map((key) => {
          const group = byDomain.get(key)
          if (!group || group.length === 0) return null
          return (
            <DomainSection
              key={key ?? '_undef'}
              domain={domains.find((d) => d.id === key) ?? null}
              fallbackKey={key}
              items={group}
            />
          )
        })}
      </div>
    </div>
  )
}

function DomainSection({
  domain,
  fallbackKey,
  items,
}: {
  domain: Domain | null
  fallbackKey: string | null
  items: RegRow[]
}) {
  const v = (domain?.id && DOMAIN_VISUALS[domain.id]) || FALLBACK_VISUAL
  const Icon = v.icon
  const label = domain?.label ?? (fallbackKey ?? 'Без домена')

  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center gap-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', v.iconBg)}>
          <Icon size={18} className={v.iconFg} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-800">{label}</h2>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', v.chipBg, v.chipFg)}>
              {items.length}
            </span>
          </div>
          {domain?.hint && (
            <div className="mt-0.5 text-xs text-stone-500">{domain.hint}</div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2">
        {items.map((r) => (
          <RegulationCard key={r.id} reg={r} visual={v} />
        ))}
      </div>
    </section>
  )
}

function RegulationCard({ reg, visual }: { reg: RegRow; visual: DomainVisual }) {
  return (
    <article
      className={cn(
        'group relative flex items-stretch overflow-hidden rounded-lg border bg-white transition',
        visual.cardBorder,
        'hover:shadow-md hover:shadow-stone-200/40',
      )}
    >
      {/* Domain accent stripe */}
      <div className={cn('w-1 shrink-0', visual.accent)} />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <Link
              to={`/regulations/${reg.id}/flow`}
              className="line-clamp-2 font-medium leading-snug text-stone-900 transition hover:text-primary"
              title={reg.name}
            >
              {reg.name}
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
              {reg.id}
            </code>
            {reg.parameters_count !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Sliders size={11} className="text-stone-400" />
                {reg.parameters_count} параметров
              </span>
            )}
            {reg.constraints_count !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Shield size={11} className="text-stone-400" />
                {reg.constraints_count} ограничений
              </span>
            )}
            {!!reg.recommendations_count && reg.recommendations_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <AlertCircle size={11} className="text-stone-400" />
                {reg.recommendations_count} рекомендации
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ActionButton
            to={`/regulations/${reg.id}/flow`}
            icon={Workflow}
            label="Поток"
            colorClasses="border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
            iconColor="text-blue-500"
          />
          <ActionButton
            to={`/regulations/${reg.id}/constraints`}
            icon={Shield}
            label="Ограничения"
            colorClasses="border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100"
            iconColor="text-amber-500"
          />
          <ActionButton
            to={reg.domain ? `/graph?domain=${reg.domain}` : '/graph'}
            icon={Network}
            label="Граф"
            colorClasses="border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
            iconColor="text-emerald-500"
          />
          <Link
            to={`/regulations/${reg.id}/flow`}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 sm:inline-flex"
            title="Открыть редактор потока"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  )
}

function ActionButton({
  to,
  icon: Icon,
  label,
  colorClasses,
  iconColor,
}: {
  to: string
  icon: LucideIcon
  label: string
  colorClasses: string
  iconColor: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
        colorClasses,
      )}
    >
      <Icon size={13} className={iconColor} />
      {label}
    </Link>
  )
}

const STAT_TONES: Record<string, { bg: string; fg: string; icon: string }> = {
  primary: { bg: 'bg-primary/10',    fg: 'text-primary',     icon: 'text-primary' },
  indigo:  { bg: 'bg-indigo-50',     fg: 'text-indigo-700',  icon: 'text-indigo-500' },
  emerald: { bg: 'bg-emerald-50',    fg: 'text-emerald-700', icon: 'text-emerald-500' },
  amber:   { bg: 'bg-amber-50',      fg: 'text-amber-700',   icon: 'text-amber-500' },
}

function Stat({
  icon: Icon,
  value,
  label,
  tone = 'primary',
}: {
  icon: LucideIcon
  value: number
  label: string
  tone?: keyof typeof STAT_TONES
}) {
  const t = STAT_TONES[tone] ?? STAT_TONES.primary
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-md px-2.5 py-1', t.bg)}>
      <Icon size={14} className={t.icon} />
      <span className={cn('font-semibold tabular-nums', t.fg)}>{value}</span>
      <span className="text-xs text-stone-500">{label}</span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
        <FileText size={20} className="text-stone-400" />
      </div>
      <h3 className="text-base font-medium text-stone-800">Нет регламентов</h3>
      <p className="mt-1 text-sm text-stone-500">
        Создайте dataset через upstream API:
      </p>
      <code className="mt-2 inline-block rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">
        POST /api/v1/regulations/admin/datasets/&#123;app_id&#125;
      </code>
      <Link
        to="/graph"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:opacity-90"
      >
        <Activity size={14} /> Перейти к графу
      </Link>
    </div>
  )
}
