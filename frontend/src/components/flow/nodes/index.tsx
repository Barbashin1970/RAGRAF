import { Position, type NodeProps, type NodeTypes } from 'reactflow'
import type { FlowNode } from '@/lib/api'
import { BaseNode } from './BaseNode'

// Все семь типов используют одинаковый BaseNode-chrome (icon-pill, kind only).
// Отличия только в handles. User-label и параметры — только в правой
// PropertyPanel (Node-RED-style: канвас = структура, панель = детали).

function InputNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} outputs={[{ position: Position.Right }]} />
}

function ThresholdNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]} />
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
    />
  )
}

function FormulaNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]} />
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
    />
  )
}

function OutputNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} inputs={[{ position: Position.Left }]} />
}

function ShaclConstraintNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} inputs={[{ position: Position.Left }]} outputs={[{ position: Position.Right }]} />
}

// Sensor — точка входа из ETL: только выход, без входов. Визуально кружок
// (см. .rf-node--sensor в styles.css), отличающий «внешний сигнал» от
// «внутреннего параметра регламента» (input-rect).
function SensorNode(p: NodeProps<FlowNode>) {
  return <BaseNode {...p} outputs={[{ position: Position.Right }]} />
}

export const nodeTypes: NodeTypes = {
  input:             InputNode,
  threshold:         ThresholdNode,
  compare:           CompareNode,
  formula:           FormulaNode,
  switch:            SwitchNode,
  output:            OutputNode,
  shacl_constraint:  ShaclConstraintNode,
  sensor:            SensorNode,
}
