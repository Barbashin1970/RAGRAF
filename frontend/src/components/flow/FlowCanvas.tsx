import { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
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
import type { FlowNode, NodeKind } from '@/lib/api'

interface Props {
  nodes: Node[]
  edges: Edge[]
  onChange: (next: { nodes: Node[]; edges: Edge[] }) => void
  onSelect: (node: Node | null) => void
}

function FlowCanvasInner({ nodes, edges, onChange, onSelect }: Props) {
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const [, setRevision] = useState(0)

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

  const onConnect = useCallback(
    (c: Connection) => {
      const next = addEdge({ ...c, type: 'smoothstep' }, edges)
      onChange({ nodes, edges: next })
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
      const type = e.dataTransfer.getData('application/reactflow-type') as NodeKind
      if (!type) return
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
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
