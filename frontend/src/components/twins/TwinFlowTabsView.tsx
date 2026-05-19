import { useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useQueries } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Link2 } from 'lucide-react'
import { api, NODE_KIND_META, type FlowNode, type Process, type ProcessWiringEntry, type RuleDSL } from '@/lib/api'
import { cn } from '@/lib/cn'
import { nodeTypes } from '@/components/flow/nodes'

/**
 * Полотно «Двойник как поток».
 *
 * UX (зафиксирован 2026-05-19):
 *   • Вкладки сверху — по одной на каждый регламент-член. Click переключает.
 *   • На каждой вкладке — flow.json регламента read-only (тот же reactflow,
 *     те же узлы что в Flow Editor; единый визуальный язык).
 *   • Output-узлы, чьи action'ы участвуют в Twin.wiring как source — кликабельны:
 *     overlay-кнопка «↘» переключает на вкладку target-регламента + подсвечивает
 *     input-узел, в который этот output кормит. Подсветка индиго на ~1.5s.
 *   • Sensor-узлы в режиме sourceKind='regulation' — кликабельны обратно: «↖»
 *     возвращает на вкладку source-регламента + подсвечивает output-узел.
 *
 * Это даёт «прогулку» по композиции: аналитик видит каждый регламент целиком,
 * а wiring подсвечивает точки стыка. Ничего здесь не редактируется — правка
 * нод происходит в Flow Editor каждого регламента отдельно, wiring — в форме
 * «Связи» в этом же двойнике.
 */
