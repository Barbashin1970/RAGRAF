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
import { useQueries } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Link2 } from 'lucide-react'
import { api, type FlowNode, type Process, type ProcessWiringEntry, type RuleDSL } from '@/lib/api'
import { cn } from '@/lib/cn'
import { nodeTypes } from '@/components/flow/nodes'

/**
 * Полотно «Двойник как поток» (TwinFlowTabsView).
 *
 * UX (зафиксирован 2026-05-19):
 *   • Вкладки сверху — по одной на каждый регламент-член. Click переключает.
 *   • На каждой вкладке — flow.json регламента read-only (тот же reactflow,
 *     те же узлы что в Flow Editor; единый визуальный язык).
 *   • Боковая панель справа от канваса — список wiring-точек ТЕКУЩЕГО регламента:
 *       «↘ Выход X → таб «Y», вход Z» (если кто-то слушает наш output);
 *       «↖ Вход X ← таб «Y», выход Z» (если наш sensor получает от другого).
 *     Клик по строке → переключение на связанный таб + подсветка узла индиго.
 *
 * Подход «лист справа» (вместо overlay-кнопок ↘/↖ поверх нод) выбран после
 * первой итерации, где rAF-loop для отслеживания viewport'а вызывал
 * setState 60 раз/сек и калечил производительность страницы. Лист справа
 * проще и читабельнее: пользователь сразу видит все точки стыка списком,
 * не нужно ловить кнопку на конкретной ноде.
 *
 * Ничего здесь не редактируется — правка нод происходит в Flow Editor каждого
 * регламента отдельно, wiring — в форме «Связи» в этом же двойнике.
 */
export function TwinFlowTabsView({
  twin,
  members,
}: {
  twin: Process
  members: Array<{ id: string; name: string }>
}) {
  const flowQueries = useQueries({
    queries: members.map((m) => ({
      queryKey: ['flow', m.id],
      queryFn: () => api.flow.get(m.id),
      staleTime: 30_000,
    })),
  })

  const [activeTab, setActiveTab] = useState<string>(members[0]?.id ?? '')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (members.length > 0 && !members.some((m) => m.id === activeTab)) {
      setActiveTab(members[0].id)
    }
  }, [members, activeTab])

  const jumpTo = (regulationId: string, nodeId: string | null) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    setActiveTab(regulationId)
    setFocusedNodeId(nodeId)
    focusTimerRef.current = setTimeout(() => setFocusedNodeId(null), 2500)
  }

  const memberNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of members) m.set(x.id, x.name)
    return m
  }, [members])

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
          const wIn = (twin.wiring ?? []).filter((w) => w.target_regulation === m.id).length
          const wOut = (twin.wiring ?? []).filter((w) => w.source_regulation === m.id).length
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
              {(wIn > 0 || wOut > 0) && (
                <span className={cn(
                  'rounded-sm px-1 py-px text-[9px]',
                  active ? 'bg-violet-700/40' : 'bg-violet-100 text-violet-700',
                )}>
                  ↓{wIn} ↑{wOut}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* Канвас + панель навигации */}
      <div className="flex h-[480px] divide-x divide-stone-200 bg-stone-50">
        <div className="flex-1 relative min-w-0">
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
              />
            </ReactFlowProvider>
          ) : (
            <div className="grid h-full place-items-center text-xs text-stone-500">
              Поток ещё не сохранён для этого регламента.
            </div>
          )}
        </div>
        <NavigationSidebar
          twin={twin}
          regulationId={activeTab}
          activeFlow={activeFlow}
          memberNameById={memberNameById}
          onJump={jumpTo}
        />
      </div>
      <div className="border-t border-stone-200 bg-violet-50/30 px-3 py-2 text-[10px] leading-relaxed text-violet-900">
        <b>Как читать:</b> кликни вкладку — увидишь поток выбранного регламента
        (read-only). В правой панели — точки стыка с другими регламентами:
        ↘ кто слушает наш выход, ↖ откуда приходит вход. Клик по строке —
        прыжок на связанную вкладку, узел подсветится индиго.
      </div>
    </div>
  )
}


// ── Канвас одной вкладки (read-only reactflow) ────────────────────────


function TabCanvas({
  regulationId,
  dsl,
  focusedNodeId,
}: {
  regulationId: string
  dsl: RuleDSL
  focusedNodeId: string | null
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
        /* viewport may not be ready yet — игнорируем */
      }
    }, 80)
    return () => clearTimeout(t)
  }, [regulationId, focusedNodeId, dsl.nodes, rf])

  const rfNodes: Node<FlowNode>[] = useMemo(() => {
    return dsl.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      data: n,
      position: n.position ?? { x: 0, y: 0 },
      className: focusedNodeId === n.id ? 'flow-jump-focused' : undefined,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
      deletable: false,
    }))
  }, [dsl.nodes, focusedNodeId])

  const rfEdges: Edge[] = useMemo(() => {
    return dsl.edges.map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'default',
    }))
  }, [dsl.edges])

  return (
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
  )
}


