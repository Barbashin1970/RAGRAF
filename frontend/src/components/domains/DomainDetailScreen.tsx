import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Network,
  Pause,
  Pencil,
  Plug,
  Radar,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { DOMAIN_ICONS_BY_ID, buildUserDomainVisual, getDomainVisual } from '@/lib/domains'
import { cn } from '@/lib/cn'

/**
 * Сводный экран домена: показывает три секции — регламенты, модули-источники,
 * датчики (подтипы, привязанные к модулям домена). Закрывает обратный поиск
 * «домен → его компоненты», нужный методологу и архитектору для оценки
 * покрытия и подготовки к интеграции с ядром СИГМА.
 *
 * Маршрут: /domains/:id
 */

const STATUS_BADGE: Record<
  string,
  { label: string; cls: string; icon: LucideIcon }
> = {
  draft: { label: 'Черновик', cls: 'bg-stone-100 text-stone-700 border-stone-200', icon: Clock },
  piloting: { label: 'Пилот', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Settings },
  production: {
    label: 'Промышленная эксплуатация',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: CheckCircle2,
  },
  deprecated: { label: 'Снят с поддержки', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: Pause },
}

export function DomainDetailScreen() {
  const { id = '' } = useParams<{ id: string }>()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['domain-overview', id],
    queryFn: () => api.domains.overview(id),
    enabled: id.length > 0,
  })

  const visual = useMemo(() => {
    if (!data?.domain) return getDomainVisual(id)
    if (data.domain.icon || data.domain.color)
      return buildUserDomainVisual(data.domain.icon ?? null, data.domain.color ?? null)
    return getDomainVisual(id)
  }, [data?.domain, id])

  if (isLoading) {
    return <div className="p-6 text-sm text-stone-500">Загрузка домена…</div>
  }
  if (isError) {
    return (
      <div className="p-6 text-sm text-rose-700">
        Не удалось загрузить домен: {(error as Error).message}
      </div>
    )
  }
  if (!data) return null

  const DomainIcon = visual.icon
  const label = data.domain?.label || id
  const hint = data.domain?.hint || ''

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Link to="/regulations" className="text-stone-400 hover:text-stone-700">
            <ArrowLeft size={16} />
          </Link>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', visual.iconBg)}>
            <DomainIcon className={cn('h-5 w-5', visual.iconFg)} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-stone-900">{label}</h1>
            {hint && <p className="truncate text-xs text-stone-500">{hint}</p>}
          </div>
          <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px]', visual.chipBg, visual.chipFg)}>
            {id}
          </span>
        </div>

        {/* Coverage row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <CoverageBadge
            label="Регламентов"
            value={data.coverage.regulations_count}
            icon={FileText}
            tone="primary"
          />
          <CoverageBadge
            label="Модулей-источников"
            value={data.coverage.modules_count}
            icon={Plug}
            tone="blue"
          />
          <CoverageBadge
            label="Подключённых датчиков"
            value={data.coverage.sensor_subtypes_count}
            icon={Radar}
            tone="violet"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Регламенты */}
        <Section
          title="Регламенты"
          empty="В этом домене пока нет регламентов"
          count={data.regulations.length}
          right={
            <Link
              to="/regulations/new-from-text"
              state={{ domain: id }}
              className="text-xs text-blue-700 hover:underline"
            >
              + новый регламент
            </Link>
          }
        >
          {data.regulations.map((r) => {
            const reg = r as {
              id: string
              name: string
              parameters_count?: number
              recommendations_count?: number
              priority?: number | null
              valid_to?: string | null
            }
            return (
              <Link
                key={reg.id}
                to={`/regulations/${encodeURIComponent(reg.id)}/edit`}
                className="block rounded-md border border-stone-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900">{reg.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{reg.id}</div>
                  </div>
                  <Pencil size={14} className="shrink-0 text-stone-400" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
                  {typeof reg.parameters_count === 'number' && (
                    <span>{reg.parameters_count} параметров</span>
                  )}
                  {typeof reg.recommendations_count === 'number' && reg.recommendations_count > 0 && (
                    <span>· {reg.recommendations_count} рекомендация</span>
                  )}
                  {reg.priority != null && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                      приоритет L{reg.priority}
                    </span>
                  )}
                  {reg.valid_to && (
                    <span className="text-stone-500">до {reg.valid_to}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </Section>

        {/* Модули */}
        <Section
          title="Модули-источники"
          empty="Нет подключённых модулей. Создайте паспорт модуля и укажите этот домен."
          count={data.modules.length}
          right={
            <Link to="/modules" className="text-xs text-blue-700 hover:underline">
              библиотека модулей →
            </Link>
          }
        >
          {data.modules.map((m) => {
            const mod = m as {
              id: string
              name: string
              status?: string
              owner?: string | null
              icon?: string | null
              color?: string | null
              event_types?: string[]
              sensor_count?: number
            }
            const mv = mod.icon || mod.color
              ? buildUserDomainVisual(mod.icon ?? null, mod.color ?? null)
              : getDomainVisual(id)
            const Icon = (mod.icon && DOMAIN_ICONS_BY_ID[mod.icon]) || mv.icon
            const status = STATUS_BADGE[mod.status || 'draft'] || STATUS_BADGE.draft
            return (
              <Link
                key={mod.id}
                to="/modules"
                className="block rounded-md border border-stone-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', mv.iconBg)}>
                    <Icon className={cn('h-5 w-5', mv.iconFg)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-stone-900">{mod.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{mod.id}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
                          status.cls,
                        )}
                      >
                        <status.icon size={10} /> {status.label}
                      </span>
                      {mod.owner && (
                        <span className="text-[11px] text-stone-500">{mod.owner}</span>
                      )}
                      {(mod.event_types?.length ?? 0) > 0 && (
                        <span className="text-[10px] text-stone-500">
                          {mod.event_types?.length} типов событий
                        </span>
                      )}
                      {(mod.sensor_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] text-stone-700">
                          <Network size={10} /> {mod.sensor_count} датч.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </Section>

        {/* Датчики */}
        <Section
          title="Подключённые датчики"
          empty="Нет подтипов датчиков, связанных с модулями этого домена. Привяжите module_id в библиотеке датчиков."
          count={data.sensor_subtypes.length}
          right={
            <Link to="/sensors" className="text-xs text-blue-700 hover:underline">
              библиотека датчиков →
            </Link>
          }
        >
          {data.sensor_subtypes.length > 0 && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.sensor_subtypes.map((s) => (
                <div
                  key={s.subtype_id}
                  className="rounded-md border border-stone-200 bg-white p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-stone-900">{s.label}</div>
                      <div className="truncate font-mono text-[10px] text-stone-500">
                        {s.class_id} · {s.subtype_id}
                      </div>
                    </div>
                    <Radar size={12} className="shrink-0 text-violet-600" />
                  </div>
                  {s.description && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-stone-600">{s.description}</p>
                  )}
                  {s.module_id && (
                    <div className="mt-1.5 font-mono text-[10px] text-stone-500">
                      ← {s.module_id}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Подсказка по покрытию для архитектора */}
        <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 text-xs text-stone-700">
          <p className="font-medium text-blue-900">Что это даёт</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              <b>Аналитику:</b> при создании регламента видеть какие модули уже подключены и какие
              события они производят — можно сразу строить триггеры из готового набора.
            </li>
            <li>
              <b>Методологу:</b> закрытие 1:1 «регламент ↔ источник» — какие регламенты домена
              остались без подключённого источника событий.
            </li>
            <li>
              <b>Архитектору:</b> готовность к интеграции с ядром СИГМА — закрыт ли домен и
              регламентом, и модулем, и датчиком.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  count,
  empty,
  right,
  children,
}: {
  title: string
  count: number
  empty: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
          {title} <span className="ml-1 text-stone-400">· {count}</span>
        </h2>
        {right}
      </div>
      {count === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-white p-4 text-center text-xs text-stone-500">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  )
}

function CoverageBadge({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: LucideIcon
  tone: 'primary' | 'blue' | 'violet'
}) {
  const toneCls =
    tone === 'primary'
      ? 'bg-primary/10 text-primary border-primary/30'
      : tone === 'blue'
        ? 'bg-blue-50 text-blue-800 border-blue-200'
        : 'bg-violet-50 text-violet-800 border-violet-200'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
        toneCls,
      )}
    >
      <Icon size={12} />
      <span>
        <b className="tabular-nums">{value}</b> {label}
      </span>
    </span>
  )
}
