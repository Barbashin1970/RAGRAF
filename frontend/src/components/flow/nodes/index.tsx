import { useMemo } from 'react'
import { Position, type NodeProps, type NodeTypes } from 'reactflow'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AudioWaveform,
  Camera,
  ExternalLink,
  Gauge,
  Radar,
  Send,
  Thermometer,
  Volume2,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { api, SENSOR_TYPE_META, type FlowNode, type SensorType } from '@/lib/api'
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

// Sensor (technical NodeKind, user-facing label «Событие») — точка входа в
// поток. Это либо физический датчик из ETL, либо output другого регламента
// (sourceKind='regulation'). Визуально:
//   • sensor mode  — кружок-Radar/манометр/термометр/… в orange тоне.
//   • regulation mode — кружок-самолётик (Send) в indigo тоне; на правом углу
//     overlay-кнопка перехода в регламент-источник. Click-through ведёт в
//     /regulations/{sourceRegulationId}/edit.
//
// Иконка и подпись sensor-режима зависят от sensorType: «манометр»,
// «термометр», «расходомер» и т.д. Если тип не выбран — обобщённый Radar и
// метка «Событие».
function SensorNode(p: NodeProps<FlowNode>) {
  const kind = p.data.sourceKind ?? 'sensor'
  if (kind === 'regulation') {
    return <RegulationSourceNode {...p} />
  }
  const stype = p.data.sensorType
  const icon = stype ? SENSOR_TYPE_ICON[stype] : Radar
  // В sensor-режиме label = название класса датчика; если класс не задан —
  // нейтральное «Событие» (раньше было «Датчик»; нода теперь обобщённая —
  // любая событийность, не только физический сигнал).
  const label = stype ? SENSOR_TYPE_META[stype].label : 'Событие'
  return (
    <BaseNode
      {...p}
      outputs={[{ position: Position.Right }]}
      iconOverride={icon}
      labelOverride={label}
    />
  )
}

/**
 * Sensor-нода в режиме «событие из регламента». Резолвит имя регламента-
 * источника через /api/datasets (react-query кэширует, один запрос на сессию)
 * и рендерит:
 *   • метка: «← <Имя регламента> / <action>» (или «← <Имя регламента>» если
 *     action не выбран = «слушаю любой output источника»).
 *   • цвет: индиго; иконка-самолётик.
 *   • overlay-кнопка ↗ для перехода в /regulations/{id}/edit.
 *
 * Битые ссылки (action удалён в источнике) детектятся /output-actions, но
 * красная подсветка пока живёт только в PropertyPanel — на канвасе оставляем
 * чисто визуальный режим «регламент-источник». Расширим если попросят.
 */
function RegulationSourceNode(p: NodeProps<FlowNode>) {
  const navigate = useNavigate()
  const sourceId = p.data.sourceRegulationId
  const action = p.data.sourceOutputAction
  const { data: datasets = [] } = useQuery({
    queryKey: ['datasets-for-picker'],
    queryFn: () => api.datasets.list(),
    enabled: !!sourceId,
  })
  const srcName = useMemo(() => {
    if (!sourceId) return null
    const found = (datasets as Array<{ id?: string; name?: string }>).find(
      (d) => d?.id === sourceId,
    )
    return found?.name || sourceId
  }, [datasets, sourceId])

  // Текст-метка. Не задан источник → подсказка о необходимости настройки.
  let label = 'Событие из регламента'
  if (sourceId) {
    label = action
      ? `← ${srcName} · ${action}`
      : `← ${srcName}`
  }

  return (
    <div
      className="relative"
      onDoubleClick={(e) => {
        // Двойной клик = быстрый переход в регламент-источник. Одиночный
        // оставляем для select+редактирование в PropertyPanel (стандартное
        // поведение react-flow).
        if (sourceId) {
          e.stopPropagation()
          navigate(`/regulations/${encodeURIComponent(sourceId)}/edit`)
        }
      }}
      title={sourceId ? 'Двойной клик — открыть регламент-источник' : 'Выберите регламент-источник в PropertyPanel'}
    >
      <BaseNode
        {...p}
        outputs={[{ position: Position.Right }]}
        iconOverride={Send}
        labelOverride={label}
        classNameOverride="rf-node--regsource"
      />
      {sourceId && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/regulations/${encodeURIComponent(sourceId)}/edit`)
          }}
          className="absolute -right-2 -top-2 rounded-full border border-indigo-300 bg-white p-0.5 text-indigo-700 shadow-sm hover:bg-indigo-50"
          title="Открыть регламент-источник"
        >
          <ExternalLink size={10} />
        </button>
      )}
    </div>
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
