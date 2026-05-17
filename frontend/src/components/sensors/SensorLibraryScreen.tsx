import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import {
  api,
  NODE_KIND_META,
  SENSOR_TYPE_META,
  type SensorClassWithSubtypes,
  type SensorFieldSchema,
  type SensorSubtype,
  type SensorType,
} from '@/lib/api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * «Библиотека датчиков» — CRUD для дерева классов / подтипов / полей.
 *
 *  Tree (left)                 Details (right)
 *  ▼ Видеодетекторы (10)        Поля выбранного подтипа (например vd-anpr):
 *    ▢ CCTV (общий)              ┌ name ───── type ── unit ── desc ────┐
 *    ▢ vd-anpr                  │ numberPlate string —    ГРЗ строкой │
 *    ▢ vd-person                 └──────────────────────────────────────┘
 *    ▢ vd-trash-bin              [ + Добавить поле ]
 *    [ + Добавить подтип ]
 *  ▼ Оптоволокно DAS (3)        JSON-пример события (skeleton):
 *    ▢ DAS — акустика            { description, timestamp, payload: {…} }
 *    ▢ fiber-vibration
 *    ▢ fiber-temperature
 *  ▼ Давление (1)
 *    ▢ Манометр (общий)
 *  …
 *
 * Все правки идут через REST → DuckDB; queryClient инвалидируется после
 * каждого upsert/delete.
 */

const DATATYPES: Array<SensorFieldSchema['datatype']> = ['decimal', 'integer', 'string', 'boolean']

export function SensorLibraryScreen() {
  const qc = useQueryClient()
  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['sensor-subtypes'],
    queryFn: () => api.sensorSubtypes.list(),
  })

  // expandedClasses — какие классы раскрыты в дереве. По умолчанию открыт detector
  // (с большим количеством видеодетекторов).
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(
    () => new Set(['detector']),
  )
  const toggleClass = (cls: string) => {
    setExpandedClasses((s) => {
      const next = new Set(s)
      if (next.has(cls)) next.delete(cls)
      else next.add(cls)
      return next
    })
  }

  const [selectedSubtype, setSelectedSubtype] = useState<string | null>('detector')
  const [draftSubtype, setDraftSubtype] = useState<{ class_id: string } | null>(null)

  const createSubtype = useMutation({
    mutationFn: (sub: SensorSubtype) => api.sensorSubtypes.create(sub),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['sensor-subtypes'] })
      setSelectedSubtype(created.subtype_id)
      setDraftSubtype(null)
    },
  })

  const deleteSubtype = useMutation({
    mutationFn: (subtypeId: string) => api.sensorSubtypes.delete(subtypeId),
    onSuccess: (_, subtypeId) => {
      qc.invalidateQueries({ queryKey: ['sensor-subtypes'] })
      qc.invalidateQueries({ queryKey: ['sensor-schema', subtypeId] })
      if (selectedSubtype === subtypeId) setSelectedSubtype(null)
    },
  })

  const reseed = useMutation({
    mutationFn: () => api.sensorSchemas.reseed(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sensor-subtypes'] })
      qc.invalidateQueries({ queryKey: ['sensor-schema'] })
    },
  })

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="rf-node rf-node--sensor" style={{ minHeight: 0, minWidth: 0 }}>
            <div className="rf-node__icon !w-7">
              {NODE_KIND_META.sensor.icon && <NODE_KIND_META.sensor.icon size={14} />}
            </div>
          </div>
          <div>
            <h1 className="text-base font-semibold text-stone-900">Библиотека датчиков</h1>
            <p className="text-xs text-stone-500">
              Классы и подтипы датчиков. Поля payload настраиваются под конкретный подтип — для добавления нового достаточно нажать «+ Добавить подтип» и описать его поля.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            onClick={() => {
              if (confirm('Сбросить ВСЕ правки и пересеять дефолтный набор подтипов и полей?')) {
                reseed.mutate()
              }
            }}
            loading={reseed.isPending}
          >
            Пересеять
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Левая колонка: дерево классов / подтипов */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-white p-3">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Классы и подтипы
          </div>
          {isLoading && <div className="px-2 text-xs text-stone-500">Загрузка…</div>}
          {classes.map((cls) => (
            <ClassTreeNode
              key={cls.class_id}
              cls={cls}
              expanded={expandedClasses.has(cls.class_id)}
              onToggle={() => toggleClass(cls.class_id)}
              selectedSubtype={selectedSubtype}
              onSelectSubtype={(id) => {
                setSelectedSubtype(id)
                setDraftSubtype(null)
              }}
              draftActive={draftSubtype?.class_id === cls.class_id}
              onStartDraft={() => {
                setDraftSubtype({ class_id: cls.class_id })
                if (!expandedClasses.has(cls.class_id)) toggleClass(cls.class_id)
              }}
              onCancelDraft={() => setDraftSubtype(null)}
              onCreateDraft={(sub) => createSubtype.mutate(sub)}
              creatingDraft={createSubtype.isPending}
              onDeleteSubtype={(subtypeId, label) => {
                if (confirm(`Удалить подтип «${label}»? Его поля будут удалены каскадно.`)) {
                  deleteSubtype.mutate(subtypeId)
                }
              }}
            />
          ))}
        </aside>

        {/* Правая колонка: поля выбранного подтипа */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {selectedSubtype ? (
            <FieldsEditor subtypeId={selectedSubtype} classes={classes} />
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-stone-500">
              Выберите подтип в дереве слева
            </div>
          )}
        </main>
      </div>
    </div>
  )
}