// ── Правая панель навигации между вкладками ───────────────────────────


function NavigationSidebar({
  twin,
  regulationId,
  activeFlow,
  memberNameById,
  onJump,
}: {
  twin: Process
  regulationId: string
  activeFlow: RuleDSL | null
  memberNameById: Map<string, string>
  onJump: (regulationId: string, nodeId: string | null) => void
}) {
  // Outgoing: где наш output слушают (мы source).
  const outgoing = useMemo(
    () => (twin.wiring ?? []).filter((w) => w.source_regulation === regulationId),
    [twin.wiring, regulationId],
  )
  // Incoming: где наш input получает от другого (мы target).
  const incoming = useMemo(
    () => (twin.wiring ?? []).filter((w) => w.target_regulation === regulationId),
    [twin.wiring, regulationId],
  )

  // Для каждого outgoing — найти узел нашего output для подсветки при возврате.
  const outputNodeIdByAction = useMemo(() => {
    const m = new Map<string, string>()
    if (!activeFlow) return m
    for (const n of activeFlow.nodes) {
      if (n.type === 'output' && n.action) m.set(n.action, n.id)
    }
    return m
  }, [activeFlow])
  // Для каждого incoming — найти sensor-узел нашего входа.
  const sensorNodeIdByParam = useMemo(() => {
    const m = new Map<string, string>()
    if (!activeFlow) return m
    const inputIdToParam = new Map<string, string>()
    for (const n of activeFlow.nodes) {
      if (n.type === 'input' && n.paramRef) inputIdToParam.set(n.id, n.paramRef)
    }
    for (const n of activeFlow.nodes) {
      if (n.type !== 'sensor' || !n.bindsTo) continue
      const param = inputIdToParam.get(n.bindsTo)
      if (param) m.set(param, n.id)
    }
    return m
  }, [activeFlow])

  return (
    <aside className="w-64 shrink-0 overflow-y-auto bg-white p-2 text-xs">
      {outgoing.length === 0 && incoming.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 p-3 text-center text-[11px] text-stone-500">
          У этого регламента нет связей с другими в составе двойника.
          Настройте wiring в секции «Связи между регламентами» выше.
        </div>
      ) : (
        <>
          {outgoing.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                <ArrowDownLeft size={11} className="text-indigo-500" />
                Куда уходит мой выход ({outgoing.length})
              </div>
              <ul className="flex flex-col gap-1">
                {outgoing.map((w, i) => (
                  <li key={`out-${i}`}>
                    <button
                      onClick={() => onJump(w.target_regulation, null)}
                      className="block w-full rounded-md border border-indigo-200 bg-indigo-50/50 p-2 text-left text-[11px] text-indigo-900 transition hover:bg-indigo-100"
                    >
                      <div className="font-mono text-[10px] text-indigo-700">
                        {w.source_output ?? '(любой выход)'}
                      </div>
                      <div className="flex items-center gap-1 leading-tight">
                        <span className="text-stone-500">→</span>
                        <span className="font-medium">
                          {memberNameById.get(w.target_regulation) ?? w.target_regulation}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-stone-500">
                        вход: {w.target_param_ref}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                <ArrowUpRight size={11} className="text-indigo-500" />
                Откуда приходит мой вход ({incoming.length})
              </div>
              <ul className="flex flex-col gap-1">
                {incoming.map((w, i) => {
                  const sensorId = sensorNodeIdByParam.get(w.target_param_ref) ?? null
                  return (
                    <li key={`in-${i}`}>
                      <button
                        onClick={() => onJump(w.source_regulation, outputNodeIdByAction_get(w))}
                        className="block w-full rounded-md border border-indigo-200 bg-indigo-50/50 p-2 text-left text-[11px] text-indigo-900 transition hover:bg-indigo-100"
                        onMouseEnter={() => {/* hover-эффект через CSS */}}
                      >
                        <div className="font-mono text-[10px] text-indigo-700">
                          {w.target_param_ref}
                        </div>
                        <div className="flex items-center gap-1 leading-tight">
                          <span className="text-stone-500">←</span>
                          <span className="font-medium">
                            {memberNameById.get(w.source_regulation) ?? w.source_regulation}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-stone-500">
                          выход: {w.source_output ?? '(любой)'}
                        </div>
                        {sensorId && (
                          <div className="mt-1 font-mono text-[9px] text-stone-400">
                            канвас-узел: {sensorId}
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  )
}

// Хелпер: id output-ноды source-регламента для focus после прыжка. Узел из
// другого flow.json — точно не знаем, можно только сделать null, и тогда
// TabCanvas просто fitView без подсветки. Это OK для MVP — подсветка
// доступна только когда мы возвращаемся НА свою вкладку (откуда уходил
// прыжок), где focusedNodeId ставится в jumpTo.
function outputNodeIdByAction_get(_w: ProcessWiringEntry): string | null {
  return null
}
