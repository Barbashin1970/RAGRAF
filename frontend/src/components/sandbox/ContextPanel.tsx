import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, ScrollText } from 'lucide-react'
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
 *
 * Collapsed-режим симметричен правой ChatSettingsPanel: w-8 полоска с
 * шевроном вверху, иконками доков/регламентов в центре, мини-бэйджами
 * включённых источников. Сворачивается влево, как ChatSettingsPanel —
 * вправо.
 */

interface Props {
  collapsed: boolean
  onToggleCollapsed: () => void
  disabledRegulationIds: Set<string>
  onToggleRegulation: (id: string, disabled: boolean) => void
  onSetManyRegulations: (ids: string[], disabled: boolean) => void
}

type Tab = 'documents' | 'regulations'

export function ContextPanel({
  collapsed,
  onToggleCollapsed,
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

  if (collapsed) {
    // Свёрнутая полоска: шеврон вверху (раскрыть), две иконки-кликабельные
    // (открывают панель сразу на нужной вкладке), мини-точки если что-то
    // включено в контексте. Зеркало правой ChatSettingsPanel.
    return (
      <aside
        data-context-panel
        className="flex w-8 shrink-0 flex-col items-center justify-between border-r border-stone-200 bg-stone-50/40 py-2"
        aria-label="Свёрнутая панель документов и регламентов"
      >
        <button
          onClick={onToggleCollapsed}
          className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
          title="Раскрыть панель «Документы / Регламенты»"
          aria-label="Раскрыть панель"
        >
          <ChevronRight size={14} />
        </button>
        <div className="flex flex-col items-center gap-3 text-stone-400">
          <button
            onClick={() => {
              setTab('documents')
              onToggleCollapsed()
            }}
            className="relative flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-violet-50 hover:text-violet-700"
            title={`Документы — ${docsEnabled} включено`}
            aria-label="Открыть документы"
          >
            <FileText size={13} />
            {docsEnabled > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-violet-500"
                aria-hidden
              />
            )}
          </button>
          <button
            onClick={() => {
              setTab('regulations')
              onToggleCollapsed()
            }}
            className="relative flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-emerald-50 hover:text-emerald-700"
            title={`Регламенты — ${regsEnabled} из ${regsTotal} включено`}
            aria-label="Открыть регламенты"
          >
            <ScrollText size={13} />
            {regsEnabled > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden
              />
            )}
          </button>
        </div>
        <span className="text-[8px] font-medium uppercase tracking-wider text-stone-300" aria-hidden>
          ист.
        </span>
      </aside>
    )
  }

  return (
    <aside
      data-context-panel
      className="flex h-full w-72 shrink-0 flex-col border-r border-stone-200 bg-stone-50/60"
    >
      {/* Шапка: шеврон-свернуть + табы. Шеврон смотрит влево —
          сворачиваем в эту сторону, как ChatSettingsPanel вправо. */}
      <div className="flex items-stretch border-b border-stone-200 bg-white">
        <button
          onClick={onToggleCollapsed}
          className="flex w-7 shrink-0 items-center justify-center text-stone-500 transition hover:bg-stone-50 hover:text-stone-800"
          title="Свернуть панель"
          aria-label="Свернуть панель"
        >
          <ChevronLeft size={14} />
        </button>
        {/* Tab strip — компактный (px-2, без gap), бэйджи минималистичные.
            Раньше было grid-cols-2 на всю ширину; теперь делим оставшееся
            пространство после шеврона. */}
        <nav className="grid flex-1 grid-cols-2">
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
      </div>

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
        // Компактнее: px-2 вместо px-3, gap-1 вместо gap-1.5, text-[11px]
        // вместо text-xs — экономим место чтобы шеврон-свернуть встал слева
        // без переноса лейбла.
        'flex items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-[11px] font-medium transition',
        active
          ? colors.active
          : 'border-transparent text-stone-500 hover:bg-stone-50 hover:text-stone-700',
      )}
    >
      <Icon size={12} />
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
