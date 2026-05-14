import { Handle, Position, type NodeProps } from 'reactflow'
import { useFlowStore } from '@/store/flowStore'
import { NODE_KIND_META, type FlowNode, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

interface BaseNodeProps extends NodeProps<FlowNode> {
  /** Visual handles config */
  inputs?: Array<{ id?: string; position?: Position; label?: string }>
  outputs?: Array<{ id?: string; position?: Position; label?: string }>
}

/**
 * Node-RED-style split node: тёмная icon-секция слева + светлая body справа.
 * Структура: `.rf-node > [.rf-node__icon, .rf-node__body, Handle, status-bar]`.
 *
 * Цвет тона и иконка берутся из NODE_KIND_META (см. lib/api.ts).
 * Статус-индикатор под нодой отображает результат валидатора:
 *  - зелёный «ok» — узел валиден
 *  - красный «error» — есть ошибки из useFlowStore
 *
 * Эта визуальная схема узнаваема для пользователей которые видели Node-RED /
 * n8n / Camunda Modeler — снижает порог входа в редактор Flow.
 */
export function BaseNode({
  id,
  data,
  type,
  selected,
  inputs = [],
  outputs = [],
  children,
}: BaseNodeProps & { children?: React.ReactNode }) {
  const kind = (type ?? data.type) as NodeKind
  const meta = NODE_KIND_META[kind]
  const errors = useFlowStore((s) => s.errorsByNode[id])
  const Icon = meta?.icon
  const hasError = !!(errors && errors.length > 0)

  return (
    <div className="flex flex-col items-stretch">
      <div
        className={cn(
          'rf-node',
          meta?.className,
          selected && 'rf-node--selected',
          hasError && 'rf-node--error',
        )}
        title={errors?.map((e) => e.message).join('\n')}
      >
        {inputs.map((h, i) => (
          <Handle
            key={`in-${i}`}
            id={h.id}
            type="target"
            position={h.position ?? Position.Left}
          />
        ))}

        {/* Icon-секция (тёмная). Иконка типа узла — белым на цветном фоне. */}
        {Icon && (
          <div className="rf-node__icon">
            <Icon size={16} />
          </div>
        )}

        {/* Body-секция (светлая). Kind-overline, главный label, опц. children. */}
        <div className="rf-node__body">
          <div className="rf-node__kind">{meta?.label ?? kind}</div>
          <div className="rf-node__label">{data.label || meta?.label}</div>
          {children}
        </div>

        {outputs.map((h, i) => (
          <Handle
            key={`out-${i}`}
            id={h.id}
            type="source"
            position={h.position ?? Position.Right}
          />
        ))}
      </div>

      {/* Status-bar под нодой (Node-RED-style). Показываем только если есть
          ошибка — в нормальном состоянии холст не загромождаем «ok»-пилюлями. */}
      {hasError && (
        <div className="self-start">
          <span className="rf-node-status rf-node-status--error">
            <span className="rf-node-status__dot" />
            ошибка
          </span>
        </div>
      )}
    </div>
  )
}
