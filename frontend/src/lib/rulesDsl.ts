import type { Edge, Node } from 'reactflow'
import type { FlowEdge, FlowNode, RuleDSL } from './api'

export function dslToFlow(dsl: RuleDSL): { nodes: Node[]; edges: Edge[] } {
  // Auto-layout when nodes have no positions: simple horizontal column by topo order.
  const positions = computeFallbackPositions(dsl)
  const nodes: Node[] = dsl.nodes.map((n, i) => ({
    id: n.id,
    type: n.type,
    position: n.position ?? positions[n.id] ?? { x: 60 + i * 200, y: 120 },
    data: { ...n },
  }))
  const edges: Edge[] = dsl.edges.map((e) => ({
    id: `${e.source}__${e.target}`,
    source: e.source,
    target: e.target,
    label: e.condition || undefined,
    type: 'smoothstep',
    animated: !!e.condition,
  }))
  return { nodes, edges }
}

export function flowToDsl(
  meta: Pick<RuleDSL, 'rule_id' | 'regulation_id'>,
  nodes: Node[],
  edges: Edge[],
): RuleDSL {
  const outNodes: FlowNode[] = nodes.map((n) => ({
    ...(n.data as FlowNode),
    id: n.id,
    type: n.type as FlowNode['type'],
    position: n.position,
  }))
  const outEdges: FlowEdge[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    condition: (e.label as string) || null,
  }))
  return { ...meta, nodes: outNodes, edges: outEdges }
}

// Very small layered layout — works for the typical input→threshold→compare→output rule.
function computeFallbackPositions(dsl: RuleDSL): Record<string, { x: number; y: number }> {
  const inEdges = new Map<string, string[]>()
  const outEdges = new Map<string, string[]>()
  for (const n of dsl.nodes) {
    inEdges.set(n.id, [])
    outEdges.set(n.id, [])
  }
  for (const e of dsl.edges) {
    inEdges.get(e.target)?.push(e.source)
    outEdges.get(e.source)?.push(e.target)
  }
  const level = new Map<string, number>()
  const queue: string[] = []
  for (const n of dsl.nodes) {
    if ((inEdges.get(n.id) ?? []).length === 0) {
      level.set(n.id, 0)
      queue.push(n.id)
    }
  }
  while (queue.length) {
    const id = queue.shift()!
    const lvl = level.get(id) ?? 0
    for (const next of outEdges.get(id) ?? []) {
      const cur = level.get(next)
      if (cur === undefined || cur < lvl + 1) {
        level.set(next, lvl + 1)
        queue.push(next)
      }
    }
  }
  const byLevel = new Map<number, string[]>()
  for (const n of dsl.nodes) {
    const l = level.get(n.id) ?? 0
    if (!byLevel.has(l)) byLevel.set(l, [])
    byLevel.get(l)!.push(n.id)
  }
  const positions: Record<string, { x: number; y: number }> = {}
  for (const [lvl, ids] of byLevel) {
    ids.forEach((id, idx) => {
      positions[id] = { x: 80 + lvl * 220, y: 60 + idx * 120 }
    })
  }
  return positions
}
