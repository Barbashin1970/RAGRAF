import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Save, Trash2, Upload } from 'lucide-react'
import { api, type Constraint } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'

type EditableConstraint = Constraint & { _new?: boolean }

const EMPTY_ROW = (): EditableConstraint => ({
  id: `c_${nanoid(6)}`,
  targetClass: 'Regulation',
  path: '',
  datatype: 'decimal',
  severity: 'violation',
  _new: true,
})

const SEVERITY_LABEL: Record<Constraint['severity'], string> = {
  violation: 'нарушение',
  warning: 'предупреждение',
  info: 'информация',
}

export function ConstraintEditorScreen() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const key = ['constraints', id] as const

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.constraints.list(id), enabled: !!id })
  const [rows, setRows] = useState<EditableConstraint[]>([])
  useEffect(() => setRows((data ?? []).map((c) => ({ ...c }))), [data])

  const save = useMutation({
    mutationFn: (items: Constraint[]) => api.constraints.save(id, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const importShacl = useMutation({
    mutationFn: (file: File) => api.constraints.importShacl(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const exportShacl = async () => {
    const ttl = await api.constraints.exportShacl(id)
    const blob = new Blob([ttl], { type: 'text/turtle' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}-shapes.ttl`
    a.click()
    URL.revokeObjectURL(url)
  }

  const patch = (i: number, p: Partial<EditableConstraint>) =>
    setRows((rs) => rs.map((r, j) => (i === j ? { ...r, ...p } : r)))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-2 text-sm">
        <div className="font-semibold">Ограничения</div>
        <div className="text-xs text-stone-500">{rows.length} строк</div>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset">
            <Upload size={12} />
            Импорт SHACL
            <input
              type="file"
              accept=".ttl,text/turtle"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importShacl.mutate(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <button
            onClick={exportShacl}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset"
          >
            <Download size={12} /> Экспорт SHACL
          </button>
          <button
            onClick={() => setRows((rs) => [...rs, EMPTY_ROW()])}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset"
          >
            <Plus size={12} /> Добавить
          </button>
          <button
            onClick={() => save.mutate(rows.map(({ _new, ...c }) => c))}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-white hover:opacity-90"
          >
            <Save size={12} /> Сохранить
          </button>
        </div>
      </div>

      {importShacl.data && (
        <div className="bg-accent-blue-highlight px-4 py-1.5 text-xs text-stone-700">
          Импортировано {importShacl.data.merged_constraints} ограничений
          {importShacl.data.conflicts.length > 0 && ` · ${importShacl.data.conflicts.length} конфликтов перезаписано`}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-stone-500">Загрузка…</div>
        ) : (
          <table className="w-full border-separate border-spacing-y-1 px-3 py-3 text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-1">Путь (sh:path)</th>
                <th className="px-2 py-1">datatype</th>
                <th className="px-2 py-1">min ⩽</th>
                <th className="px-2 py-1">⩽ max</th>
                <th className="px-2 py-1">minCount</th>
                <th className="px-2 py-1">pattern</th>
                <th className="px-2 py-1">severity</th>
                <th className="px-2 py-1">Сообщение</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="bg-white shadow-sm">
                  <td className="rounded-l-md px-2 py-1">
                    <input className={inp} value={r.path} onChange={(e) => patch(i, { path: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className={inp}
                      value={r.datatype ?? ''}
                      onChange={(e) => patch(i, { datatype: e.target.value || null })}
                    >
                      <option value="decimal">decimal</option>
                      <option value="string">string</option>
                      <option value="date">date</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </td>
                  <td className="px-2 py-1"><NumberCell value={r.minInclusive} onChange={(v) => patch(i, { minInclusive: v })} /></td>
                  <td className="px-2 py-1"><NumberCell value={r.maxInclusive} onChange={(v) => patch(i, { maxInclusive: v })} /></td>
                  <td className="px-2 py-1"><NumberCell value={r.minCount} onChange={(v) => patch(i, { minCount: v })} /></td>
                  <td className="px-2 py-1">
                    <input className={inp} value={r.pattern ?? ''} onChange={(e) => patch(i, { pattern: e.target.value || null })} />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className={inp}
                      value={r.severity}
                      onChange={(e) => patch(i, { severity: e.target.value as Constraint['severity'] })}
                    >
                      {(Object.keys(SEVERITY_LABEL) as Constraint['severity'][]).map((s) => (
                        <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input className={inp} value={r.message ?? ''} onChange={(e) => patch(i, { message: e.target.value || null })} />
                  </td>
                  <td className="rounded-r-md px-2 py-1 text-right">
                    <button
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      className="text-accent-notification hover:bg-accent-notification-highlight rounded p-1"
                      title="Удалить"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-stone-500">
                    Нет ограничений. Добавьте строку или импортируйте SHACL.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const inp = 'w-full rounded border border-stone-200 px-2 py-1 text-sm'

function NumberCell({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void }) {
  const [local, setLocal] = useState(value === null || value === undefined ? '' : String(value))
  useEffect(() => setLocal(value === null || value === undefined ? '' : String(value)), [value])
  return (
    <input
      type="number"
      className={inp}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onChange(local === '' ? null : Number(local))}
    />
  )
}
