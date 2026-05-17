import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import {
  api,
  NODE_KIND_META,
  SENSOR_TYPE_META,
  type SensorFieldSchema,
  type SensorType,
} from '@/lib/api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * Экран «Библиотека датчиков»: master-details для CRUD над DuckDB-таблицей
 * sensor_field_schemas.
 *
 * Layout:
 *   ┌────────────────┬──────────────────────────────────────────┐
 *   │ Типы датчиков  │  Поля выбранного типа                    │
 *   │  ▢ p           │  ┌─ name ──── type ── unit ─── desc ──┐  │
 *   │  ▢ t           │  │ pressure   decimal атм   …          │  │
 *   │  ▢ flow ▾      │  └──────────────────────────────────────┘ │
 *   │  ▢ air         │  [ + Добавить поле ]                      │
 *   │  ▢ detector    │                                            │
 *   │  ▢ fiber       │  JSON-превью (payload-skeleton)            │
 *   │  ▢ noise       │  { "pressure": 20.5, "reference": ... }   │
 *   └────────────────┴──────────────────────────────────────────┘
 *
 * Source-of-truth — backend. Все правки идут через api.sensorSchemas.upsert/
 * delete и мгновенно invalidate'ят react-query кеш.
 */

const DATATYPES: Array<SensorFieldSchema['datatype']> = ['decimal', 'integer', 'string', 'boolean']