// ── Tree-node для одного класса (collapsible) ─────────────────────────


interface ClassTreeNodeProps {
  cls: SensorClassWithSubtypes
  expanded: boolean
  onToggle: () => void
  selectedSubtype: string | null
  onSelectSubtype: (id: string) => void
  draftActive: boolean
  onStartDraft: () => void
  onCancelDraft: () => void
  onCreateDraft: (sub: SensorSubtype) => void
  creatingDraft: boolean
  onDeleteSubtype: (id: string, label: string) => void
}

function ClassTreeNode({
  cls,
  expanded,
  onToggle,
  selectedSubtype,
  onSelectSubtype,
  draftActive,
  onStartDraft,
  onCancelDraft,
  onCreateDraft,
  creatingDraft,
  onDeleteSubtype,
}: ClassTreeNodeProps) {
  const meta = SENSOR_TYPE_META[cls.class_id as SensorType]
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-sm hover:bg-stone-50"
      >
        {expanded ? <ChevronDown size={14} className="text-stone-500" /> : <ChevronRight size={14} className="text-stone-500" />}
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold',
            meta?.bg ?? 'bg-stone-100', meta?.fg ?? 'text-stone-700',
          )}
        >
          {meta?.short ?? cls.class_id[0]?.toUpperCase()}
        </span>
        <span className="flex-1 truncate font-medium text-stone-800">
          {meta?.label ?? cls.class_id}
        </span>
        <span className="font-mono text-[10px] text-stone-500">{cls.subtypes.length}</span>
      </button>
      {expanded && (
        <div className="mt-0.5 ml-3 border-l border-stone-200 pl-2">
          {cls.subtypes.map((sub) => {
            const active = sub.subtype_id === selectedSubtype
            const isGeneric = sub.subtype_id === cls.class_id
            return (
              <div key={sub.subtype_id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectSubtype(sub.subtype_id)}
                  className={cn(
                    'flex flex-1 items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[12px]',
                    active ? 'bg-stone-100 font-semibold text-stone-900' : 'text-stone-700 hover:bg-stone-50',
                  )}
                  title={sub.description ?? sub.label}
                >
                  <span className="truncate">{sub.label}</span>
                </button>
                {!isGeneric && (
                  <button
                    type="button"
                    onClick={() => onDeleteSubtype(sub.subtype_id, sub.label)}
                    className="invisible rounded p-0.5 text-rose-600 hover:bg-rose-50 group-hover:visible"
                    title="Удалить подтип"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            )
          })}
          {draftActive ? (
            <DraftSubtypeRow
              classId={cls.class_id}
              onCancel={onCancelDraft}
              onCreate={onCreateDraft}
              creating={creatingDraft}
            />
          ) : (
            <button
              type="button"
              onClick={onStartDraft}
              className="mt-1 flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] text-primary hover:bg-stone-50"
            >
              <Plus size={11} />
              Добавить подтип
            </button>
          )}
        </div>
      )}
    </div>
  )
}


