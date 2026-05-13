import { NODE_KIND_META, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

/**
 * Палитра типов узлов. Перетаскивание — нативный HTML5 DnD React Flow:
 * onDragStart кладёт type в dataTransfer; FlowCanvas снимает в onDrop.
 * См. SKILL.md § Drag-and-Drop.
 */
export function NodePalette() {
  return (
    <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-stone-200 bg-white p-2 text-sm">
      <div className="mb-1 px-1 text-xs uppercase tracking-wide text-stone-500">Типы узлов</div>
      {(Object.keys(NODE_KIND_META) as NodeKind[]).map((k) => {
        const meta = NODE_KIND_META[k]
        return (
          <div
            key={k}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow-type', k)
              e.dataTransfer.effectAllowed = 'move'
            }}
            className={cn(
              'cursor-grab rounded-md border px-2 py-1.5 text-xs transition active:cursor-grabbing',
              'rf-node',
              meta.className,
            )}
            title={meta.description}
          >
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{k}</div>
            <div className="text-sm font-medium text-stone-800">{meta.label}</div>
          </div>
        )
      })}
      <div className="mt-2 px-1 text-[10px] leading-tight text-stone-400">
        Перетащи на холст. Соединяй точками: правые — выход, левые — вход.
      </div>
    </aside>
  )
}
