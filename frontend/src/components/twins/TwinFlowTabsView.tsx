import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { ArrowDownLeft, ArrowUpRight, Link2, X } from 'lucide-react'
import { api, NODE_KIND_META, type FlowNode, type NodeKind, type Process, type ProcessWiringEntry, type RuleDSL } from '@/lib/api'
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
  // Узел, кликнутый на канвасе текущей вкладки. Используется для карточки
  // деталей справа. Сбрасывается при смене вкладки — selection не имеет
  // смысла на другом регламенте.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (members.length > 0 && !members.some((m) => m.id === activeTab)) {
      setActiveTab(members[0].id)
    }
  }, [members, activeTab])

  // При смене вкладки сбрасываем selection — другой регламент другие узлы.
  useEffect(() => {
    setSelectedNodeId(null)
  }, [activeTab])

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
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                wiredTargetParamRefs={
                  new Set(
                    (twin.wiring ?? [])
                      .filter((w) => w.target_regulation === activeTab)
                      .map((w) => w.target_param_ref),
                  )
                }
                wiredSourceOutputs={
                  // Симметрично «входу»: подсвечиваем output-узлы на ВКЛАДКЕ-
                  // ИСТОЧНИКЕ — те, чьи action упомянуты в wiring как source.
                  // null в source_output ⇒ «любой выход» — это значит ВСЕ
                  // output-ноды текущего регламента-источника подсвечиваются.
                  // Маркируем такой случай sentinel'ом '*' и TabCanvas обходит
                  // его специально.
                  new Set(
                    (twin.wiring ?? [])
                      .filter((w) => w.source_regulation === activeTab)
                      .map((w) => w.source_output ?? '*'),
                  )
                }
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
          selectedNodeId={selectedNodeId}
          onClearSelection={() => setSelectedNodeId(null)}
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
  selectedNodeId,
  onSelectNode,
  wiredTargetParamRefs,
  wiredSourceOutputs,
}: {
  regulationId: string
  dsl: RuleDSL
  focusedNodeId: string | null
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  /** Param-refs целевых входов, которые приходят wiring'ом из Twin'а.
   *  Используется для постоянной индиго-подсветки (anim flow-wired-pulse)
   *  входов, в которые «приземляются» выходы других регламентов. */
  wiredTargetParamRefs: Set<string>
  /** Action'ы output-узлов, чьи данные wiring отправляет в другие регламенты.
   *  Sentinel '*' ⇒ «любой output» (wiring без указания action) → подсвечиваем
   *  все output-узлы на этой вкладке. Симметрично wiredTargetParamRefs. */
  wiredSourceOutputs: Set<string>
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

  // Узлы которые надо постоянно подсвечивать (индиго-пульс):
  //   • sensor[sourceKind='regulation'] на bindsTo input, чей paramRef
  //     упомянут в wiring как target → точка ПРИХОДА данных извне.
  //     Fallback (если sensor'а нет) — сам input-узел.
  //   • output-узлы текущего регламента, чьи action упомянуты в wiring
  //     как source → точка УХОДА данных к другому регламенту.
  //     Sentinel '*' = wiring без action ⇒ подсвечиваем ВСЕ output-ноды.
  const wiredNodeIds = useMemo(() => {
    const out = new Set<string>()
    // Target side — куда приходит вход.
    if (wiredTargetParamRefs.size > 0) {
      const inputByParam = new Map<string, string>()
      for (const n of dsl.nodes) {
        if (n.type === 'input' && n.paramRef) inputByParam.set(n.paramRef, n.id)
      }
      for (const param of wiredTargetParamRefs) {
        const inputId = inputByParam.get(param)
        if (!inputId) continue
        const sensor = dsl.nodes.find(
          (n) => n.type === 'sensor' && n.bindsTo === inputId,
        )
        out.add(sensor ? sensor.id : inputId)
      }
    }
    // Source side — откуда уходит выход.
    if (wiredSourceOutputs.size > 0) {
      const wildcard = wiredSourceOutputs.has('*')
      for (const n of dsl.nodes) {
        if (n.type !== 'output') continue
        if (wildcard || (n.action && wiredSourceOutputs.has(n.action))) {
          out.add(n.id)
        }
      }
    }
    return out
  }, [dsl.nodes, wiredTargetParamRefs, wiredSourceOutputs])

  const rfNodes: Node<FlowNode>[] = useMemo(() => {
    return dsl.nodes.map((n) => {
      const classes: string[] = []
      if (focusedNodeId === n.id) classes.push('flow-jump-focused')
      if (wiredNodeIds.has(n.id)) classes.push('flow-wired-input')
      return {
        id: n.id,
        type: n.type,
        data: n,
        position: n.position ?? { x: 0, y: 0 },
        // reactflow сам подсветит selected через `selected: true` — этот
        // флаг также включает .rf-node--selected стиль (ring) в BaseNode.
        selected: selectedNodeId === n.id,
        className: classes.length ? classes.join(' ') : undefined,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        connectable: false,
        deletable: false,
      }
    })
  }, [dsl.nodes, focusedNodeId, wiredNodeIds, selectedNodeId])

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
      // Клик по ноде → выделение + карточка деталей в правой панели.
      // Клик по пустому месту канваса — снять выделение.
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
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
  selectedNodeId,
  onClearSelection,
}: {
  twin: Process
  regulationId: string
  activeFlow: RuleDSL | null
  memberNameById: Map<string, string>
  onJump: (regulationId: string, nodeId: string | null) => void
  selectedNodeId: string | null
  onClearSelection: () => void
}) {
  // Если что-то кликнуто на канвасе — находим узел для рендера карточки сверху.
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !activeFlow) return null
    return activeFlow.nodes.find((n) => n.id === selectedNodeId) ?? null
  }, [selectedNodeId, activeFlow])
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
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto bg-white p-2 text-xs">
      {/* Карточка деталей кликнутого узла (если что-то выделено). Сверху,
          чтобы детали под рукой; навигация по связям остаётся ниже. */}
      {selectedNode && (
        <SelectedNodeCard
          node={selectedNode}
          allNodes={activeFlow?.nodes ?? []}
          onClear={onClearSelection}
        />
      )}
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


