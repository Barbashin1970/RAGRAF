import { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from 'reactflow'
import { nanoid } from '@/lib/nanoid'
import { nodeTypes } from './nodes'
import { isNodeKind, type FlowNode, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

interface Props {
  nodes: Node[]
  edges: Edge[]
  onChange: (next: { nodes: Node[]; edges: Edge[] }) => void
  onSelect: (node: Node | null) => void
}

// ── Connection rules ─────────────────────────────────────────────────────
//
// Семантические ограничения, что куда можно подключать. Делают `isValidConnection`
// дешёвой O(1)-проверкой и помечают невалидные handle'ы визуально (см. styles.css:
// `.react-flow__handle.connectionindicator` подсвечивается только если бэк-валидация
// разрешила соединение).
//
// Принцип: вершины — направленные. `sensor` стартует поток, `output` его заканчивает.
// Между ними — любая логика. `input` особенный: он не self-source (значение приходит
// из `sensor`), поэтому единственный валидный предок — `sensor`.
function isAllowedConnection(srcType: NodeKind, tgtType: NodeKind): boolean {
  // Output — терминал, исходящих рёбер нет.
  if (srcType === 'output') return false
  // SHACL — тоже терминал (валидатор-лист): edge В SHACL разрешён, ИЗ — нет.
  // Раньше из SHACL можно было тянуть рёбра, но executor сигнал не
  // пробрасывал — была визуальная ложь. Теперь явный запрет.
  if (srcType === 'shacl_constraint') return false
  // Sensor — только в input (он именно к нему привязывается через bindsTo).
  if (srcType === 'sensor') return tgtType === 'input'
  // В sensor никто не должен входить.
  if (tgtType === 'sensor') return false
  return true
}

function getNodeType(n: Node | undefined): NodeKind | null {
  if (!n) return null
  return ((n.data as FlowNode | undefined)?.type ?? (n.type as NodeKind | undefined)) ?? null
}

function FlowCanvasInner({ nodes, edges, onChange, onSelect }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const [, setRevision] = useState(0)
  // Включаем `.ragraf-connecting` на wrapper'е во время активного drag'а
  // соединения — CSS под этим классом раскрашивает все валидные target-handles
  // (см. styles.css §«Connection UX»).
  const [connecting, setConnecting] = useState(false)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes)
      onChange({ nodes: next, edges })
    },
    [nodes, edges, onChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, edges)
      onChange({ nodes, edges: next })
    },
    [nodes, edges, onChange],
  )

  // Семантическая валидация — что куда тянем. Возвращаемый false:
  //   а) подсвечивает невалидные target'ы как «нельзя» (no-drop курсор)
  //   б) запрещает реальный onConnect — ребро не добавится при release
  // ReactFlow вызывает её многократно во время drag'а, поэтому она должна
  // быть дешёвой — useCallback + O(1) проверки.
  const isValidConnection = useCallback((c: Connection) => {
    if (!c.source || !c.target) return false
    if (c.source === c.target) return false  // self-loop
    const srcType = getNodeType(nodes.find((n) => n.id === c.source))
    const tgtType = getNodeType(nodes.find((n) => n.id === c.target))
    if (!srcType || !tgtType) return false
    if (!isAllowedConnection(srcType, tgtType)) return false
    // Дубликаты (та же пара source→target) запрещаем — иначе на канвасе
    // оседают «двойные» рёбра, которые невозможно отличить.
    if (edges.some((e) => e.source === c.source && e.target === c.target)) return false
    return true
  }, [nodes, edges])

  const onConnect = useCallback(
    (c: Connection) => {
      // Базовый случай: добавить ребро (smoothstep сохраняем — совпадает с
      // дефолтом dslToFlow).
      const nextEdges = addEdge({ ...c, type: 'smoothstep' }, edges)

      // UX-плюшка: sensor → input ребро автоматически проставляет
      // sensor.bindsTo = id input-ноды. Без этого пользователь должен был бы
      // вручную вписывать ID в PropertyPanel — несколько лишних кликов на то,
      // что уже визуально показано рёбром. Эквивалентно: «связь — это и есть
      // bindsTo, нечего синхронизировать вручную».
      let nextNodes = nodes
      if (c.source && c.target) {
        const src = nodes.find((n) => n.id === c.source)
        const srcType = getNodeType(src)
        if (srcType === 'sensor' && src) {
          nextNodes = nodes.map((n) =>
            n.id === c.source
              ? { ...n, data: { ...(n.data as FlowNode), bindsTo: c.target } }
              : n,
          )
        }
      }
      onChange({ nodes: nextNodes, edges: nextEdges })
    },
    [nodes, edges, onChange],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      // sigma R6: drop из палитры — drag-string. Сужаем через type-guard
      // вместо `as NodeKind` — если придёт левый mime/значение, тихо игнорим.
      const raw = e.dataTransfer.getData('application/reactflow-type')
      if (!isNodeKind(raw)) return
      const type = raw
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = `n_${nanoid(6)}`
      const data: FlowNode = { id, type, label: '' }
      const newNode: Node = { id, type, position, data }
      onChange({ nodes: [...nodes, newNode], edges })
      setRevision((x) => x + 1)
    },
    [nodes, edges, onChange, screenToFlowPosition],
  )

  return (
    <div ref={wrapper} className={cn('h-full w-full', connecting && 'ragraf-connecting')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => setConnecting(true)}
        // onConnectEnd срабатывает И при удачном соединении, И при «бросили
        // в пустоту» — оба случая значат «drag окончен», выключаем подсветку.
        onConnectEnd={() => setConnecting(false)}
        isValidConnection={isValidConnection}
        // Радиус «магнитного» захвата handle'а: дефолт 20px → 45px. Юзеру
        // не надо целиться пиксель-в-пиксель, линия сама прилипает к ближайшему.
        connectionRadius={45}
        connectionLineType={ConnectionLineType.SmoothStep}
        // Линия во время drag — приметная teal-нить (совпадает с цветом sensor-
        // ноды). После релиза перерисовывается как обычное smoothstep ребро.
        connectionLineStyle={{
          stroke: 'rgb(13, 148, 136)',  // teal-600
          strokeWidth: 2.5,
          strokeDasharray: '6 3',
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSelectionChange={(p) => onSelect(p.nodes[0] ?? null)}
        fitView
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