export function SensorLibraryScreen() {
  const qc = useQueryClient()
  const { data: all = [], isLoading } = useQuery({
    queryKey: ['sensor-schemas'],
    queryFn: () => api.sensorSchemas.list(),
  })

  const [selectedType, setSelectedType] = useState<string>('p')
  const [draftField, setDraftField] = useState<SensorFieldSchema | null>(null)

  const upsert = useMutation({
    mutationFn: (f: SensorFieldSchema) => api.sensorSchemas.upsert(f.sensor_type, f.field_name, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sensor-schemas'] }),
  })
  const remove = useMutation({
    mutationFn: ({ st, fn }: { st: string; fn: string }) => api.sensorSchemas.delete(st, fn),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sensor-schemas'] }),
  })
  const reseed = useMutation({
    mutationFn: () => api.sensorSchemas.reseed(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sensor-schemas'] }),
  })

  const currentGroup = useMemo(
    () => all.find((g) => g.sensor_type === selectedType),
    [all, selectedType],
  )

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <div className={cn('rf-node rf-node--sensor', 'min-h-0 min-w-0')} style={{ minHeight: 0, minWidth: 0 }}>
            <div className="rf-node__icon !w-7">
              {NODE_KIND_META.sensor.icon && (
                <NODE_KIND_META.sensor.icon size={14} />
              )}
            </div>
          </div>
          <div>
            <h1 className="text-base font-semibold text-stone-900">Библиотека датчиков</h1>
            <p className="text-xs text-stone-500">
              Поля payload для каждого типа датчика. Используется в редакторе потока и валидации входящих событий.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            onClick={() => {
              if (confirm('Сбросить все правки и пересеять дефолтный набор?')) {
                reseed.mutate()
              }
            }}
            loading={reseed.isPending}
            title="Восстановить дефолтный сид (все пользовательские правки потеряются)"
          >
            Пересеять
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Master: типы датчиков */}
        <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-stone-200 bg-white p-3">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Типы датчиков
          </div>
          {isLoading && <div className="px-2 text-xs text-stone-500">Загрузка…</div>}
          {all.map((g) => {
            const meta = SENSOR_TYPE_META[g.sensor_type as SensorType]
            const active = g.sensor_type === selectedType
            return (
              <button
                key={g.sensor_type}
                type="button"
                onClick={() => setSelectedType(g.sensor_type)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition',
                  active
                    ? 'border-stone-400 bg-stone-100 font-semibold'
                    : 'border-stone-200 bg-white hover:bg-stone-50',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold',
                      meta?.bg ?? 'bg-stone-100', meta?.fg ?? 'text-stone-700',
                    )}
                  >
                    {meta?.short ?? g.sensor_type[0]?.toUpperCase()}
                  </span>
                  <span className="truncate">{meta?.label ?? g.sensor_type}</span>
                </span>
                <span className="font-mono text-[10px] text-stone-500">{g.fields.length}</span>
              </button>
            )
          })}
        </aside>

        {/* Details: поля выбранного типа */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {currentGroup ? (
            <FieldsEditor
              group={currentGroup}
              draftField={draftField}
              onStartDraft={() => setDraftField({
                sensor_type: selectedType,
                field_name: '',
                datatype: 'decimal',
                unit: null,
                description: null,
                required: false,
                example_value: null,
                position: 0,
              })}
              onCancelDraft={() => setDraftField(null)}
              onSaveDraft={(f) => {
                upsert.mutate(f, { onSuccess: () => setDraftField(null) })
              }}
              onUpdate={(f) => upsert.mutate(f)}
              onDelete={(f) => {
                if (confirm(`Удалить поле «${f.field_name}» из типа «${f.sensor_type}»?`)) {
                  remove.mutate({ st: f.sensor_type, fn: f.field_name })
                }
              }}
              saving={upsert.isPending}
            />
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-stone-500">
              Выберите тип датчика слева
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

interface FieldsEditorProps {
  group: { sensor_type: string; fields: SensorFieldSchema[] }
  draftField: SensorFieldSchema | null
  onStartDraft: () => void
  onCancelDraft: () => void
  onSaveDraft: (f: SensorFieldSchema) => void
  onUpdate: (f: SensorFieldSchema) => void
  onDelete: (f: SensorFieldSchema) => void
  saving: boolean
}

function FieldsEditor({
  group, draftField, onStartDraft, onCancelDraft, onSaveDraft, onUpdate, onDelete, saving,
}: FieldsEditorProps) {
  const meta = SENSOR_TYPE_META[group.sensor_type as SensorType]
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-xs font-bold',
              meta?.bg ?? 'bg-stone-100', meta?.fg ?? 'text-stone-700',
            )}
          >
            {meta?.short ?? group.sensor_type[0]?.toUpperCase()}
          </span>
          <h2 className="text-sm font-semibold text-stone-800">
            {meta?.label ?? group.sensor_type}
            <span className="ml-2 font-mono text-xs text-stone-500">({group.sensor_type})</span>
          </h2>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={13} />}
          onClick={onStartDraft}
          disabled={draftField !== null}
        >
          Добавить поле
        </Button>
      </div>

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
          {group.fields.map((f) => (
            <FieldRow key={f.field_name} field={f} onSave={onUpdate} onDelete={onDelete} saving={saving} />
          ))}
          {draftField && (
            <FieldRow
              field={draftField}
              isDraft
              onSave={onSaveDraft}
              onCancel={onCancelDraft}
              saving={saving}
            />
          )}
          {group.fields.length === 0 && !draftField && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-sm text-stone-500">
                У типа пока нет полей. Нажмите «Добавить поле».
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <JsonPreview group={group} />
    </div>
  )
}

interface FieldRowProps {
  field: SensorFieldSchema
  isDraft?: boolean
  onSave: (f: SensorFieldSchema) => void
  onCancel?: () => void
  onDelete?: (f: SensorFieldSchema) => void
  saving: boolean
}

function FieldRow({ field, isDraft, onSave, onCancel, onDelete, saving }: FieldRowProps) {
  const [local, setLocal] = useState<SensorFieldSchema>(field)
  // Когда снаружи приходит обновлённый field (например после успешного save),
  // ресинхронимся. Не делаем useEffect — local держится правкой ровно одной
  // строки; пользователь либо «Сохранил» (и пушится через onSave), либо
  // переключился на другую строку, локальный state создастся заново.

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
                onClick={() => onDelete?.(local)}
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

/**
 * JSON-skeleton текущей конфигурации полей. Отрисовывается под таблицей и в
 * PropertyPanel sensor-ноды (см. флоу-редактор). Аналитик копирует это как
 * образец payload для своего датчика.
 */
function JsonPreview({ group }: { group: { sensor_type: string; fields: SensorFieldSchema[] } }) {
  const payload: Record<string, unknown> = {}
  for (const f of group.fields) {
    payload[f.field_name] = decodeExample(f)
  }
  const wrapped = {
    description: `<краткое описание события от датчика ${group.sensor_type}>`,
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

/**
 * Распарсить example_value (JSON-строка) в подходящий sample.
 * Если distorted/empty — даём дефолт по datatype.
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