// ── Карточка деталей выделенного узла канваса ─────────────────────────


/**
 * Read-only «инспектор» одного flow-node — короткая карточка справа в
 * NavigationSidebar. Показывает type-specific поля (paramRef для input,
 * refValue/deviation для threshold, expression для formula, action/text
 * для output, sensorSubtype/sourceKind для sensor и т.д.).
 *
 * Не редактирует ничего — двойник смотрит на регламенты как на data;
 * правка живёт только в Flow Editor конкретного регламента.
 */
function SelectedNodeCard({
  node,
  allNodes,
  onClear,
}: {
  node: FlowNode
  allNodes: FlowNode[]
  onClear: () => void
}) {
  const meta = NODE_KIND_META[node.type as NodeKind]
  const Icon = meta?.icon

  // Helper: hyperlink-style row «label → value».
  const Row = ({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      <span className={cn('text-[11px] text-stone-800', mono && 'font-mono')}>{value}</span>
    </div>
  )

  // Type-specific блок.
  const details: ReactNode[] = []
  if (node.label) {
    details.push(<Row key="label" label="Метка" value={node.label} />)
  }
  switch (node.type) {
    case 'input':
      if (node.paramRef) details.push(<Row key="param" label="Параметр" value={node.paramRef} mono />)
      break
    case 'threshold':
      if (node.refValue != null) details.push(<Row key="ref" label="Эталон" value={node.refValue} mono />)
      if (node.deviation != null) details.push(<Row key="dev" label="Отклонение ±" value={node.deviation} mono />)
      if (node.unit) details.push(<Row key="unit" label="Ед. изм." value={node.unit} />)
      break
    case 'compare':
      if (node.operator) details.push(<Row key="op" label="Оператор" value={node.operator} mono />)
      break
    case 'formula':
      if (node.expression) {
        details.push(
          <Row
            key="expr"
            label="Выражение"
            value={
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded border border-stone-700 bg-stone-900 p-1.5 font-mono text-[10px] leading-snug text-emerald-200">
                {node.expression}
              </pre>
            }
          />,
        )
      }
      break
    case 'switch':
      if (node.cases?.length) {
        details.push(
          <Row
            key="cases"
            label={`Ветки (${node.cases.length})`}
            value={
              <ul className="mt-0.5 list-disc pl-4 text-[10px] leading-snug">
                {node.cases.map((c, i) => (
                  <li key={i}><b>{c.label}</b>: <span className="font-mono">{String(c.value ?? '')}</span></li>
                ))}
              </ul>
            }
          />,
        )
      }
      break
    case 'output':
      if (node.action) details.push(<Row key="action" label="Действие" value={node.action} mono />)
      if (node.priority) details.push(<Row key="prio" label="Приоритет" value={node.priority} mono />)
      if (node.text) details.push(<Row key="text" label="Текст рекомендации" value={node.text} />)
      break
    case 'shacl_constraint':
      if (node.constraintRef) details.push(<Row key="cref" label="SHACL ref" value={node.constraintRef} mono />)
      break
    case 'sensor': {
      const kind = node.sourceKind ?? 'sensor'
      details.push(
        <Row
          key="srcKind"
          label="Источник"
          value={kind === 'regulation' ? '← Другой регламент (wiring двойника)' : 'Физический датчик'}
        />,
      )
      if (kind === 'regulation') {
        if (node.sourceRegulationId) {
          details.push(<Row key="srcReg" label="Регламент-источник" value={node.sourceRegulationId} mono />)
        } else {
          details.push(
            <Row
              key="placeholder"
              label="Состояние"
              value="placeholder — задайте wiring в секции «Связи»"
            />,
          )
        }
        if (node.sourceOutputAction) {
          details.push(<Row key="srcOut" label="Выход (action)" value={node.sourceOutputAction} mono />)
        }
      } else {
        if (node.sensorType) details.push(<Row key="sType" label="Класс датчика" value={node.sensorType} mono />)
        if (node.sensorSubtype) details.push(<Row key="sSub" label="Подтип" value={node.sensorSubtype} mono />)
        if (node.externalId) details.push(<Row key="ext" label="External ID" value={node.externalId} mono />)
      }
      // bindsTo → ищем input для контекста.
      if (node.bindsTo) {
        const input = allNodes.find((x) => x.id === node.bindsTo)
        const inputLabel = input ? (input.paramRef ?? input.label ?? input.id) : node.bindsTo
        details.push(<Row key="binds" label="Привязан к входу" value={inputLabel} mono />)
      }
      break
    }
  }

  return (
    <div className="mb-3 rounded-md border border-violet-200 bg-violet-50/40 p-2">
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          {Icon && <Icon size={11} />}
          {meta?.label ?? node.type}
        </div>
        <button
          onClick={onClear}
          title="Снять выделение"
          className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <X size={11} />
        </button>
      </div>
      {details.length === 0 ? (
        <div className="text-[10px] text-stone-500">У узла нет настроенных полей.</div>
      ) : (
        <div className="flex flex-col gap-1.5">{details}</div>
      )}
      <div className="mt-2 border-t border-violet-200 pt-1.5 font-mono text-[9px] text-violet-500">
        id: {node.id}
      </div>
    </div>
  )
}