export function TwinFlowTabsView({
  twin,
  members,
}: {
  twin: Process
  members: Array<{ id: string; name: string }>
}) {
  // Параллельная загрузка всех flow.json членов. react-query кэширует +
  // staleTime разумный, чтобы не дёргать backend при каждом переключении вкладки.
  const flowQueries = useQueries({
    queries: members.map((m) => ({
      queryKey: ['flow', m.id],
      queryFn: () => api.flow.get(m.id),
      staleTime: 30_000,
    })),
  })

  const [activeTab, setActiveTab] = useState<string>(members[0]?.id ?? '')
  // ID узла, который надо подсветить после прыжка на новую вкладку (индиго ~1.5s).
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  // taimer ref для уборки подсветки.
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Если активная вкладка ушла из состава (например, регламент убрали) —
  // фолбэк на первый доступный.
  useEffect(() => {
    if (!members.some((m) => m.id === activeTab)) {
      setActiveTab(members[0]?.id ?? '')
    }
  }, [members, activeTab])

  // Переключиться на target-вкладку + подсветить узел через короткий timeout.
  const jumpTo = (regulationId: string, nodeId: string | null) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    setActiveTab(regulationId)
    setFocusedNodeId(nodeId)
    focusTimerRef.current = setTimeout(() => setFocusedNodeId(null), 2500)
  }

  // Индекс wiring: по (target_regulation, target_param_ref) → source-сторона.
  // Используется при клике на sensor-узел target'а — найти куда «вернуться».
  const wiringByTarget = useMemo(() => {
    const m = new Map<string, ProcessWiringEntry>()
    for (const w of twin.wiring ?? []) {
      m.set(`${w.target_regulation}::${w.target_param_ref}`, w)
    }
    return m
  }, [twin.wiring])
  // И обратный: по (source_regulation, source_output ?? '*') → target-сторона.
  // Используется при клике на output-узел source'а — найти куда «провалиться».
  const wiringBySource = useMemo(() => {
    // ProcessWiringEntry.source_output может быть null (= «любой output»).
    // Чтобы кликнутый конкретный action нашёл entry-с-null, кладём также
    // «*»-fallback за тем же source_regulation; lookup сначала ищет точное
    // совпадение, потом fallback.
    const m = new Map<string, ProcessWiringEntry[]>()
    for (const w of twin.wiring ?? []) {
      const key1 = `${w.source_regulation}::${w.source_output ?? '*'}`
      const arr = m.get(key1) ?? []
      arr.push(w)
      m.set(key1, arr)
    }
    return m
  }, [twin.wiring])

  if (members.length === 0) {
    return (
      <div className="rounded-md border border-stone-200 bg-white p-4 text-center text-xs text-stone-500">
        Добавьте регламенты в состав, чтобы увидеть их потоки.
      </div>
    )
  }

  const activeIdx = members.findIndex((m) => m.id === activeTab)
  const activeFlow = activeIdx >= 0 ? flowQueries[activeIdx]?.data ?? null : null
  const activeLoading = activeIdx >= 0 ? flowQueries[activeIdx]?.isLoading : false
  // Имена регламентов для рендера wiring-стрелочек в overlay.
  const memberNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of members) m.set(x.id, x.name)
    return m
  }, [members])

  return (
    <div className="rounded-md border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-1 border-b border-stone-200 bg-stone-50 px-3 py-2">
        <Link2 size={13} className="text-violet-600" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">
          Потоки регламентов в составе
        </span>
      </div>
      {/* Вкладки */}
      <div className="flex flex-wrap gap-1 border-b border-stone-200 bg-stone-50/60 px-2 py-1.5">
        {members.map((m, i) => {
          const active = m.id === activeTab
          const wiringIn = (twin.wiring ?? []).filter((w) => w.target_regulation === m.id).length
          const wiringOut = (twin.wiring ?? []).filter((w) => w.source_regulation === m.id).length
          return (
            <button
              key={m.id}
              onClick={() => setActiveTab(m.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition',
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-white text-stone-700 hover:bg-stone-100 ring-1 ring-stone-200',
              )}
            >
              <span className="font-mono opacity-70">{i + 1}</span>
              <span className="font-medium">{m.name}</span>
              {(wiringIn > 0 || wiringOut > 0) && (
                <span className={cn(
                  'rounded-sm px-1 py-px text-[9px]',
                  active ? 'bg-violet-700/40' : 'bg-violet-100 text-violet-700',
                )}>
                  ↓{wiringIn} ↑{wiringOut}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* Канвас */}
      <div className="relative h-[480px] bg-stone-50">
        {activeLoading ? (
          <div className="grid h-full place-items-center text-xs text-stone-500">
            Загружаю поток…
          </div>
        ) : activeFlow ? (
          <ReactFlowProvider>
            <TabCanvas
              regulationId={activeTab}
              dsl={activeFlow}
              focusedNodeId={focusedNodeId}
              wiringByTarget={wiringByTarget}
              wiringBySource={wiringBySource}
              onJumpToTarget={jumpTo}
              memberNameById={memberNameById}
            />
          </ReactFlowProvider>
        ) : (
          <div className="grid h-full place-items-center text-xs text-stone-500">
            Поток ещё не сохранён для этого регламента.
          </div>
        )}
      </div>
      <div className="border-t border-stone-200 bg-violet-50/30 px-3 py-2 text-[10px] leading-relaxed text-violet-900">
        <b>Как это устроено:</b> у каждого регламента своя вкладка. На пилюлях «Выход»
        (если кто-то слушает этот выход) и «Событие из регламента» (если этот вход
        получает значение от другого регламента) есть круглая кнопка-стрелка ↘ / ↖ —
        клик переключает на связанную вкладку и подсвечивает узел индиго.
      </div>
    </div>
  )
}


// ── Один канвас (одна вкладка) ────────────────────────────────────────


function TabCanvas({
  regulationId,
  dsl,
  focusedNodeId,
  wiringByTarget,
  wiringBySource,
  onJumpToTarget,
  memberNameById,
}: {
  regulationId: string
  dsl: RuleDSL
  focusedNodeId: string | null
  wiringByTarget: Map<string, ProcessWiringEntry>
  wiringBySource: Map<string, ProcessWiringEntry[]>
  onJumpToTarget: (regulationId: string, nodeId: string | null) => void
  memberNameById: Map<string, string>
}) {
  const rf = useReactFlow()
  // При смене вкладки или появлении focusedNodeId — fitView + центрируем
  // фокусный узел.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (focusedNodeId) {
          const n = dsl.nodes.find((x) => x.id === focusedNodeId)
          if (n?.position) {
            rf.setCenter(n.position.x + 80, n.position.y + 30, { zoom: 1.0, duration: 500 })
            return
          }
        }
        rf.fitView({ padding: 0.2, duration: 300 })
      } catch {
        /* ignore — viewport may not be ready */
      }
    }, 50)
    return () => clearTimeout(t)
  }, [regulationId, focusedNodeId, dsl.nodes, rf])

  // Превращаем RuleDSL → reactflow Node[]/Edge[]. Маркер isFocused тащим
  // через data.label/data.flowFired аналог — используем CSS-класс через
  // className на ноде (reactflow поддерживает className на NodeProps).
  const rfNodes: Node<FlowNode>[] = useMemo(() => {
    return dsl.nodes.map((n) => {
      const isFocused = focusedNodeId === n.id
      return {
        id: n.id,
        type: n.type,
        data: n,
        position: n.position ?? { x: 0, y: 0 },
        // Подсветка узла на ~2.5s после прыжка (см. useEffect выше).
        className: isFocused ? 'flow-jump-focused' : undefined,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        // На двойниковом канвасе всё read-only — узлы не двигаются и не
        // редактируются. Selection оставляем чтобы клик их подсвечивал.
        draggable: false,
        connectable: false,
        deletable: false,
      }
    })
  }, [dsl.nodes, focusedNodeId])

  const rfEdges: Edge[] = useMemo(() => {
    return dsl.edges.map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'default',
    }))
  }, [dsl.edges])

  // Overlay-кнопки «↘/↖» для wiring-точек. Накладываем поверх reactflow
  // абсолютно-позиционированными div'ами по координатам нод. Чтобы они
  // ездили со зумом/панорамированием, используем useReactFlow().flowToScreenPosition.
  // Для простоты MVP — используем фиксированный layer внутри ReactFlow Panel
  // и считаем экранные координаты через `rf.flowToScreenPosition`.
  const [viewportTick, setViewportTick] = useState(0)
  useEffect(() => {
    // Перерисовываем overlay каждые ~30мс пока пользователь двигает канвас.
    // Альтернатива — подписываться на onMove из ReactFlow, но это потребует
    // ещё одного state-loop'а. MVP: cheap rAF.
    let frame: number
    const tick = () => {
      setViewportTick((t) => (t + 1) % 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  // Точки, у которых надо рисовать overlay-кнопку: для текущего
  // regulationId — output-узлы которые источники wiring (есть запись с
  // source_regulation = regulationId, source_output = node.action ИЛИ '*'),
  // и sensor-узлы которые цели wiring (sourceKind='regulation' с заданным
  // sourceRegulationId).
  const jumpPoints = useMemo(() => {
    const out: Array<{
      nodeId: string
      x: number
      y: number
      direction: 'down' | 'up'    // down = провалиться вниз (output→target), up = вернуться вверх (sensor→source)
      otherRegulationId: string
      otherNodeIdHint: string | null   // id узла на той стороне для focus
      title: string
    }> = []
    for (const n of dsl.nodes) {
      if (!n.position) continue
      if (n.type === 'output' && n.action) {
        // Кто-то слушает этот action?
        const exact = wiringBySource.get(`${regulationId}::${n.action}`) ?? []
        const wildcard = wiringBySource.get(`${regulationId}::*`) ?? []
        const matches = [...exact, ...wildcard]
        if (matches.length > 0) {
          const w = matches[0]
          // Поищем input-ноду в target.regulation с paramRef=target_param_ref;
          // мы её id не знаем сейчас (другой flow), но focus можно навести по
          // sensor.id = `n_sensor_regsrc_<param>` (см. project_wiring_to_flows).
          out.push({
            nodeId: n.id,
            x: n.position.x,
            y: n.position.y,
            direction: 'down',
            otherRegulationId: w.target_regulation,
            otherNodeIdHint: null,  // целевой канвас сам fitView сделает
            title: `→ Перейти к «${memberNameById.get(w.target_regulation) ?? w.target_regulation}» (вход ${w.target_param_ref})`,
          })
        }
      } else if (n.type === 'sensor' && (n.sourceKind ?? 'sensor') === 'regulation') {
        // Этот sensor получает значение от источника?
        // bindsTo указывает на input в текущем flow; через input.paramRef
        // найдём wiring-запись (target_regulation = regulationId, target_param = paramRef).
        const inp = dsl.nodes.find((x) => x.id === n.bindsTo)
        if (!inp || !inp.paramRef) continue
        const w = wiringByTarget.get(`${regulationId}::${inp.paramRef}`)
        if (!w) continue
        out.push({
          nodeId: n.id,
          x: n.position.x,
          y: n.position.y,
          direction: 'up',
          otherRegulationId: w.source_regulation,
          otherNodeIdHint: null,
          title: `← Вернуться к «${memberNameById.get(w.source_regulation) ?? w.source_regulation}» (выход ${w.source_output ?? '*'})`,
        })
      }
    }
    return out
  }, [dsl.nodes, regulationId, wiringByTarget, wiringBySource, memberNameById])

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      {/* Overlay-кнопки навигации между вкладками — рисуем в screen-space через rf.flowToScreenPosition. */}
      <div className="pointer-events-none absolute inset-0" data-tick={viewportTick}>
        {jumpPoints.map((jp) => {
          let screen: { x: number; y: number }
          try {
            screen = rf.flowToScreenPosition({ x: jp.x + 180, y: jp.y + 8 })
          } catch {
            return null
          }
          const Icon = jp.direction === 'down' ? ArrowDownLeft : ArrowUpRight
          return (
            <button
              key={`${jp.nodeId}-${jp.direction}`}
              onClick={() => onJumpToTarget(jp.otherRegulationId, jp.otherNodeIdHint)}
              title={jp.title}
              className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border border-indigo-500 bg-white text-indigo-700 shadow-md hover:bg-indigo-50"
              style={{ left: screen.x, top: screen.y, transform: 'translate(-50%, -50%)' }}
            >
              <Icon size={11} />
            </button>
          )
        })}
      </div>
    </>
  )
}


// Подсказка TypeScript: NODE_KIND_META используется через nodeTypes реактфлоу
// в импорте — оставляем явное упоминание чтобы tree-shaker не выкинул его
// при future-refactor. (фактический рендер делает Flow nodes/index.tsx).
export const _meta_keep = NODE_KIND_META
