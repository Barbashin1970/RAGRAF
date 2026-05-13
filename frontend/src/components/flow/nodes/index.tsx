import { Position, type NodeProps, type NodeTypes } from 'reactflow'
import type { FlowNode } from '@/lib/api'
import { BaseNode } from './BaseNode'

// All seven node types share BaseNode chrome; differences are handles + body fields.

function InputNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode {...p} outputs={[{ position: Position.Right }]}>
      {p.data.paramRef && (
        <div className="mt-0.5 text-xs text-stone-600">парам: <b>{p.data.paramRef}</b></div>
      )}
    </BaseNode>
  )
}

function ThresholdNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]}>
      {p.data.refValue !== null && p.data.refValue !== undefined && (
        <div className="mt-0.5 text-xs text-stone-600">
          {p.data.refValue}{' '}
          {p.data.deviation !== null && p.data.deviation !== undefined && <>± {p.data.deviation}</>}{' '}
          {p.data.unit && <span className="text-stone-400">{p.data.unit}</span>}
        </div>
      )}
    </BaseNode>
  )
}

function CompareNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode
      {...p}
      inputs={[
        { id: 'value', position: Position.Left },
        { id: 'range', position: Position.Top },
      ]}
      outputs={[
        { id: 'true', position: Position.Right },
        { id: 'false', position: Position.Bottom },
      ]}
    >
      {p.data.operator && <div className="mt-0.5 text-xs text-stone-600">op: <b>{p.data.operator}</b></div>}
    </BaseNode>
  )
}

function FormulaNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]}>
      {p.data.expression && (
        <div className="mt-0.5 truncate font-mono text-[11px] text-stone-600">{p.data.expression}</div>
      )}
    </BaseNode>
  )
}

function SwitchNode(p: NodeProps<FlowNode>) {
  const cases = p.data.cases ?? []
  return (
    <BaseNode
      {...p}
      inputs={[{ position: Position.Left }]}
      outputs={cases.length > 0
        ? cases.map((c, i) => ({ id: `case-${i}`, label: c.label, position: Position.Right }))
        : [{ position: Position.Right }]}
    >
      {cases.length > 0 && <div className="mt-0.5 text-xs text-stone-600">{cases.length} ветв.</div>}
    </BaseNode>
  )
}

function OutputNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode {...p} inputs={[{ position: Position.Left }]}>
      {p.data.text && <div className="mt-0.5 line-clamp-2 text-xs text-stone-700">{p.data.text}</div>}
      {p.data.priority && <div className="mt-0.5 text-[10px] text-stone-500">приоритет {p.data.priority}</div>}
    </BaseNode>
  )
}

function ShaclConstraintNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]}>
      {p.data.constraintRef && (
        <div className="mt-0.5 font-mono text-[11px] text-stone-600">{p.data.constraintRef}</div>
      )}
    </BaseNode>
  )
}

export const nodeTypes: NodeTypes = {
  input:             InputNode,
  threshold:         ThresholdNode,
  compare:           CompareNode,
  formula:           FormulaNode,
  switch:            SwitchNode,
  output:            OutputNode,
  shacl_constraint:  ShaclConstraintNode,
}
