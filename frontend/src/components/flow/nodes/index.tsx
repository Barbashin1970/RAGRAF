import { Position, type NodeProps, type NodeTypes } from 'reactflow'
import {
  AudioWaveform,
  Camera,
  Gauge,
  Radar,
  Thermometer,
  Volume2,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { SENSOR_TYPE_META, type FlowNode, type SensorType } from '@/lib/api'
import { BaseNode } from './BaseNode'

// Иконка по типу физического датчика. Когда юзер собирает поток в духе
// «снаружи внутрь», по форме иконки сразу видно «это манометр» / «это
// расходомер» / «это камера» — не нужно лезть в PropertyPanel.
//   p     → Gauge        (классическая стрелочная шкала манометра)
//   t     → Thermometer
//   flow  → Waves        (поток воды)
//   noise → Volume2      (динамик / акустика)
//   detector → Camera    (CCTV)
//   fiber → AudioWaveform (DAS-сигнал вдоль волокна)
//   air   → Wind          (атмосфера, качество воздуха)
const SENSOR_TYPE_ICON: Record<SensorType, LucideIcon> = {
  p: Gauge,
  t: Thermometer,
  flow: Waves,
  noise: Volume2,
  detector: Camera,
  fiber: AudioWaveform,
  air: Wind,
}

// Все семь типов используют одинаковый BaseNode-chrome (icon-pill, kind only).
// Отличия только в handles. User-label и параметры — только в правой
// PropertyPanel (Node-RED-style: канвас = структура, панель = детали).

// Input получает левый target-handle, чтобы visual sensor→input edge мог
// зацепиться (иначе наша sensor-нода рисует выход в пустоту — ребро есть,
// порта нет). `isValidConnection` в FlowCanvas разрешает попадание только
// из sensor-нод — это сохраняет старую семантику «input = начало цепочки».
function InputNode(p: NodeProps<FlowNode>) {
  return (
    <BaseNode
      {...p}
      inputs={[{ id: 'sensor-in', position: Position.Left }]}
      outputs={[{ position: Position.Right }]}
    />
  )
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
  // SHACL — лист (валидатор upstream-значения). Outputs убраны: edge'и из
  // SHACL никуда не идут в фикстурах + executor не пробрасывает сигнал
  // дальше. Раньше outputs={Right} был визуальной ложью.
  return <BaseNode {...p} inputs={[{ position: Position.Left }]} />
}

// Sensor — точка входа из ETL: только выход, без входов. Визуально кружок
// (см. .rf-node--sensor в styles.css), отличающий «внешний сигнал» от
// «внутреннего параметра регламента» (input-rect).
//
// Иконка и подпись зависят от sensorType: «манометр», «термометр»,
// «расходомер» и т.д. (см. SENSOR_TYPE_ICON / SENSOR_TYPE_META). Если тип
// не выбран — обобщённый Radar и метка «Датчик».
function SensorNode(p: NodeProps<FlowNode>) {
  const stype = p.data.sensorType
  const icon = stype ? SENSOR_TYPE_ICON[stype] : Radar
  const label = stype ? SENSOR_TYPE_META[stype].label : 'Датчик'
  return (
    <BaseNode
      {...p}
      outputs={[{ position: Position.Right }]}
      iconOverride={icon}
      labelOverride={label}
    />
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
  sensor:            SensorNode,
}
