import { Handle, Position, type NodeProps } from 'reactflow'
import { useFlowStore } from '@/store/flowStore'
import { NODE_KIND_META, type FlowNode, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

interface BaseNodeProps extends NodeProps<FlowNode> {
  /** Visual handles config */
  inputs?: Array<{ id?: string; position?: Position; label?: string }>
  outputs?: Array<{ id?: string; position?: Position; label?: string }>
}

/** Common chrome for all node types — color from NODE_KIND_META, error ring from validator. */
export function BaseNode({ id, data, type, selected, inputs = [], outputs = [], children }: BaseNodeProps & { children?: React.ReactNode }) {
  const meta = NODE_KIND_META[(type ?? data.type) as NodeKind]
  const errors = useFlowStore((s) => s.errorsByNode[id])

  return (
    <div
      className={cn(
        'rf-node',
        meta?.className,
        selected && 'rf-node--selected',
        errors && errors.length > 0 && 'rf-node--error',
      )}
      title={errors?.map((e) => e.message).join('\n')}
    >
      {inputs.map((h, i) => (
        <Handle
          key={`in-${i}`}
          id={h.id}
          type="target"
          position={h.position ?? Position.Left}
          style={{ background: '#475569' }}
        />
      ))}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-stone-500">
        <span>{meta?.label ?? type}</span>
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-stone-800">
        {data.label || meta?.label}
      </div>
      {children}
      {outputs.map((h, i) => (
        <Handle
          key={`out-${i}`}
          id={h.id}
          type="source"
          position={h.position ?? Position.Right}
          style={{ background: '#475569' }}
        />
      ))}
    </div>
  )
}
