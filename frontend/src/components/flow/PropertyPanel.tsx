import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Radar, Send, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Node } from 'reactflow'
import { api, NODE_KIND_META, type FlowNode, type NodeKind, type Parameter, type SensorFieldSchema, type ValidationError } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useFlowStore } from '@/store/flowStore'

interface Props {
  node: Node<FlowNode> | null
  parameters: Parameter[]
  /** Все ноды flow — нужны sensor-секции, чтобы рендерить dropdown
   *  «привязать к input», вместо free-text. */
  allNodes?: Node<FlowNode>[]
  /** ID регламента — нужен для shacl_constraint dropdown (constraint list). */
  regulationId?: string
  /** Список SHACL ограничений регламента — для dropdown в shacl_constraint. */
  constraints?: Array<{ id: string; path?: string | null; datatype?: string | null; minInclusive?: number | null; maxInclusive?: number | null; message?: string | null }>
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
  allNodes,
  regulationId,
  constraints,
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
  // Ошибки валидации для текущего узла — рисуем заметным красным блоком
  // ВНУТРИ панели, не только тонкой красной рамкой на канвасе.
  const nodeErrors = useFlowStore((s) => s.errorsByNode[node.id]) ?? []

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-stone-200 bg-white text-sm">
      <PanelHeader
        title={meta?.label ?? node.type ?? ''}
        kind={node.type as NodeKind}
        onToggleCollapsed={onToggleCollapsed}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {nodeErrors.length > 0 && (
          <div className="mb-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-900">
            <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-rose-700">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-rose-600 text-[9px] font-bold text-white">!</span>
              {nodeErrors.length === 1 ? 'Ошибка валидации' : `${nodeErrors.length} ошибок валидации`}
            </div>
            <ul className="ml-1 space-y-1">
              {nodeErrors.map((e, i) => (
                <li key={i} className="leading-snug">
                  <span className="text-rose-900">{e.message}</span>
                  <span className="ml-1 font-mono text-[10px] text-rose-500">({e.code})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FieldText label="Метка" value={d.label ?? ''} onChange={(v) => set({ label: v })} />
        <ByType type={node.type as NodeKind} data={d} parameters={parameters} allNodes={allNodes} constraints={constraints} regulationId={regulationId} set={set} />
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

function ByType({ type, data, parameters, allNodes, constraints, regulationId, set }: { type: NodeKind; data: FlowNode; parameters: Parameter[]; allNodes?: Node<FlowNode>[]; constraints?: Props['constraints']; regulationId?: string; set: (p: Partial<FlowNode>) => void }) {
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
        <FormulaEditor
          value={data.expression ?? ''}
          onChange={(v) => set({ expression: v || null })}
          paramNames={parameters.map((p) => p.id)}
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
    case 'shacl_constraint': {
      const constraintOptions = (constraints ?? []).map((c) => {
        const range: string[] = []
        if (c.minInclusive != null) range.push(`≥${c.minInclusive}`)
        if (c.maxInclusive != null) range.push(`≤${c.maxInclusive}`)
        const rangeLabel = range.length ? ` [${range.join(', ')}]` : ''
        const dt = c.datatype ? ` ${c.datatype}` : ''
        return {
          value: c.id,
          label: `${c.path ?? c.id}${dt}${rangeLabel}`,
        }
      })
      return (
        <>
          {constraintOptions.length === 0 ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
              У регламента нет SHACL-ограничений. Добавьте их во вкладке
              «Ограничения» вверху страницы.
            </div>
          ) : (
            <FieldSelect
              label="SHACL-ограничение"
              value={data.constraintRef ?? ''}
              onChange={(v) => set({ constraintRef: v || null })}
              options={[
                { value: '', label: '— выберите ограничение —' },
                ...constraintOptions,
              ]}
            />
          )}
          {regulationId && (
            <Link
              to={`/regulations/${encodeURIComponent(regulationId)}/constraints`}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-700 underline hover:text-blue-900"
            >
              Открыть редактор ограничений →
            </Link>
          )}
          <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] leading-relaxed text-stone-600">
            <b>Что делает блок:</b> при исполнении регламента проверяет
            upstream-значение против выбранного <code>sh:property</code>.
            Нарушение → trace с severity, не блокирует поток.
          </div>
        </>
      )
    }
    case 'sensor': {
      // Режим работы пилюли: 'sensor' (физический датчик) или 'regulation'
      // (слушаю output другого регламента). null трактуется как 'sensor' —
      // обратная совместимость со старыми flow.json.
      const kind = data.sourceKind ?? 'sensor'
      // Общий «вход» — bindsTo и список input-нод — нужен обоим режимам.
      const inputs = (allNodes ?? []).filter(
        (n) => (n.data as FlowNode)?.type === 'input',
      )
      const bindsToBlock = inputs.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
          Нет input-узлов на канвасе — нечему отдавать значение. Добавьте
          параметр в Edit/«Поля» или drop'ните Input-пилюлю слева.
        </div>
      ) : (
        <FieldSelect
          label="Привязать к параметру"
          value={data.bindsTo ?? ''}
          onChange={(v) => set({ bindsTo: v || null })}
          options={[
            { value: '', label: '— не привязан (auto-bind при save) —' },
            ...inputs.map((n) => {
              const fn = n.data as FlowNode
              return {
                value: n.id,
                label: fn.label || fn.paramRef || n.id,
              }
            }),
          ]}
        />
      )

      return (
        <>
          <SourceKindToggle
            kind={kind}
            onChange={(next) => {
              if (next === 'regulation') {
                // Переключение sensor → regulation: чистим sensor-поля, чтобы
                // в flow.json не висел мусор + чтобы валидация и SIGMA-export
                // не считали мёртвые ссылки.
                set({
                  sourceKind: 'regulation',
                  sensorType: null,
                  sensorSubtype: null,
                  externalId: null,
                })
              } else {
                // Обратно в sensor mode — чистим regulation-поля.
                set({
                  sourceKind: 'sensor',
                  sourceRegulationId: null,
                  sourceOutputAction: null,
                })
              }
            }}
          />
          {kind === 'regulation' ? (
            <>
              <RegulationSourcePicker
                currentRegulationId={regulationId ?? null}
                sourceRegulationId={data.sourceRegulationId ?? null}
                sourceOutputAction={data.sourceOutputAction ?? null}
              />
              {bindsToBlock}
            </>
          ) : (
            <>
              <FieldSelect
                label="Класс датчика"
                value={data.sensorType ?? ''}
                onChange={(v) => set({
                  sensorType: v === '' ? null : (v as 'p' | 't' | 'flow' | 'noise' | 'detector' | 'fiber' | 'air'),
                  // При смене класса очищаем подтип — он привязан к классу.
                  sensorSubtype: null,
                })}
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
              <SensorSubtypeSelect
                sensorType={data.sensorType ?? null}
                subtypeId={data.sensorSubtype ?? null}
                onChange={(sub) => set({ sensorSubtype: sub })}
              />
              {bindsToBlock}
              <FieldText
                label="External ID (ETL)"
                value={data.externalId ?? ''}
                onChange={(v) => set({ externalId: v || null })}
                monospaced
              />
              <SensorSchemaPreview
                sensorType={data.sensorType ?? null}
                sensorSubtype={data.sensorSubtype ?? null}
              />
            </>
          )}
        </>
      )
    }
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

/**
 * Двух-позиционный toggle для выбора режима «события»: пилюля event-ноды
 * слушает либо физический датчик, либо output другого регламента. Визуально
 * — две кнопки-вкладки рядом, выбранная заполнена цветом.
 *
 * Решение зафиксировано в `FlowNode.sourceKind` (см. backend schema).
 * Дефолт — 'sensor' (обратная совместимость со старыми flow.json).
 */
function SourceKindToggle({
  kind, onChange,
}: { kind: 'sensor' | 'regulation'; onChange: (next: 'sensor' | 'regulation') => void }) {
  return (
    <div className="mt-2">
      <div className="text-xs text-stone-500">Источник события</div>
      <div className="mt-1 inline-flex w-full overflow-hidden rounded-md border border-stone-200 bg-stone-50">
        <button
          type="button"
          onClick={() => onChange('sensor')}
          className={cn(
            'flex-1 px-2 py-1 text-xs font-medium transition',
            kind === 'sensor'
              ? 'bg-teal-600 text-white'
              : 'text-stone-600 hover:bg-stone-100',
          )}
        >
          <Radar size={11} className="-mt-0.5 mr-1 inline" />
          Датчик
        </button>
        <button
          type="button"
          onClick={() => onChange('regulation')}
          className={cn(
            'flex-1 border-l border-stone-200 px-2 py-1 text-xs font-medium transition',
            kind === 'regulation'
              ? 'bg-indigo-600 text-white'
              : 'text-stone-600 hover:bg-stone-100',
          )}
        >
          <Send size={11} className="-mt-0.5 mr-1 inline" />
          Регламент
        </button>
      </div>
    </div>
  )
}

/**
 * Информер для режима 'regulation' — БЕЗ конкретного picker'а регламента.
 *
 * Принцип «Двух уровней» (2026-05-19):
 *   Регламент — атомарное правило, не знает о других регламентах.
 *   Композиция регламентов живёт в Цифровом Двойнике (Process.wiring).
 *
 * Здесь, в Flow Editor одного регламента, пилюля события в режиме
 * «слушаю выход регламента» — placeholder. Конкретное wiring («какой
 * именно регламент кормит этот вход») делается на странице /twins,
 * в редакторе двойника.
 *
 * Если wiring уже спроецирован (Twin сохранён) — показываем read-only
 * summary «Привязано Twin'ом …» с переходом в редактор того Twin'а.
 */
function RegulationSourcePicker({
  currentRegulationId,
  sourceRegulationId,
  sourceOutputAction,
}: {
  currentRegulationId: string | null
  sourceRegulationId: string | null
  sourceOutputAction: string | null
}) {
  const { data: datasets = [] } = useQuery({
    queryKey: ['datasets-for-picker'],
    queryFn: () => api.datasets.list(),
    enabled: !!sourceRegulationId,
  })
  const { data: inTwinsData } = useQuery({
    queryKey: ['regulation-in-twins', currentRegulationId],
    queryFn: () => api.regulations.inTwins(currentRegulationId!),
    enabled: !!currentRegulationId,
  })

  const sourceName = sourceRegulationId
    ? ((datasets as Array<{ id?: string; name?: string }>)
        .find((d) => d?.id === sourceRegulationId)?.name ?? sourceRegulationId)
    : null
  const inTwins = inTwinsData?.twins ?? []
  const linkedTwin = inTwins[0] ?? null   // если регламент в N twin'ах, ведём в первый

  return (
    <>
      {sourceRegulationId ? (
        <div className="mt-2 rounded-md border border-indigo-300 bg-indigo-50/70 p-2.5 text-[11px] leading-snug text-indigo-900">
          <div className="flex items-center gap-1 font-semibold uppercase tracking-wide text-indigo-700">
            <Send size={11} />
            Привязано Двойником
          </div>
          <div className="mt-1">
            Источник: <b>{sourceName}</b>
            {sourceOutputAction && (
              <>
                {' '}/ выход <code className="rounded bg-white/70 px-1">{sourceOutputAction}</code>
              </>
            )}
          </div>
          {linkedTwin && (
            <Link
              to={`/twins/${encodeURIComponent(linkedTwin.id)}`}
              className="mt-2 inline-flex items-center gap-1 font-medium text-indigo-700 underline hover:text-indigo-900"
            >
              Открыть Двойник «{linkedTwin.name}» <ExternalLink size={10} />
            </Link>
          )}
          {sourceRegulationId && (
            <Link
              to={`/regulations/${encodeURIComponent(sourceRegulationId)}/edit`}
              className="mt-1 inline-flex items-center gap-1 text-indigo-700 underline hover:text-indigo-900"
            >
              Перейти в регламент-источник <ExternalLink size={10} />
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 p-2.5 text-[11px] leading-snug text-indigo-900">
          <div className="flex items-center gap-1 font-semibold uppercase tracking-wide text-indigo-700">
            <AlertTriangle size={11} />
            Placeholder
          </div>
          <div className="mt-1">
            Это событие слушает выход <b>другого регламента</b>, но конкретная
            связь задаётся в <b>Цифровом Двойнике</b>, не здесь.
          </div>
          <Link
            to={linkedTwin ? `/twins/${encodeURIComponent(linkedTwin.id)}` : '/twins'}
            className="mt-2 inline-flex items-center gap-1 font-medium text-indigo-700 underline hover:text-indigo-900"
          >
            {linkedTwin
              ? `Открыть Двойник «${linkedTwin.name}» →`
              : 'Открыть страницу Двойников →'}
            <ExternalLink size={10} />
          </Link>
        </div>
      )}
      <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] leading-relaxed text-stone-600">
        <b>Зачем так:</b> регламент остаётся атомарным и переиспользуемым.
        Конкретный «B → A» делается только в Двойнике — его можно собрать
        под разные сценарии, не модифицируя сами регламенты.
      </div>
    </>
  )
}

/**
 * Селектор подтипа датчика — фильтрует список подтипов по выбранному классу.
 * Если класс не выбран — селектор disabled. Если у класса один generic-подтип
 * (subtype_id == class_id) — показываем как опцию по умолчанию.
 *
 * Источник данных — реестр sensor_subtypes (та же таблица, что в /sensors).
 */
function SensorSubtypeSelect({
  sensorType, subtypeId, onChange,
}: { sensorType: string | null; subtypeId: string | null; onChange: (id: string | null) => void }) {
  const { data: classes = [] } = useQuery({
    queryKey: ['sensor-subtypes'],
    queryFn: () => api.sensorSubtypes.list(),
    enabled: !!sensorType,
  })

  const subtypes = useMemo(() => {
    if (!sensorType) return []
    return classes.find((c) => c.class_id === sensorType)?.subtypes ?? []
  }, [classes, sensorType])

  // Найти описание выбранного подтипа — рисуем под селектом для подсказки.
  const selectedSub = subtypes.find((s) => s.subtype_id === (subtypeId ?? sensorType))

  if (!sensorType) {
    return (
      <label className="mt-2 block">
        <div className="text-xs text-stone-500">Подтип датчика</div>
        <select
          disabled
          className="mt-1 w-full rounded border border-stone-200 bg-stone-50 px-2 py-1 text-sm text-stone-400"
        >
          <option>— сначала выберите класс —</option>
        </select>
      </label>
    )
  }

  return (
    <label className="mt-2 block">
      <div className="flex items-center justify-between">
        <span className="text-xs text-stone-500">Подтип датчика</span>
        <Link to="/sensors" className="text-[10px] text-primary hover:underline">
          справочник →
        </Link>
      </div>
      <select
        className="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1 text-sm"
        value={subtypeId ?? sensorType}  // дефолт = generic-подтип класса
        onChange={(e) => onChange(e.target.value === sensorType ? null : e.target.value)}
      >
        {subtypes.map((s) => (
          <option key={s.subtype_id} value={s.subtype_id}>
            {s.subtype_id === sensorType ? '(по умолчанию) ' : ''}{s.label}
          </option>
        ))}
        {subtypes.length === 0 && (
          <option value="">нет зарегистрированных подтипов</option>
        )}
      </select>
      {selectedSub?.description && (
        <div className="mt-1 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-[10px] leading-snug text-stone-600">
          {selectedSub.description}
        </div>
      )}
    </label>
  )
}


/**
 * Превью JSON-скелета payload-полей. Берёт поля по подтипу (если задан) или
 * по generic-подтипу класса (subtype_id == class_id).
 */
function SensorSchemaPreview({
  sensorType, sensorSubtype,
}: { sensorType: string | null; sensorSubtype: string | null }) {
  // Эффективный subtype: если задан — используем; иначе fallback на generic.
  const effectiveSubtype = sensorSubtype || sensorType

  const { data } = useQuery({
    queryKey: ['sensor-schema', effectiveSubtype],
    queryFn: () => api.sensorSchemas.listForSubtype(effectiveSubtype!),
    enabled: !!effectiveSubtype,
  })

  if (!effectiveSubtype) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-stone-300 bg-stone-50 px-2 py-2 text-[11px] text-stone-500">
        Выберите класс/подтип датчика — здесь появится JSON-схема payload-полей.
      </div>
    )
  }

  const fields: SensorFieldSchema[] = data?.fields ?? []
  const payload: Record<string, unknown> = {}
  for (const f of fields) {
    payload[f.field_name] = decodeExample(f)
  }
  const wrapped = {
    description: `<событие от ${effectiveSubtype}>`,
    timestamp: '2026-05-17T08:42:11Z',
    payload,
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-stone-500">
          JSON-схема payload {sensorSubtype ? '' : '(generic-подтип)'}
        </div>
        <Link
          to="/sensors"
          className="text-[10px] text-primary hover:underline"
          title="Открыть «Схемы событий датчиков» — там можно добавить/изменить поля payload"
        >
          редактировать →
        </Link>
      </div>
      {fields.length === 0 ? (
        <div className="rounded border border-stone-200 bg-stone-50 px-2 py-2 text-[11px] text-stone-500">
          У подтипа «{effectiveSubtype}» нет полей payload. Открой <Link to="/sensors" className="text-primary hover:underline">«Схемы событий»</Link> и добавь.
        </div>
      ) : (
        <pre className="overflow-x-auto whitespace-pre rounded border border-stone-700 bg-stone-900 p-2 font-mono text-[10px] text-stone-100">
          {JSON.stringify(wrapped, null, 2)}
        </pre>
      )}
      {fields.length > 0 && (
        <div className="mt-1 text-[10px] text-stone-400">
          {fields.length} {fields.length === 1 ? 'поле' : 'полей'} · обязательных: {fields.filter((f) => f.required).length}
        </div>
      )}
    </div>
  )
}

/**
 * Распарсить example_value (JSON-строка) в подходящий sample.
 * Дублирует логику из SensorLibraryScreen — оба места рисуют одинаковый JSON.
 */
function decodeExample(f: SensorFieldSchema): unknown {
  if (f.example_value) {
    try {
      return JSON.parse(f.example_value)
    } catch {
      return f.example_value
    }
  }
  switch (f.datatype) {
    case 'decimal':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'string':
    default:
      return ''
  }
}


// ──────────────────────────────────────────────────────────
// FormulaEditor — textarea + cheat-sheet
//
// Сейчас expression больше не pass-through: backend AST-walker реально
// вычисляет formula. Поэтому юзеру нужны:
//   • textarea (мульти-строчная — формулы быстро становятся длинными);
//   • подсказка с встроенными функциями и переменными регламента;
//   • monospace + чуть-чуть подсветки для читаемости.
// Подсветку синтаксиса оставим CodeMirror'у в будущем; пока — JSON-style
// dark theme через CSS.
// ──────────────────────────────────────────────────────────

function FormulaEditor({
  value,
  onChange,
  paramNames,
}: {
  value: string
  onChange: (v: string) => void
  paramNames: string[]
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
          Выражение
        </label>
        <button
          type="button"
          onClick={() => setHelpOpen((x) => !x)}
          className="text-[10px] text-blue-700 underline hover:text-blue-900"
        >
          {helpOpen ? 'Скрыть подсказку' : 'Что можно писать?'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={4}
        placeholder="например: pressure > 20 && temperature > 50"
        className="w-full resize-y rounded-md border border-stone-300 bg-stone-900 p-2 font-mono text-xs leading-relaxed text-emerald-200 caret-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
        style={{ tabSize: 2 }}
      />
      {helpOpen && (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-[10px] leading-relaxed text-stone-700">
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Переменные регламента
          </div>
          <div className="mb-2 font-mono text-stone-800">
            {paramNames.length ? paramNames.join(', ') : <em className="text-stone-400">нет параметров — добавьте в «Поля»</em>}
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Арифметика
          </div>
          <div className="mb-2 font-mono text-stone-800">
            + − * / ** (степень) % // abs(x) min(a,b) max(a,b) sqrt(x)
            pow(x,n) log(x) log10(x) exp(x) floor ceil round sign
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Тригонометрия и константы
          </div>
          <div className="mb-2 font-mono text-stone-800">
            sin cos tan asin acos atan atan2(y,x) pi e
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Логика и сравнения
          </div>
          <div className="mb-2 font-mono text-stone-800">
            and or not && || ! == != &lt; &lt;= &gt; &gt;= in [list]
            between(x, lo, hi) (a if cond else b)
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Время (используется now() backend'а)
          </div>
          <div className="mb-2 font-mono text-stone-800">
            now() hour() minute() day_of_week() is_weekend() is_night(start, end)
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Временные ряды (нужен исторический буфер от ETL)
          </div>
          <div className="mb-2 font-mono text-stone-800">
            rate("p", "1h") delta("p", "10m") prev("p") mean("p", "1h")
            max_over("p", "24h") min_over("p", "1h")
            count_above("p", value, "1h")
          </div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Примеры
          </div>
          <ul className="ml-3 list-disc font-mono text-[10px] text-stone-800">
            <li>pressure &gt; 20 &amp;&amp; temperature &lt; 60</li>
            <li>abs(pressure - reference) &gt; tolerance</li>
            <li>sqrt(pressure ** 2 + flow ** 2) &gt; critical_envelope</li>
            <li>rate("temp", "1h") &gt; 5  // потепление {'>'} 5°/час</li>
            <li>is_night(22, 6) and waterLevel &gt; 3</li>
          </ul>
          <div className="mt-2 mb-1 font-semibold uppercase tracking-wide text-stone-500">
            Трёхзначная логика Клини (None = unknown)
          </div>
          <div className="text-[10px] leading-snug text-stone-700">
            Если у параметра нет данных (sensor offline, ETL не прислал
            сэмпл) — переменная = None. Логика Клини:
            <ul className="mt-1 ml-3 list-disc font-mono text-[10px] text-stone-800">
              <li>None and True = None · None and False = False</li>
              <li>None or True = True · None or False = None</li>
              <li>not None = None</li>
              <li>None + 1 = None  (любая арифметика прозрачно)</li>
              <li>None &gt; 5 = None  (числовое сравнение)</li>
              <li>None == None = True  (явный тест «нет данных»)</li>
            </ul>
            <div className="mt-1 italic">
              Если результат формулы = None → нода <b>не fired</b>, downstream
              не активируется. Trace показывает «unknown (нет данных: ...)».
              Это защищает от ложного «всё ок» при offline-датчиках.
            </div>
          </div>
          <div className="mt-1.5 text-[9px] italic text-stone-500">
            Backend: исполнитель через изолированный AST-walker (без eval).
            Синтаксис проверяется при сохранении flow. SKILL-D0SL.md §8.1.
          </div>
        </div>
      )}
    </div>
  )
}
