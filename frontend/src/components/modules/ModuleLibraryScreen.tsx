import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Clock,
  Mail,
  Network,
  Pause,
  Pencil,
  Plug,
  Plus,
  Settings,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { DOMAIN_ICONS_BY_ID, buildUserDomainVisual, getDomainVisual } from '@/lib/domains'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { ModuleEditorDialog, type ModuleDraft } from './ModuleEditorDialog'

interface ModuleData {
  id: string
  name: string
  purpose?: string
  owner?: string | null
  domain?: string | null
  status?: string
  version?: string
  icon?: string | null
  color?: string | null
  api_contract?: {
    channel?: string
    url?: string | null
    auth_type?: string
    event_format?: string
    rate_limit?: string | null
    notes?: string | null
  }
  quality_rules?: {
    completeness?: string | null
    max_latency_seconds?: number | null
    max_error_rate_percent?: number | null
    deduplication?: boolean
  }
  event_types?: string[]
  contact_email?: string | null
  documentation_url?: string | null
  notes?: string | null
  sensor_count?: number
}

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
  draft: { label: 'Черновик', cls: 'bg-stone-100 text-stone-700 border-stone-200', icon: Clock },
  piloting: { label: 'Пилот', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Settings },
  production: { label: 'Промышленная эксплуатация', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: CheckCircle2 },
  deprecated: { label: 'Снят с поддержки', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: Pause },
}

const CHANNEL_LABEL: Record<string, string> = {
  rest: 'REST API',
  webhook: 'Webhook',
  queue: 'Очередь сообщений',
  file_drop: 'Файловый обмен',
  other: 'Иной канал',
}

export function ModuleLibraryScreen() {
  const { data: modules, isLoading } = useQuery({
    queryKey: ['modules'],
    queryFn: () => api.modules.list() as unknown as Promise<ModuleData[]>,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [editor, setEditor] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; initial: Partial<ModuleDraft> & { id: string } }
  >({ open: false })

  const filtered = useMemo(() => {
    if (!modules) return []
    return modules.filter((m) =>
      (!domainFilter || m.domain === domainFilter) &&
      (!statusFilter || m.status === statusFilter),
    )
  }, [modules, domainFilter, statusFilter])

  const domains = useMemo(() => {
    if (!modules) return []
    return Array.from(new Set(modules.map((m) => m.domain).filter(Boolean) as string[]))
  }, [modules])

  const selected = useMemo(
    () => modules?.find((m) => m.id === selectedId) ?? null,
    [modules, selectedId],
  )

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Plug size={18} className="text-blue-600" />
          <h1 className="text-base font-semibold text-stone-900">Прикладные модули</h1>
          <span className="text-xs text-stone-500">
            СИГМА § 7 — паспорта подключаемых модулей-источников событий
          </span>
          <div className="ml-auto">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setEditor({ open: true, mode: 'create' })}
            >
              Создать модуль
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-stone-500">Домен:</span>
          <FilterChip
            active={!domainFilter}
            onClick={() => setDomainFilter(null)}
            label="все"
          />
          {domains.map((d) => (
            <FilterChip
              key={d}
              active={domainFilter === d}
              onClick={() => setDomainFilter(d)}
              label={d}
            />
          ))}
          <span className="ml-3 text-stone-500">Статус:</span>
          <FilterChip
            active={!statusFilter}
            onClick={() => setStatusFilter(null)}
            label="все"
          />
          {(['draft', 'piloting', 'production', 'deprecated'] as const).map((s) => (
            <FilterChip
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={STATUS_BADGE[s].label.toLowerCase()}
            />
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading && <div className="text-sm text-stone-500">Загрузка модулей…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
              Нет модулей по выбранным фильтрам.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => (
              <ModuleCard
                key={m.id}
                module={m}
                selected={selectedId === m.id}
                onClick={() => setSelectedId(m.id)}
              />
            ))}
          </div>
        </div>
        {selected && (
          <ModuleDetailPanel
            module={selected}
            onClose={() => setSelectedId(null)}
            onEdit={() =>
              setEditor({
                open: true,
                mode: 'edit',
                initial: selected as unknown as Partial<ModuleDraft> & { id: string },
              })
            }
          />
        )}
      </div>
      <ModuleEditorDialog
        open={editor.open}
        mode={editor.open ? editor.mode : 'create'}
        initial={editor.open && editor.mode === 'edit' ? editor.initial : undefined}
        onClose={() => setEditor({ open: false })}
        onSaved={(m) => {
          // После save сразу подсветим карточку, если открыт detail.
          setSelectedId(m.id)
        }}
      />
    </div>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition',
        active
          ? 'border-blue-300 bg-blue-50 text-blue-800'
          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
      )}
    >
      {label}
    </button>
  )
}

function visualFor(m: ModuleData) {
  if (m.icon || m.color) return buildUserDomainVisual(m.icon ?? null, m.color ?? null)
  return getDomainVisual(m.domain ?? null)
}

