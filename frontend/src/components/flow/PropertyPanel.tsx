import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import type { Node } from 'reactflow'
import { NODE_KIND_META, type FlowNode, type NodeKind, type Parameter } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

interface Props {
  node: Node<FlowNode> | null
  parameters: Parameter[]
  onChange: (id: string, patch: Partial<FlowNode>) => void
  onDelete: (id: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

/**
 * Node-RED-style collapsible inspector. По умолчанию — раскрытая панель с
 * полями текущего узла; сворачивается в узкую полосу (40px) с иконкой
 * выбранного типа. На canvas-блоках имена не отображаются — пользователь
 * читает label здесь, в Метке.
 */
export function PropertyPanel({
  node,
  parameters,
  onChange,
  onDelete,
  collapsed,
  onToggleCollapsed,
}: Props) {
  if (collapsed) {
    const Icon = node ? NODE_KIND_META[node.type as NodeKind]?.icon : null
    const meta = node ? NODE_KIND_META[node.type as NodeKind] : null
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-stone-200 bg-white py-2">
        <button
          onClick={onToggleCollapsed}
          className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          title="Развернуть панель свойств"
        >
          <ChevronLeft size={16} />
        </button>
        {Icon && meta && (
          <div
            className={cn('mt-3 rf-node', meta.className)}
            style={{ minWidth: 0 }}
            title={node?.data.label || meta.label}
          >
            <div className="rf-node__icon !w-7">
              <Icon size={14} />
            </div>
          </div>
        )}
      </aside>
    )
  }

  if (!node) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-stone-200 bg-white text-sm">
        <PanelHeader title="Свойства" onToggleCollapsed={onToggleCollapsed} />
        <div className="flex-1 p-3 text-stone-500">
          Выберите узел для редактирования свойств.
        </div>
      </aside>
    )
  }
  const d = node.data
  const set = (patch: Partial<FlowNode>) => onChange(node.id, patch)
  const meta = NODE_KIND_META[node.type as NodeKind]

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-stone-200 bg-white text-sm">
      <PanelHeader
        title={meta?.label ?? node.type ?? ''}
        kind={node.type as NodeKind}
        onToggleCollapsed={onToggleCollapsed}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <FieldText label="Метка" value={d.label ?? ''} onChange={(v) => set({ label: v })} />
        <ByType type={node.type as NodeKind} data={d} parameters={parameters} set={set} />
        <div className="mt-3 border-t border-stone-100 pt-2 font-mono text-[10px] text-stone-400">
          id: {node.id}
        </div>
        <div className="mt-3">
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={13} />}
            onClick={() => onDelete(node.id)}
          >
            Удалить узел
          </Button>
        </div>
      </div>
    </aside>
  )
}

function PanelHeader({
  title,
  kind,
  onToggleCollapsed,
}: {
  title: string
  kind?: NodeKind
  onToggleCollapsed: () => void
}) {
  const meta = kind ? NODE_KIND_META[kind] : null
  const Icon = meta?.icon
  return (
    <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
      <button
        onClick={onToggleCollapsed}
        className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        title="Свернуть панель свойств"
      >
        <ChevronRight size={16} />
      </button>
      {Icon && meta && (
        <div className={cn('rf-node', meta.className)} style={{ minWidth: 0, minHeight: 0 }}>
          <div className="rf-node__icon !w-6">
            <Icon size={12} />
          </div>
        </div>
      )}
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-700">{title}</div>
    </div>
  )
}

