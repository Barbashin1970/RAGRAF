import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DocumentsPanel } from './DocumentsPanel'
import { RegulationsPanel } from './RegulationsPanel'

/**
 * Левая колонка в чате: переключаемый контейнер «Документы | Регламенты».
 * Обе панели работают одновременно (галки сохраняются между переключениями),
 * вкладки лишь экономят место — две полные ленты рядом раздули бы канвас.
 *
 * Состояние «что отключено из регламентов» поднято в SearchDemo, чтобы
 * проброситься в API. Документы хранят своё состояние на бэке (DuckDB) —
 * тут просто рендерится DocumentsPanel как раньше.
 */

interface Props {
  disabledRegulationIds: Set<string>
  onToggleRegulation: (id: string, disabled: boolean) => void
  onSetManyRegulations: (ids: string[], disabled: boolean) => void
}

type Tab = 'documents' | 'regulations'

export function ContextPanel({
  disabledRegulationIds,
  onToggleRegulation,
  onSetManyRegulations,
}: Props) {
  const [tab, setTab] = useState<Tab>('documents')

  // Считаем enabled-документы и регламенты для бэйджей на табах —
  // пользователь сразу видит сколько в контексте, не переключаясь.
  const { data: docsData } = useQuery({
    queryKey: ['sandbox-documents'],
    queryFn: () => api.sandbox.listDocuments(),
  })
  const { data: regsRaw } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })

  const docsEnabled = docsData?.limits.enabled_count ?? 0
  const regsTotal = (() => {
    if (!regsRaw) return 0
    if (Array.isArray(regsRaw)) return regsRaw.length
    if ('items' in regsRaw && Array.isArray(regsRaw.items)) return regsRaw.items.length
    return 0
  })()
  const regsEnabled = regsTotal - disabledRegulationIds.size

  return (
    <aside
      data-context-panel
      className="flex h-full w-72 shrink-0 flex-col border-r border-stone-200 bg-stone-50/60"
    >
      {/* Tab strip — компактный, мини-бэйджи с числом enabled */}
      <nav className="grid grid-cols-2 border-b border-stone-200 bg-white">
        <TabButton
          active={tab === 'documents'}
          onClick={() => setTab('documents')}
          icon={FileText}
          label="Документы"
          badge={docsEnabled}
          tone="violet"
        />
        <TabButton
          active={tab === 'regulations'}
          onClick={() => setTab('regulations')}
          icon={ScrollText}
          label="Регламенты"
          badge={regsEnabled}
          tone="emerald"
        />
      </nav>

      {/* Контент текущего таба */}
      <div className="min-h-0 flex-1">
        {tab === 'documents' ? (
          <DocumentsPanel />
        ) : (
          <RegulationsPanel
            disabledIds={disabledRegulationIds}
            onToggle={onToggleRegulation}
            onSetMany={onSetManyRegulations}
          />
        )}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
  tone,
}: {
  active: boolean
  onClick: () => void
  icon: typeof FileText
  label: string
  badge: number
  tone: 'violet' | 'emerald'
}) {
  const colors =
    tone === 'violet'
      ? { active: 'text-violet-700 border-violet-500', badge: 'bg-violet-100 text-violet-700' }
      : { active: 'text-emerald-700 border-emerald-500', badge: 'bg-emerald-100 text-emerald-700' }
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition',
        active
          ? colors.active
          : 'border-transparent text-stone-500 hover:bg-stone-50 hover:text-stone-700',
      )}
    >
      <Icon size={13} />
      {label}
      <span
        className={cn(
          'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
          active ? colors.badge : 'bg-stone-100 text-stone-600',
        )}
      >
        {badge}
      </span>
    </button>
  )
}
