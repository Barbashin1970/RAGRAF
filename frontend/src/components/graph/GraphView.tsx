import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape'
import cola from 'cytoscape-cola'
import { api, type CyNode } from '@/lib/api'
import { cn } from '@/lib/cn'
import { asCytoscapeLayout } from '@/lib/cytoscape-cola-types'

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

  return (
    <div className="flex h-full flex-col">
      {/* Domain tabs */}
      <div className="flex items-center gap-1 border-b border-stone-200 bg-white px-4 py-2 text-sm">
        <span className="mr-2 text-xs uppercase tracking-wide text-stone-500">Домен</span>
        {domains.map((d) => (
          <button
            key={d.id}
            onClick={() => switchDomain(d.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition',
              activeDomain === d.id
                ? 'bg-primary text-white'
                : 'text-stone-700 hover:bg-surface-offset',
            )}
          >
            {d.label}
          </button>
        ))}
        <button
          onClick={() => switchDomain(null)}
          className={cn(
            'ml-1 rounded-md px-3 py-1.5 text-sm transition',
            !activeDomain
              ? 'bg-stone-700 text-white'
              : 'text-stone-500 hover:bg-surface-offset',
          )}
          title="Показать все домены сразу"
        >
          все
        </button>
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
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-3 text-sm">
          {selected ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-stone-500">{selected.type}</div>
              <div className="text-base font-semibold leading-snug">{selected.label}</div>
              {selected.description && (
                <div className="whitespace-pre-line break-words text-sm leading-relaxed text-stone-700">
                  {selected.description}
                </div>
              )}
              {selected.domain && (
                <div className="text-xs">
                  <span className="text-stone-500">домен: </span>
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">
                    {domains.find((d) => d.id === selected.domain)?.label || selected.domain}
                  </span>
                </div>
              )}
              <div className="break-all font-mono text-xs text-stone-400">{selected.id}</div>
              {selected.regulation_id && selected.type === 'Regulation' && (
                <a
                  href={`/regulations/${selected.regulation_id}/flow`}
                  className="mt-2 inline-block rounded-md bg-primary px-2 py-1 text-xs text-white"
                >
                  Открыть в редакторе →
                </a>
              )}
            </div>
          ) : (
            <div className="text-stone-500">Кликните по узлу для деталей.</div>
          )}
        </aside>
      </div>
    </div>
  )
}
