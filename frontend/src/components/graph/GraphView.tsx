import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import cytoscape, { type Core, type ElementDefinition, type Layouts, type NodeSingular } from 'cytoscape'
import cola from 'cytoscape-cola'
import {
  AlertCircle,
  ArrowRight,
  LayoutGrid,
  Lock,
  type LucideIcon,
  FileText,
  RotateCcw,
  Sliders,
  Shield,
  Tag,
  Unlock,
} from 'lucide-react'
import { api, type CyNode } from '@/lib/api'
import { asCytoscapeLayout } from '@/lib/cytoscape-cola-types'
import {
  clearPositions,
  countPositions,
  loadPositions,
  type PositionMap,
  savePositions,
} from '@/lib/graphPositions'
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
  // Текущий запущенный layout — хранится чтобы можно было корректно остановить
  // его перед запуском нового. Иначе cytoscape-cola при повторном `.run()`
  // на работающем инстансе залипает (анимация не перезапускается → «авто-укладка
  // работает один раз»).
  const layoutRef = useRef<Layouts | null>(null)
  const [selected, setSelected] = useState<CyNode['data'] | null>(null)
  // Locked-режим: при следующем (data) refresh используем preset-layout
  // вместо cola, чтобы не сбивать ручную раскладку. Drag всегда разрешён —
  // позиции автосохраняются по dragfree.
  const [locked, setLocked] = useState<boolean>(false)
  const [savedCount, setSavedCount] = useState<number>(0)

  // Список доменов для табов
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  // Текущий домен: из ?domain=… в URL, либо первый из списка, либо null = «все»
  const urlDomain = params.get('domain')
  const activeDomain = urlDomain ?? domains[0]?.id ?? null

  // sigma R4: dragfree-хендлер регистрируется через cy.on() один раз и замыкает
  // activeDomain — без ref'а он бы сохранял позиции под СТАРЫМ доменом, если
  // юзер перетащил узел сразу после переключения. Эффект бы рано или поздно
  // переcоздался по изменению `data`, но в окне «домен сменился, граф ещё не
  // подтянулся» drag-handler видит stale-замыкание. Ref решает это: всегда
  // читаем последнее значение.
  const activeDomainRef = useRef(activeDomain)
  activeDomainRef.current = activeDomain

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

  // Применить сохранённые позиции к узлам Cytoscape. Если узла нет в map —
  // оставляем default (его расставит cola-layout).
  const applySavedPositions = useCallback(
    (cy: Core, saved: PositionMap): number => {
      let applied = 0
      cy.nodes().forEach((n) => {
        const pos = saved[n.id()]
        if (pos) {
          n.position(pos)
          applied += 1
        }
      })
      return applied
    },
    [],
  )

  // Обработчик dragfree: автосохранение позиций при отпускании узла.
  // Сохраняем ВСЕ текущие позиции (не только перетащенный), чтобы
  // при следующей загрузке весь pin-граф восстанавливался целиком.
  const handleDragFree = useCallback(
    (domainKey: string | null) => {
      const cy = cyRef.current
      if (!cy) return
      const positions: PositionMap = {}
      cy.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = { x: p.x, y: p.y }
      })
      savePositions(domainKey, positions)
      setSavedCount(Object.keys(positions).length)
    },
    [],
  )

  // Cytoscape init / re-render at каждое изменение data
  useEffect(() => {
    if (!ref.current || !data) return
    const elements: ElementDefinition[] = [
      ...data.nodes.map((n) => ({ group: 'nodes' as const, data: n.data })),
      ...data.edges.map((e) => ({ group: 'edges' as const, data: e.data })),
    ]
    const saved = loadPositions(activeDomain)
    const hasSaved = Object.keys(saved).length > 0
    setSavedCount(Object.keys(saved).length)
    // При первой загрузке домена с сохранёнными позициями — заходим в lock-режим
    // автоматически. Юзер уже потратил время на ручную раскладку, не нужно
    // ломать её каждым refresh.
    if (hasSaved) setLocked(true)

    // Layout: если есть saved позиции — preset (не двигает узлы); иначе cola
    // с нуля. preset выбирается и в lock'е, и в просто-есть-сохранённое —
    // потому что иначе cola моментально перетряхнул бы только что применённые
    // координаты, превратив "у нас есть сохранёнка" в неотличимое от пустого.
    const layoutOpts: cytoscape.LayoutOptions = hasSaved
      ? ({ name: 'preset', fit: true } as cytoscape.LayoutOptions)
      : asCytoscapeLayout({ name: 'cola', animate: true })

    // Перед запуском нового layout останавливаем предыдущий — иначе cytoscape-cola
    // на повторном run() игнорирует команду (видимый симптом «авто-укладка
    // срабатывает один раз»).
    layoutRef.current?.stop()

    if (cyRef.current) {
      cyRef.current.elements().remove()
      cyRef.current.add(elements)
      if (hasSaved) applySavedPositions(cyRef.current, saved)
      const lo = cyRef.current.layout(layoutOpts)
      layoutRef.current = lo
      lo.run()
      setSelected(null)
      return
    }

    // Применим позиции через element.position в data — Cytoscape учтёт их
    // при инициализации (особенно важно для preset-layout).
    if (hasSaved) {
      for (const el of elements) {
        if (el.group === 'nodes' && el.data?.id && saved[el.data.id as string]) {
          ;(el as ElementDefinition).position = saved[el.data.id as string]
        }
      }
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
      layout: layoutOpts,
      wheelSensitivity: 0.2,
    })

    cy.on('tap', 'node', (evt) => setSelected(evt.target.data() as CyNode['data']))
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })
    // Drag-end: автосохранение раскладки в localStorage. Читаем домен через
    // ref, чтобы хендлер видел свежее значение даже если эффект ещё не
    // переcоздался после переключения вкладки (sigma R4).
    cy.on('dragfree', 'node', () => handleDragFree(activeDomainRef.current))

    cyRef.current = cy
    // Сохраним handle на layout для последующего stop'а перед перезапуском.
    layoutRef.current = cy.layout(layoutOpts)
    return () => {
      cy.destroy()
      cyRef.current = null
      layoutRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Toolbar handlers
  // Lock toggle: при включении захватываем текущие позиции (если их ещё нет),
  // чтобы кнопка не была мёртвой в начальном состоянии — сразу после
  // первой автоматической раскладки можно нажать «Закрепить», и она запомнит
  // как cola выложил граф. Drag всё равно работает и автодополняет позиции.
  const onToggleLock = useCallback(() => {
    setLocked((prev) => {
      const next = !prev
      const cy = cyRef.current
      if (next && cy) {
        // включаем lock → сохраняем текущие позиции узлов как «зафиксированные»
        const positions: PositionMap = {}
        cy.nodes().forEach((n) => {
          const p = n.position()
          positions[n.id()] = { x: p.x, y: p.y }
        })
        if (Object.keys(positions).length > 0) {
          savePositions(activeDomain, positions)
          setSavedCount(Object.keys(positions).length)
        }
        // Останавливаем активный layout — иначе он может продолжить дёргать узлы.
        layoutRef.current?.stop()
      }
      return next
    })
  }, [activeDomain])

  const onResetPositions = useCallback(() => {
    const ok = window.confirm(
      'Сбросить ручную раскладку графа для этого домена?\nУзлы вернутся к автоматической раскладке (cola-layout).',
    )
    if (!ok) return
    clearPositions(activeDomain)
    setSavedCount(0)
    setLocked(false)
    const cy = cyRef.current
    if (cy) {
      layoutRef.current?.stop()
      // randomize:true гарантирует что cola реально перетряхнёт узлы — без него
      // на «уже разложенном» графе layout почти не двигает координаты.
      const lo = cy.layout(asCytoscapeLayout({ name: 'cola', animate: true, randomize: true }))
      layoutRef.current = lo
      lo.run()
    }
  }, [activeDomain])

  const onRerunLayout = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    // Останавливаем предыдущий layout перед запуском нового — иначе cola
    // на уже работающем инстансе игнорирует .run() и узлы не двигаются.
    layoutRef.current?.stop()
    // Снимаем lock с узлов на случай если они залочены (cola не двигает locked
    // ноды). После reset/auto-layout user может снова drag'нуть и автосейв
    // подхватит позиции.
    cy.nodes().unlock()
    const lo = cy.layout(asCytoscapeLayout({ name: 'cola', animate: true, randomize: true }))
    layoutRef.current = lo
    lo.run()
  }, [])

  // Re-sync savedCount при смене домена (новый файл в localStorage)
  useEffect(() => {
    setSavedCount(countPositions(activeDomain))
  }, [activeDomain])

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
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-stone-500">Домен</span>
        <Tabs
          tabs={domainTabs}
          active={activeDomain ?? ALL_KEY}
          onChange={(id) => switchDomain(id === ALL_KEY ? null : id)}
          tone="primary"
        />
        {/* Toolbar справа: ручная раскладка графа. Per-domain в localStorage. */}
        <div className="ml-auto flex items-center gap-1.5">
          {savedCount > 0 && (
            <Badge tone={locked ? 'info' : 'neutral'}>
              {savedCount} позиций сохранено
            </Badge>
          )}
          <Button
            variant={locked ? 'secondary' : 'ghost'}
            size="sm"
            icon={locked ? <Lock size={13} className="text-primary" /> : <Unlock size={13} />}
            onClick={onToggleLock}
            title={
              locked
                ? 'Закреплено: при следующей загрузке узлы встанут в эти позиции'
                : 'Запомнить текущие позиции узлов как закреплённую раскладку'
            }
          >
            {locked ? 'Закреплено' : 'Закрепить'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<LayoutGrid size={13} />}
            onClick={onRerunLayout}
            title="Запустить auto-layout (cola) заново — не сбрасывает сохранённые позиции"
          >
            Авто-укладка
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={13} />}
            onClick={onResetPositions}
            disabled={savedCount === 0}
            title="Удалить сохранённую раскладку для этого домена"
          >
            Сбросить
          </Button>
        </div>
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