function DraftSubtypeRow({
  classId, onCancel, onCreate, creating,
}: { classId: string; onCancel: () => void; onCreate: (sub: SensorSubtype) => void; creating: boolean }) {
  const [subtypeId, setSubtypeId] = useState('')
  const [label, setLabel] = useState('')
  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-2">
      <input
        className="rounded border border-stone-300 px-1.5 py-1 font-mono text-[11px]"
        placeholder="subtype_id (например vd-license-plate)"
        value={subtypeId}
        onChange={(e) => setSubtypeId(e.target.value)}
        autoFocus
      />
      <input
        className="rounded border border-stone-300 px-1.5 py-1 text-[11px]"
        placeholder="Название для UI"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-stone-500 hover:bg-stone-100"
          title="Отмена"
        >
          <X size={12} />
        </button>
        <Button
          size="sm"
          variant="primary"
          icon={<Save size={11} />}
          disabled={!subtypeId.trim() || !label.trim() || creating}
          loading={creating}
          onClick={() => onCreate({
            subtype_id: subtypeId.trim(),
            class_id: classId,
            label: label.trim(),
            description: null,
            position: 0,
          })}
        >
          Создать
        </Button>
      </div>
    </div>
  )
}


// ── Правая колонка: поля выбранного подтипа ───────────────────────────


interface FieldsEditorProps {
  subtypeId: string
  classes: SensorClassWithSubtypes[]
}

function FieldsEditor({ subtypeId, classes }: FieldsEditorProps) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['sensor-schema', subtypeId],
    queryFn: () => api.sensorSchemas.listForSubtype(subtypeId),
  })

  const [draftField, setDraftField] = useState<SensorFieldSchema | null>(null)

  const upsert = useMutation({
    mutationFn: (f: SensorFieldSchema) => api.sensorSchemas.upsert(f.subtype_id, f.field_name, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sensor-schema', subtypeId] })
    },
  })

  const remove = useMutation({
    mutationFn: (fieldName: string) => api.sensorSchemas.delete(subtypeId, fieldName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sensor-schema', subtypeId] }),
  })

  // Найти подтип и его класс — для отрисовки заголовка.
  const subtypeMeta = useMemo(() => {
    for (const c of classes) {
      const found = c.subtypes.find((s) => s.subtype_id === subtypeId)
      if (found) return { sub: found, classId: c.class_id }
    }
    return null
  }, [classes, subtypeId])

  const fields = data?.fields ?? []

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 items-start gap-2">
          {subtypeMeta && (() => {
            const m = SENSOR_TYPE_META[subtypeMeta.classId as SensorType]
            return (
              <span
                className={cn(
                  'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold',
                  m?.bg ?? 'bg-stone-100', m?.fg ?? 'text-stone-700',
                )}
              >
                {m?.short ?? subtypeMeta.classId[0]?.toUpperCase()}
              </span>
            )
          })()}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-stone-800">
              {subtypeMeta?.sub.label ?? subtypeId}
              <span className="ml-2 font-mono text-xs text-stone-500">({subtypeId})</span>
            </h2>
            {/* Описание (info-поле) — paragraph под заголовком. Сюда же
                выводим PDF-источник из seed-описания. */}
            {subtypeMeta?.sub.description && (
              <p className="mt-1 text-xs leading-relaxed text-stone-600">
                {subtypeMeta.sub.description}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={13} />}
          onClick={() => setDraftField({
            subtype_id: subtypeId,
            field_name: '',
            datatype: 'decimal',
            unit: null,
            description: null,
            required: false,
            example_value: null,
            position: 0,
          })}
          disabled={draftField !== null}
        >
          Добавить поле
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-stone-500">Загрузка полей…</div>
      ) : (
        <>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="w-1/5 py-2 pr-2 font-medium">Поле</th>
                <th className="w-[100px] py-2 pr-2 font-medium">Тип</th>
                <th className="w-[90px] py-2 pr-2 font-medium">Ед.</th>
                <th className="py-2 pr-2 font-medium">Описание</th>
                <th className="w-[80px] py-2 pr-2 text-center font-medium">Обяз.</th>
                <th className="w-[140px] py-2 pr-2 font-medium">Пример</th>
                <th className="w-[80px] py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <FieldRow
                  key={f.field_name}
                  field={f}
                  onSave={(updated) => upsert.mutate(updated)}
                  onDelete={() => {
                    if (confirm(`Удалить поле «${f.field_name}»?`)) remove.mutate(f.field_name)
                  }}
                  saving={upsert.isPending}
                />
              ))}
              {draftField && (
                <FieldRow
                  field={draftField}
                  isDraft
                  onSave={(f) => {
                    upsert.mutate(f, { onSuccess: () => setDraftField(null) })
                  }}
                  onCancel={() => setDraftField(null)}
                  saving={upsert.isPending}
                />
              )}
              {fields.length === 0 && !draftField && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-stone-500">
                    У подтипа нет полей. Нажмите «Добавить поле».
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <JsonPreview subtypeId={subtypeId} fields={fields} />
        </>
      )}
    </div>
  )
}


