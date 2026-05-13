import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { RuleDSL } from './api'
import { dslToFlow, flowToDsl } from './rulesDsl'

const baseDsl: RuleDSL = {
  rule_id: 'r1',
  regulation_id: 'reg1',
  nodes: [
    { id: 'n1', type: 'input', label: 'давление', paramRef: 'pressure', position: { x: 0, y: 0 } },
    { id: 'n2', type: 'threshold', label: 'порог', refValue: 20.5, deviation: 1.5, position: { x: 200, y: 0 } },
    { id: 'n3', type: 'compare', label: 'cmp', operator: 'outside_range', position: { x: 400, y: 0 } },
    { id: 'n4', type: 'output', label: 'recommendation', text: 'Перекрыть', priority: 1, position: { x: 600, y: 0 } },
  ],
  edges: [
    { source: 'n1', target: 'n2' },
    { source: 'n2', target: 'n3' },
    { source: 'n3', target: 'n4', condition: 'true' },
  ],
}

describe('dslToFlow', () => {
  it('преобразует DSL в React Flow nodes и edges', () => {
    const { nodes, edges } = dslToFlow(baseDsl)
    expect(nodes).toHaveLength(4)
    expect(edges).toHaveLength(3)
    expect(nodes[0].id).toBe('n1')
    expect(nodes[0].type).toBe('input')
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('сохраняет label и подтаскивает param-ref в data', () => {
    const { nodes } = dslToFlow(baseDsl)
    const input = nodes.find((n) => n.id === 'n1')!
    expect((input.data as any).paramRef).toBe('pressure')
  })

  it('генерирует уникальный id ребра по схеме source__target', () => {
    const { edges } = dslToFlow(baseDsl)
    expect(edges[0].id).toBe('n1__n2')
  })

  it('подсасывает condition в label ребра', () => {
    const { edges } = dslToFlow(baseDsl)
    const last = edges[2]
    expect(last.label).toBe('true')
    expect(last.animated).toBe(true)
  })

  it('делает layered layout когда позиций нет', () => {
    const dsl: RuleDSL = {
      rule_id: 'r',
      regulation_id: 'reg',
      nodes: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'threshold' },
        { id: 'c', type: 'output' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    }
    const { nodes } = dslToFlow(dsl)
    const xByLevel = nodes.map((n) => n.position.x)
    // Должны расти от 0-го к 2-му узлу (level increasing left → right)
    expect(xByLevel[0]).toBeLessThan(xByLevel[1])
    expect(xByLevel[1]).toBeLessThan(xByLevel[2])
  })
})

describe('flowToDsl', () => {
  it('round-trip: DSL → flow → DSL сохраняет topology', () => {
    const { nodes, edges } = dslToFlow(baseDsl)
    const back = flowToDsl({ rule_id: baseDsl.rule_id, regulation_id: baseDsl.regulation_id }, nodes, edges)
    expect(back.nodes).toHaveLength(baseDsl.nodes.length)
    expect(back.edges).toHaveLength(baseDsl.edges.length)
    const byId = Object.fromEntries(back.nodes.map((n) => [n.id, n]))
    expect(byId['n2'].refValue).toBe(20.5)
    expect(byId['n2'].deviation).toBe(1.5)
  })

  it('сохраняет condition в ребре', () => {
    const { nodes, edges } = dslToFlow(baseDsl)
    const back = flowToDsl({ rule_id: 'r', regulation_id: 'reg' }, nodes, edges)
    const edge = back.edges.find((e) => e.target === 'n4')!
    expect(edge.condition).toBe('true')
  })

  it('новые узлы из canvas попадают в DSL', () => {
    const nodes: Node[] = [
      { id: 'new1', type: 'formula', position: { x: 100, y: 100 }, data: { id: 'new1', type: 'formula', expression: 'x > 0' } },
    ]
    const dsl = flowToDsl({ rule_id: 'r', regulation_id: 'reg' }, nodes, [])
    expect(dsl.nodes).toHaveLength(1)
    expect(dsl.nodes[0].expression).toBe('x > 0')
  })

  it('null condition сохраняется как null, не undefined', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b' },
    ]
    const nodes: Node[] = [
      { id: 'a', type: 'input', position: { x: 0, y: 0 }, data: { id: 'a', type: 'input' } },
      { id: 'b', type: 'output', position: { x: 100, y: 0 }, data: { id: 'b', type: 'output' } },
    ]
    const dsl = flowToDsl({ rule_id: 'r', regulation_id: 'reg' }, nodes, edges)
    expect(dsl.edges[0].condition).toBeNull()
  })
})