function ModuleCard({ module, selected, onClick }: { module: ModuleData; selected: boolean; onClick: () => void }) {
  const v = visualFor(module)
  const Icon = (module.icon && DOMAIN_ICONS_BY_ID[module.icon]) || v.icon
  const status = STATUS_BADGE[module.status || 'draft'] || STATUS_BADGE.draft
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border bg-white p-3 text-left transition shadow-sm hover:shadow-md',
        selected ? 'border-blue-400 ring-2 ring-blue-200' : v.cardBorder,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', v.iconBg)}>
          <Icon className={cn('h-5 w-5', v.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-stone-900">{module.name}</h3>
          </div>
          <p className="mt-0.5 text-[11px] font-mono text-stone-500">{module.id}</p>
          {module.purpose && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-stone-700">{module.purpose}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]', status.cls)}>
              <status.icon size={10} /> {status.label}
            </span>
            {module.domain && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px]', v.chipBg, v.chipFg)}>
                {module.domain}
              </span>
            )}
            {(module.sensor_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] text-stone-700">
                <Network size={10} /> {module.sensor_count} датч.
              </span>
            )}
            {(module.event_types?.length ?? 0) > 0 && (
              <span className="text-[10px] text-stone-500">
                {module.event_types?.length ?? 0} типов событий
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function ModuleDetailPanel({
  module,
  onClose,
  onEdit,
}: {
  module: ModuleData
  onClose: () => void
  onEdit: () => void
}) {
  const v = visualFor(module)
  const Icon = (module.icon && DOMAIN_ICONS_BY_ID[module.icon]) || v.icon
  const status = STATUS_BADGE[module.status || 'draft'] || STATUS_BADGE.draft
  return (
    <aside className="w-96 shrink-0 overflow-y-auto border-l border-stone-200 bg-white">
      <header className="border-b border-stone-200 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-md', v.iconBg)}>
            <Icon className={cn('h-6 w-6', v.iconFg)} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-stone-900">{module.name}</h2>
            <p className="mt-0.5 text-[11px] font-mono text-stone-500">{module.id} · v{module.version || '—'}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]', status.cls)}>
                <status.icon size={10} /> {status.label}
              </span>
              {module.domain && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10px]', v.chipBg, v.chipFg)}>
                  {module.domain}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
              <XCircle size={14} />
            </button>
            <Button variant="secondary" size="sm" icon={<Pencil size={12} />} onClick={onEdit}>
              Изменить
            </Button>
          </div>
        </div>
      </header>
      <div className="space-y-3 px-4 py-3 text-xs leading-snug">
        {module.purpose && <Section title="Назначение">{module.purpose}</Section>}
        {module.owner && (
          <Section title="Владелец">
            <span className="font-medium text-stone-800">{module.owner}</span>
          </Section>
        )}
        {(module.contact_email || module.documentation_url) && (
          <Section title="Контакты">
            <div className="space-y-1">
              {module.contact_email && (
                <a
                  href={`mailto:${module.contact_email}`}
                  className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                >
                  <Mail size={11} /> {module.contact_email}
                </a>
              )}
              {module.documentation_url && (
                <a
                  href={module.documentation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-blue-700 hover:underline"
                >
                  Документация →
                </a>
              )}
            </div>
          </Section>
        )}

        <Section title="Контракт интеграции">
          <Field label="Канал" value={CHANNEL_LABEL[module.api_contract?.channel || 'rest'] || module.api_contract?.channel} />
          <Field label="Формат" value={module.api_contract?.event_format} />
          <Field label="Авторизация" value={module.api_contract?.auth_type} />
          {module.api_contract?.url && <Field label="URL" value={module.api_contract.url} mono />}
          {module.api_contract?.rate_limit && (
            <Field label="Rate limit" value={module.api_contract.rate_limit} />
          )}
          {module.api_contract?.notes && (
            <Field label="Заметки" value={module.api_contract.notes} multiline />
          )}
        </Section>

        <Section title="Качество данных">
          <Field label="Полнота" value={module.quality_rules?.completeness} />
          <Field
            label="Макс. задержка"
            value={module.quality_rules?.max_latency_seconds != null ? `${module.quality_rules.max_latency_seconds} сек` : undefined}
          />
          <Field
            label="Макс. ошибок"
            value={module.quality_rules?.max_error_rate_percent != null ? `${module.quality_rules.max_error_rate_percent} %` : undefined}
          />
          <Field
            label="Дедуп"
            value={module.quality_rules?.deduplication == null ? undefined : (module.quality_rules.deduplication ? 'да' : 'нет')}
          />
        </Section>

        {(module.event_types?.length ?? 0) > 0 && (
          <Section title="Типы событий">
            <ul className="space-y-1">
              {module.event_types?.map((t) => (
                <li key={t} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 font-mono text-[11px] text-stone-800">
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {module.notes && (
          <Section title="Заметки / ограничения">
            <p className="whitespace-pre-wrap text-stone-700">{module.notes}</p>
          </Section>
        )}
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Field({ label, value, mono, multiline }: { label: string; value?: string | null; mono?: boolean; multiline?: boolean }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <span className="text-stone-500">{label}:</span>
      <span className={cn(mono && 'font-mono text-[11px]', multiline ? 'whitespace-pre-wrap' : 'truncate')}>{value}</span>
    </div>
  )
}
