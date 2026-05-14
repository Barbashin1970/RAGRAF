import { Handle, Position, type NodeProps } from 'reactflow'
import { useFlowStore } from '@/store/flowStore'
import { NODE_KIND_META, type FlowNode, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

interface BaseNodeProps extends NodeProps<FlowNode> {
  inputs?: Array<{ id?: string; position?: Position; label?: string }>
  outputs?: Array<{ id?: string; position?: Position; label?: string }>
}

/**
 * Node-RED-style icon-pill. На canvas — компактно: icon + kind (тип). Детали
 * и user-label выведены в правую PropertyPanel; на блоке остаётся только
 * визуальный «маркер» типа. Длинные русские имена больше не режутся.
 *
 * Полный пользовательский label дублируем в title-атрибуте (нативный tooltip).
 */
export function BaseNode({
  id,
  data,
  type,
  selected,
  inputs = [],
  outputs = [],
}: BaseNodeProps) {
  const kind = (type ?? data.type) as NodeKind
  const meta = NODE_KIND_META[kind]
  const errors = useFlowStore((s) => s.errorsByNode[id])
  const Icon = meta?.icon
  const hasError = !!(errors && errors.length > 0)

  const userLabel = data.label?.trim() || ''
  const tooltipParts = [meta?.label ?? kind, userLabel].filter(Boolean)
  const errorText = errors?.map((e) => e.message).join('\n')
  const tooltip = [tooltipParts.join(' — '), errorText].filter(Boolean).join('\n')

  return (
    <div
      className={cn(
        'rf-node',
        meta?.className,
        selected && 'rf-node--selected',
        hasError && 'rf-node--error',
      )}
      title={tooltip}
    >
      {inputs.map((h, i) => (
        <Handle
          key={`in-${i}`}
          id={h.id}
          type="target"
          position={h.position ?? Position.Left}
        />
      ))}

      {Icon && (
        <div className="rf-node__icon">
          <Icon size={16} />
        </div>
      )}

      <div className="rf-node__body">
        <div className="rf-node__kind">{meta?.label ?? kind}</div>
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
  )
}
