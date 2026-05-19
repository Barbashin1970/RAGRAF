import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  HelpCircle,
  Plug,
  ShieldAlert,
  User,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

interface IncidentSummary {
  incident_id: string
  started_at: string | null
  last_at: string | null
  max_level: number | null
  first_event_type: string | null
  regulation_id: string | null
  verdict_status: string | null
  outcome_status: string | null
  steps: number
}

interface AuditEntry {
  entry_id: string
  incident_id: string
  timestamp: string | null
  event_type: string
  source_module_id?: string | null
  source_sensor_id?: string | null
  source_sensor_subtype?: string | null
  event_value?: number | null
  event_payload?: Record<string, unknown> | null
  regulation_id?: string | null
  regulation_version?: string | null
  level?: number | null
  recommendation?: string | null
  verdict_status?: string | null
  evidence_level?: string
  user_id?: string | null
  user_action?: string | null
  user_comment?: string | null
  outcome_status?: string | null
}

const LEVEL_BADGE: Record<number, { label: string; cls: string }> = {
  0: { label: 'норма', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  1: { label: 'критич.', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  2: { label: 'важн.', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  3: { label: 'обычн.', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  const now = Date.now()
  const delta = Math.floor((now - d) / 1000)
  if (delta < 60) return `${delta} сек назад`
  if (delta < 3600) return `${Math.floor(delta / 60)} мин назад`
  if (delta < 86400) return `${Math.floor(delta / 3600)} ч назад`
  return `${Math.floor(delta / 86400)} дн. назад`
}

export function AuditLogScreen() {
  const { data: incidents, isLoading } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api.auditLog.listRecent(100) as unknown as Promise<IncidentSummary[]>,
    refetchInterval: 30000,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Аггрегаты для шапки
  const stats = useMemo(() => {
    if (!incidents) return { total: 0, critical: 0, inProgress: 0, today: 0 }
    const today0 = new Date()
    today0.setHours(0, 0, 0, 0)
    return {
      total: incidents.length,
      critical: incidents.filter((i) => i.max_level === 1).length,
      inProgress: incidents.filter((i) => (i.outcome_status || '').includes('progress')).length,
      today: incidents.filter((i) => {
        const t = i.started_at ? new Date(i.started_at).getTime() : 0
        return t >= today0.getTime()
      }).length,
    }
  }, [incidents])

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <ClipboardList size={18} className="text-rose-600" />
          <h1 className="text-base font-semibold text-stone-900">Дашборд руководителя</h1>
          <span className="text-xs text-stone-500">
            Аудит-цепочка инцидентов (СИГМА § 2 «Объяснимость и аудит»):
            событие → регламент → рекомендация → действие → результат
          </span>
        </div>
        <div className="mt-3 flex gap-3 text-sm">
          <StatCard label="Всего инцидентов" value={stats.total} icon={ClipboardList} tone="stone" />
          <StatCard label="Критические" value={stats.critical} icon={ShieldAlert} tone="rose" />
          <StatCard label="В работе" value={stats.inProgress} icon={Eye} tone="amber" />
          <StatCard label="За сегодня" value={stats.today} icon={CheckCircle2} tone="emerald" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading && <div className="text-sm text-stone-500">Загрузка журнала…</div>}
          {!isLoading && incidents && incidents.length === 0 && (
            <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
              Инциденты не зарегистрированы. После первого срабатывания регламента
              на событии от модуля цепочка появится здесь.
            </div>
          )}
          <ul className="space-y-1.5">
            {incidents?.map((inc) => (
              <IncidentRow
                key={inc.incident_id}
                inc={inc}
                selected={selectedId === inc.incident_id}
                onClick={() => setSelectedId(inc.incident_id)}
              />
            ))}
          </ul>
        </div>
        {selectedId && <IncidentTimelinePanel incidentId={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: 'stone' | 'rose' | 'amber' | 'emerald' }) {
  const tones: Record<typeof tone, string> = {
    stone: 'bg-stone-50 text-stone-700 border-stone-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }
  return (
    <div className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5', tones[tone])}>
      <Icon size={14} />
      <div>
        <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
        <div className="text-base font-semibold leading-none">{value}</div>
      </div>
    </div>
  )
}

function IncidentRow({ inc, selected, onClick }: { inc: IncidentSummary; selected: boolean; onClick: () => void }) {
  const level = inc.max_level ?? 0
  const badge = LEVEL_BADGE[level] || LEVEL_BADGE[0]
  const outcome = inc.outcome_status || (inc.verdict_status === 'fired' ? 'pending' : '—')
  return (
    <li
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm transition hover:border-blue-300 hover:bg-blue-50/30',
        selected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-stone-200',
      )}
    >
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase', badge.cls)}>
        L{level} {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-stone-900">
          {inc.first_event_type || '—'}
          {inc.regulation_id && <span className="ml-2 text-xs text-stone-500">→ {inc.regulation_id}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-stone-500">
          <span title={fmtTime(inc.started_at)}>{relTime(inc.started_at)}</span>
          <span>{inc.steps} шагов</span>
          {outcome !== '—' && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-700">{outcome}</span>}
        </div>
      </div>
      <ChevronRight size={14} className="shrink-0 text-stone-400" />
    </li>
  )
}

function IncidentTimelinePanel({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const { data: chain, isLoading } = useQuery({
    queryKey: ['audit-log', incidentId],
    queryFn: () => api.auditLog.getIncident(incidentId) as unknown as Promise<AuditEntry[]>,
  })
  return (
    <aside className="w-[440px] shrink-0 overflow-y-auto border-l border-stone-200 bg-white">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Хронология инцидента</div>
          <div className="font-mono text-[11px] text-stone-700">{incidentId.slice(0, 24)}…</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
          <ChevronRight size={14} />
        </button>
      </header>
      <div className="px-4 py-3">
        {isLoading && <div className="text-sm text-stone-500">Загрузка цепочки…</div>}
        {chain && (
          <ol className="relative space-y-3 border-l-2 border-stone-200 pl-4">
            {chain.map((entry, i) => (
              <TimelineEntry key={entry.entry_id} entry={entry} index={i + 1} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  )
}

function TimelineEntry({ entry, index }: { entry: AuditEntry; index: number }) {
  // Определяем «стадию» цепочки по заполненным полям:
  // event / verdict / user_action / outcome
  const stage: 'event' | 'verdict' | 'action' | 'unknown' =
    entry.user_action ? 'action'
    : entry.regulation_id ? 'verdict'
    : entry.event_type ? 'event'
    : 'unknown'

  const stageMeta: Record<typeof stage, { icon: LucideIcon; cls: string; label: string }> = {
    event: { icon: Plug, cls: 'border-blue-300 bg-blue-50 text-blue-700', label: 'Событие' },
    verdict: { icon: ShieldAlert, cls: 'border-rose-300 bg-rose-50 text-rose-700', label: 'Вердикт регламента' },
    action: { icon: User, cls: 'border-amber-300 bg-amber-50 text-amber-700', label: 'Действие оператора' },
    unknown: { icon: HelpCircle, cls: 'border-stone-200 bg-stone-50 text-stone-600', label: 'Шаг' },
  }
  const meta = stageMeta[stage]
  const Icon = meta.icon

  const evidenceBadge = entry.evidence_level && entry.evidence_level !== 'measured' ? (
    <span className={cn(
      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase',
      entry.evidence_level === 'unknown'
        ? 'border-amber-300 bg-amber-50 text-amber-800'
        : 'border-stone-300 bg-stone-100 text-stone-700',
    )}>
      <AlertTriangle size={10} /> {entry.evidence_level}
    </span>
  ) : null

  return (
    <li className="relative">
      <span className={cn(
        'absolute -left-[1.6rem] flex h-5 w-5 items-center justify-center rounded-full border-2',
        meta.cls.replace('text-', 'border-').split(' ')[0],
        meta.cls.split(' ')[1],
      )}>
        <span className="text-[10px] font-bold">{index}</span>
      </span>
      <div className={cn('rounded-md border p-2 text-xs', meta.cls.replace(/text-\S+/, ''))}>
        <div className="mb-1 flex items-center gap-2">
          <Icon size={12} />
          <span className="font-semibold">{meta.label}</span>
          <span className="ml-auto text-[10px] text-stone-500">{fmtTime(entry.timestamp)}</span>
        </div>

        <div className="space-y-1 font-mono text-[11px] leading-snug text-stone-800">
          <div><b>event_type:</b> {entry.event_type}</div>
          {entry.source_module_id && <div><b>module:</b> {entry.source_module_id}</div>}
          {entry.source_sensor_subtype && <div><b>sensor:</b> {entry.source_sensor_subtype}</div>}
          {entry.event_value != null && <div><b>value:</b> {entry.event_value}</div>}
          {entry.regulation_id && <div><b>regulation:</b> {entry.regulation_id} v{entry.regulation_version ?? '—'}</div>}
          {entry.level != null && (
            <div className="flex items-center gap-1.5">
              <b>level:</b> {entry.level}
              {LEVEL_BADGE[entry.level] && (
                <span className={cn('rounded border px-1 text-[9px] font-medium uppercase', LEVEL_BADGE[entry.level].cls)}>
                  {LEVEL_BADGE[entry.level].label}
                </span>
              )}
              {evidenceBadge}
            </div>
          )}
          {entry.verdict_status && <div><b>verdict_status:</b> {entry.verdict_status}</div>}
          {entry.user_id && <div><b>user:</b> {entry.user_id}</div>}
          {entry.user_action && <div><b>action:</b> {entry.user_action}</div>}
          {entry.outcome_status && <div><b>outcome:</b> {entry.outcome_status}</div>}
        </div>

        {entry.recommendation && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10px] text-stone-500 hover:text-stone-800">Текст рекомендации</summary>
            <p className="mt-1 whitespace-pre-wrap rounded bg-white/50 p-1.5 text-[11px] leading-snug text-stone-800">
              {entry.recommendation}
            </p>
          </details>
        )}
        {entry.user_comment && (
          <p className="mt-1.5 italic text-[11px] text-stone-700">«{entry.user_comment}»</p>
        )}
      </div>
    </li>
  )
}
