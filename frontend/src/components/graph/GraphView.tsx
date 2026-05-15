import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape'
import cola from 'cytoscape-cola'
import {
  AlertCircle,
  ArrowRight,
  type LucideIcon,
  FileText,
  Sliders,
  Shield,
  Tag,
} from 'lucide-react'
import { api, type CyNode } from '@/lib/api'
import { asCytoscapeLayout } from '@/lib/cytoscape-cola-types'
import { Badge, Button, Tabs, type TabDef } from '@/components/ui'

// Иконки для типов узлов графа. Совпадают семантически с цветами TYPE_COLOR
// (Regulation=teal/FileText, Parameter=green/Sliders, Constraint=gray/Shield,
// Recommendation=orange/AlertCircle, Source=light-gray/Tag).
const TYPE_ICON: Record<string, LucideIcon> = {
  Regulation: FileText,
  Parameter: Sliders,
  Constraint: Shield,
  Recommendation: AlertCircle,
  Source: Tag,
}

cytoscape.use(cola)

const TYPE_COLOR: Record<string, string> = {
  Regulation:     '#2C7A7B',
  Parameter:      '#2F855A',
  Constraint:     '#9CA3AF',
  Recommendation: '#DD6B20',
  Source:         '#D1D5DB',
}

export function GraphView() {
  const [params, setParams] = useSearchParams()
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<CyNode['data'] | null>(null)

  // Список доменов для табов
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  // Текущий домен: из ?domain=… в URL, либо первый из списка, либо null = «все»
  const urlDomain = params.get('domain')
  const activeDomain = urlDomain ?? domains[0]?.id ?? null

  // Когда домены подгрузились и в URL ничего не было — мягко выставляем первый
  // (через replace, чтобы не плодить history-записи)
  useEffect(() => {
    if (!urlDomain && domains.length > 0) {
      setParams({ domain: domains[0].id }, { replace: true })
    }
    // мы намеренно слушаем только domains.length, чтобы не перебивать выбор юзера
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains.length])

  const { data, isLoading, error } = useQuery({
    queryKey: ['graph', activeDomain ?? 'all'],
    queryFn: () => api.graph.all(activeDomain ?? undefined),
    enabled: domains.length === 0 || !!activeDomain,
  })

  // Cytoscape init / re-render at каждое изменение data
  useEffect(() => {
    if (!ref.current || !data) return
    const elements: ElementDefinition[] = [
      ...data.nodes.map((n) => ({ group: 'nodes' as const, data: n.data })),
      ...data.edges.map((e) => ({ group: 'edges' as const, data: e.data })),
    ]

    if (cyRef.current) {
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
      // R7.2 (Sigma-audit): cola-layout type-safe через asCytoscapeLayout helper.
      cyRef.current.layout(asCytoscapeLayout({ name: 'cola', animate: true })).run()
      setSelected(null)
      return
    }

    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: NodeSingular) => TYPE_COLOR[ele.data('type') as string] ?? '#94A3B8',
            label: 'data(label)',
            'font-size': 11,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            color: '#1f2937',
            width: 22,
            height: 22,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#CBD5E1',
            'curve-style': 'bezier',
            'target-arrow-color': '#CBD5E1',
            'target-arrow-shape': 'triangle',
            'font-size': 9,
            color: '#64748b',
            label: 'data(label)',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-color': '#1A202C', 'border-width': 2 },
        },
      ],
      layout: asCytoscapeLayout({ name: 'cola', animate: true }),
      wheelSensitivity: 0.2,
    })

    cy.on('tap', 'node', (evt) => setSelected(evt.target.data() as CyNode['data']))
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [data])

  const switchDomain = (id: string | null) => {
    if (id === null) {
      params.delete('domain')
      setParams(params, { replace: false })
    } else {
      setParams({ domain: id }, { replace: false })
    }
  }

  // Tabs primitive не умеет null-id, поэтому виртуальный '__all__' для опции «все».
  const ALL_KEY = '__all__'
  const domainTabs: TabDef<string>[] = [
    ...domains.map((d) => ({ id: d.id, label: d.label })),
    { id: ALL_KEY, label: 'все' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Domain-навигация. Не PageHeader — GraphView это full-bleed canvas-экран,
          без title/description. Только сам переключатель доменов сверху. */}
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-stone-500">Домен</span>
        <Tabs
          tabs={domainTabs}
          active={activeDomain ?? ALL_KEY}
          onChange={(id) => switchDomain(id === ALL_KEY ? null : id)}
          tone="primary"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          {isLoading && (
            <div className="absolute inset-0 grid place-items-center text-sm text-stone-500">
              Загрузка графа…
            </div>
          )}
          {error && (
            <div className="m-4 rounded-md border border-accent-notification bg-accent-notification-highlight p-3 text-sm text-accent-notification">
              Ошибка: {(error as Error).message}
            </div>
          )}
          <div ref={ref} className="cy-canvas absolute inset-0 bg-surface" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 text-xs">
            {Object.entries(TYPE_COLOR).map(([type, color]) => (
              <span key={type} className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 shadow">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                {type}
              </span>
            ))}
          </div>
          {data?.meta && (
            <div className="absolute bottom-3 right-3 rounded-md bg-white/90 px-2 py-1 text-xs text-stone-500 shadow">
              узлов: {data.meta.total_nodes} · рёбер: {data.meta.total_edges}
            </div>
          )}
        </div>
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-stone-200 bg-white text-sm">
          {selected ? (() => {
            const Icon = TYPE_ICON[selected.type]
            const color = TYPE_COLOR[selected.type] ?? '#94A3B8'
            const domainLabel = selected.domain
              ? domains.find((d) => d.id === selected.domain)?.label || selected.domain
              : null
            return (
              <>
                {/* Шапка детали узла — icon-pill в стиле Node-RED-блока на canvas'е. */}
                <header className="flex items-center gap-3 border-b border-stone-200 bg-stone-50/60 px-4 py-3">
                  {Icon && (
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: color }}
                    >
                      <Icon size={18} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                      {selected.type}
                    </div>
                    <div className="truncate text-sm font-semibold text-stone-900" title={selected.label}>
                      {selected.label}
                    </div>
                  </div>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  {selected.description && (
                    <div className="whitespace-pre-line break-words text-sm leading-relaxed text-stone-700">
                      {selected.description}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {domainLabel && <Badge tone="info">{domainLabel}</Badge>}
                    <Badge tone="neutral">{selected.type}</Badge>
                  </div>
                  <div className="border-t border-stone-100 pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                      Идентификатор
                    </div>
                    <code className="mt-0.5 block break-all rounded bg-stone-100 px-1.5 py-1 font-mono text-[11px] text-stone-700">
                      {selected.id}
                    </code>
                  </div>
                  {selected.regulation_id && selected.type === 'Regulation' && (
                    <Link to={`/regulations/${selected.regulation_id}/flow`} className="block">
                      <Button variant="primary" size="sm" iconRight={<ArrowRight size={13} />}>
                        Открыть в редакторе
                      </Button>
                    </Link>
                  )}
                </div>
              </>
            )
          })() : (
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-stone-500">
              Кликните по узлу для деталей.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