function ByType({ type, data, parameters, set }: { type: NodeKind; data: FlowNode; parameters: Parameter[]; set: (p: Partial<FlowNode>) => void }) {
  switch (type) {
    case 'input':
      return (
        <FieldSelect
          label="Параметр"
          value={data.paramRef ?? ''}
          onChange={(v) => set({ paramRef: v || null })}
          options={[{ value: '', label: '— не задан —' }, ...parameters.map((p) => ({ value: p.id, label: p.name }))]}
        />
      )
    case 'threshold':
      return (
        <>
          <FieldNumber label="Эталон" value={data.refValue ?? null} onChange={(v) => set({ refValue: v })} />
          <FieldNumber label="Отклонение" value={data.deviation ?? null} onChange={(v) => set({ deviation: v })} />
          <FieldText label="Ед. изм." value={data.unit ?? ''} onChange={(v) => set({ unit: v || null })} />
        </>
      )
    case 'compare':
      return (
        <FieldSelect
          label="Оператор"
          value={data.operator ?? ''}
          onChange={(v) => set({ operator: v || null })}
          options={[
            { value: '', label: '— выбрать —' },
            { value: 'outside_range', label: 'вне диапазона' },
            { value: 'inside_range', label: 'внутри диапазона' },
            { value: 'greater', label: 'больше' },
            { value: 'less', label: 'меньше' },
            { value: 'equal', label: 'равно' },
          ]}
        />
      )
    case 'formula':
      return (
        <FieldText
          label="Выражение"
          value={data.expression ?? ''}
          onChange={(v) => set({ expression: v || null })}
          monospaced
        />
      )
    case 'switch':
      return (
        <div className="mt-2">
          <div className="mb-1 text-xs text-stone-500">Ветки</div>
          {(data.cases ?? []).map((c, i) => {
            // R5: устойчивый ключ. Для новых веток мы прописываем `id` через nanoid;
            // у старых данных id может отсутствовать — используем композит label+i
            // как «лучший возможный» fallback. При reorder/удалении из середины
            // композит даёт более стабильный keying чем чистый index.
            const stableKey = (c as { id?: string }).id ?? `legacy-${i}-${c.label}`
            return (
            <div key={stableKey} className="mb-1 flex gap-1">
              <input
                className="w-1/2 rounded border border-stone-200 px-1.5 py-1 text-xs"
                value={c.label}
                onChange={(e) => {
                  const next = [...(data.cases ?? [])]
                  next[i] = { ...c, label: e.target.value }
                  set({ cases: next })
                }}
              />
              <input
                className="w-1/2 rounded border border-stone-200 px-1.5 py-1 text-xs"
                value={String(c.value ?? '')}
                onChange={(e) => {
                  const next = [...(data.cases ?? [])]
                  next[i] = { ...c, value: e.target.value }
                  set({ cases: next })
                }}
              />
            </div>
            )
          })}
          <button
            onClick={() => set({
              cases: [
                ...(data.cases ?? []),
                // R5: каждая новая ветка получает стабильный id для рендера.
                { id: nanoid(6), label: 'Ветка', value: '' },
              ],
            })}
            className="mt-1 rounded-md border border-stone-200 px-2 py-1 text-xs hover:bg-surface-offset"
          >
            + ветка
          </button>
        </div>
      )
    case 'output':
      return (
        <>
          <FieldText label="Действие" value={data.action ?? ''} onChange={(v) => set({ action: v || null })} />
          <FieldText label="Текст рекомендации" value={data.text ?? ''} onChange={(v) => set({ text: v || null })} multiline />
          <FieldSelect
            label="Приоритет"
            value={String(data.priority ?? '')}
            onChange={(v) => set({ priority: v ? Number(v) : null })}
            options={[
              { value: '', label: '— не задан —' },
              { value: '1', label: '1 — критический' },
              { value: '2', label: '2 — важный' },
              { value: '3', label: '3 — обычный' },
            ]}
          />
        </>
      )
    case 'shacl_constraint':
      return <FieldText label="ID ограничения" value={data.constraintRef ?? ''} onChange={(v) => set({ constraintRef: v || null })} monospaced />
    case 'sensor':
      return (
        <>
          <FieldSelect
            label="Тип датчика"
            value={data.sensorType ?? ''}
            onChange={(v) => set({ sensorType: v === '' ? null : (v as 'p' | 't' | 'flow' | 'noise' | 'detector' | 'fiber' | 'air') })}
            options={[
              { value: '', label: '— не задан —' },
              { value: 'p', label: 'Давление (p)' },
              { value: 't', label: 'Температура (t)' },
              { value: 'flow', label: 'Расход м³/ч (Q)' },
              { value: 'noise', label: 'Шум' },
              { value: 'detector', label: 'Видеодетектор' },
              { value: 'fiber', label: 'Волокно DAS' },
              { value: 'air', label: 'Качество воздуха (CO2/PM)' },
            ]}
          />
          {/* Привязка к input-ноде регламента — сенсор только указывает «куда
              лить значение». Выбор из существующих input'ов canvas'а
              реализуем чуть позже (нужен список нод); пока — свободный текст. */}
          <FieldText
            label="ID input-узла"
            value={data.bindsTo ?? ''}
            onChange={(v) => set({ bindsTo: v || null })}
            monospaced
          />
          <FieldText
            label="External ID (ETL)"
            value={data.externalId ?? ''}
            onChange={(v) => set({ externalId: v || null })}
            monospaced
          />
        </>
      )
    default:
      return null
  }
}

function FieldText({ label, value, onChange, multiline, monospaced }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; monospaced?: boolean }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const cls = `mt-1 w-full rounded border border-stone-200 px-2 py-1 text-sm ${monospaced ? 'font-mono text-xs' : ''}`
  return (
    <label className="mt-2 block">
      <div className="text-xs text-stone-500">{label}</div>
      {multiline ? (
        <textarea
          rows={3}
          className={cls}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(local)}
        />
      ) : (
        <input
          className={cls}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(local)}
        />
      )}
    </label>
  )
}

function FieldNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [local, setLocal] = useState(value === null || value === undefined ? '' : String(value))
  useEffect(() => setLocal(value === null || value === undefined ? '' : String(value)), [value])
  return (
    <label className="mt-2 block">
      <div className="text-xs text-stone-500">{label}</div>
      <input
        type="number"
        className="mt-1 w-full rounded border border-stone-200 px-2 py-1 text-sm"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onChange(local === '' ? null : Number(local))}
      />
    </label>
  )
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="mt-2 block">
      <div className="text-xs text-stone-500">{label}</div>
      <select
        className="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