// ── Field row (inline-редактирование) ─────────────────────────────────


interface FieldRowProps {
  field: SensorFieldSchema
  isDraft?: boolean
  onSave: (f: SensorFieldSchema) => void
  onCancel?: () => void
  onDelete?: () => void
  saving: boolean
}

function FieldRow({ field, isDraft, onSave, onCancel, onDelete, saving }: FieldRowProps) {
  const [local, setLocal] = useState<SensorFieldSchema>(field)
  const dirty = JSON.stringify(local) !== JSON.stringify(field)

  return (
    <tr className={cn('border-b border-stone-100 text-sm', isDraft && 'bg-amber-50/40')}>
      <td className="py-1.5 pr-2">
        {isDraft ? (
          <input
            className="w-full rounded border border-stone-300 px-1.5 py-1 font-mono text-xs"
            placeholder="field_name"
            value={local.field_name}
            onChange={(e) => setLocal({ ...local, field_name: e.target.value })}
            autoFocus
          />
        ) : (
          <span className="font-mono text-xs">{local.field_name}</span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <select
          className="w-full rounded border border-stone-200 bg-white px-1.5 py-1 text-xs"
          value={local.datatype}
          onChange={(e) => setLocal({ ...local, datatype: e.target.value as SensorFieldSchema['datatype'] })}
        >
          {DATATYPES.map((d) => (<option key={d} value={d}>{d}</option>))}
        </select>
      </td>
      <td className="py-1.5 pr-2">
        <input
          className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs"
          placeholder="—"
          value={local.unit ?? ''}
          onChange={(e) => setLocal({ ...local, unit: e.target.value || null })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs"
          placeholder="Описание поля"
          value={local.description ?? ''}
          onChange={(e) => setLocal({ ...local, description: e.target.value || null })}
        />
      </td>
      <td className="py-1.5 pr-2 text-center">
        <input
          type="checkbox"
          checked={local.required}
          onChange={(e) => setLocal({ ...local, required: e.target.checked })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          className="w-full rounded border border-stone-200 px-1.5 py-1 font-mono text-[10px]"
          placeholder="JSON"
          value={local.example_value ?? ''}
          onChange={(e) => setLocal({ ...local, example_value: e.target.value || null })}
        />
      </td>
      <td className="py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {isDraft ? (
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<Save size={11} />}
                disabled={!local.field_name.trim() || saving}
                loading={saving}
                onClick={() => onSave(local)}
              >
                Создать
              </Button>
              <button
                onClick={onCancel}
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                title="Отмена"
                type="button"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onSave(local)}
                disabled={!dirty || saving}
                className={cn(
                  'rounded p-1 text-xs',
                  dirty ? 'text-emerald-700 hover:bg-emerald-50' : 'text-stone-300',
                )}
                title={dirty ? 'Сохранить изменения' : 'Изменений нет'}
                type="button"
              >
                <Save size={13} />
              </button>
              <button
                onClick={onDelete}
                className="rounded p-1 text-rose-600 hover:bg-rose-50"
                title="Удалить поле"
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}


// ── JSON-preview под таблицей ─────────────────────────────────────────


function JsonPreview({ subtypeId, fields }: { subtypeId: string; fields: SensorFieldSchema[] }) {
  const payload: Record<string, unknown> = {}
  for (const f of fields) {
    payload[f.field_name] = decodeExample(f)
  }
  const wrapped = {
    description: `<событие от ${subtypeId}>`,
    timestamp: '2026-05-17T08:42:11Z',
    payload,
  }
  return (
    <div className="rounded-md border border-stone-200 bg-stone-900 p-3 font-mono text-xs text-stone-100 shadow-inner">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
        Пример события (skeleton)
      </div>
      <pre className="overflow-x-auto whitespace-pre">{JSON.stringify(wrapped, null, 2)}</pre>
    </div>
  )
}

function decodeExample(f: SensorFieldSchema): unknown {
  if (f.example_value) {
    try { return JSON.parse(f.example_value) } catch { return f.example_value }
  }
  switch (f.datatype) {
    case 'decimal': case 'integer': return 0
    case 'boolean': return false
    case 'string': default: return ''
  }
}
