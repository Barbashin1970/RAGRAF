import { NODE_KIND_META, type NodeKind } from '@/lib/api'
import { cn } from '@/lib/cn'

/**
 * Палитра типов узлов (Toolbox) для Flow Editor'а — как в Node-RED Designer:
 * слева список draggable-нод по категориям, перетягиваешь на canvas.
 *
 * Drag-and-drop: нативный HTML5 (e.dataTransfer.setData → FlowCanvas onDrop).
 * Каждый блок в палитре рендерится тем же `.rf-node` split-стилем что и на canvas —
 * пользователь видит палитру и точно знает что получит при drop.
 *
 * Категории сгруппированы по семантике (Node-RED: input / function / output):
 *  - INPUT: вход с параметра
 *  - PROCESS: пороги, сравнения, формулы, развилки (логика-«сердце»)
 *  - OUTPUT: действия наружу
 *  - CONSTRAINT: SHACL-валидация (не часть потока вычисления, но привязывается рядом)
 */

interface PaletteSection {
  title: string
  items: NodeKind[]
}

const SECTIONS: PaletteSection[] = [
  { title: 'Вход', items: ['input'] },
  { title: 'Логика', items: ['threshold', 'compare', 'formula', 'switch'] },
  { title: 'Выход', items: ['output'] },
  { title: 'Ограничения', items: ['shacl_constraint'] },
]

export function NodePalette() {
  return (
    <aside className="flex w-48 shrink-0 flex-col gap-3 border-r border-stone-200 bg-stone-50 p-3 text-sm">
      {SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {section.title}
          </div>
          {section.items.map((k) => {
            const meta = NODE_KIND_META[k]
            const Icon = meta.icon
            return (
              <div
                key={k}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-type', k)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                title={meta.description}
                className={cn('rf-node cursor-grab active:cursor-grabbing', meta.className)}
              >
                <div className="rf-node__icon">
                  {Icon && <Icon size={14} />}
                </div>
                <div className="rf-node__body">
                  <div className="rf-node__kind">{k}</div>
                  <div className="rf-node__label">{meta.label}</div>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <div className="mt-1 rounded-md border border-stone-200 bg-white p-2 text-[10px] leading-snug text-stone-500">
        <b className="text-stone-700">Подсказка.</b> Перетащи блок на холст.
        Соединяй точками: <span className="text-stone-700">правые — выход</span>,{' '}
        <span className="text-stone-700">левые — вход</span>.
      </div>
    </aside>
  )
}
