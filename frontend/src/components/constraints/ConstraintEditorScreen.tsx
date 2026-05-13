import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, Download, Info, Plus, Save, Shield, Trash2, Upload } from 'lucide-react'
import { api, type Constraint } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { RegulationHeader } from '../regulations/RegulationHeader'

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
  const { data: regulation, isLoading: regLoading } = useQuery({
    queryKey: ['regulation', id],
    queryFn: () => api.regulations.get(id),
    enabled: !!id,
  })
  const [rows, setRows] = useState<EditableConstraint[]>([])
  useEffect(() => setRows((data ?? []).map((c) => ({ ...c }))), [data])

  const severityCounts = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc[r.severity] = (acc[r.severity] ?? 0) + 1
        return acc
      },
      { violation: 0, warning: 0, info: 0 } as Record<Constraint['severity'], number>,
    )
  }, [rows])

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

  const saving = save.isPending
  const importing = importShacl.isPending

  const actions = (
    <>
      <label
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 ${importing ? 'opacity-60' : ''}`}
      >
        <Upload size={13} className="text-blue-500" />
        {importing ? 'Импорт…' : 'Импорт SHACL'}
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
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        <Download size={13} className="text-emerald-500" /> Экспорт SHACL
      </button>
      <button
        onClick={() => setRows((rs) => [...rs, EMPTY_ROW()])}
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50"
      >
        <Plus size={13} className="text-stone-500" /> Добавить
      </button>
      <button
        onClick={() => save.mutate(rows.map(({ _new, ...c }) => c))}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
      >
        <Save size={13} />
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </>
  )

  const stats = [
    { icon: Shield,         value: rows.length,            label: 'всего'           },
    { icon: AlertCircle,    value: severityCounts.violation, label: 'нарушений'      },
    { icon: AlertTriangle,  value: severityCounts.warning,   label: 'предупреждений' },
    { icon: Info,           value: severityCounts.info,      label: 'информационных' },
  ]

  const subHeader = importShacl.data ? (
    <div className="border-t border-blue-200 bg-blue-50 px-5 py-1.5 text-xs text-blue-800">
      Импортировано {importShacl.data.merged_constraints} ограничений
      {importShacl.data.conflicts.length > 0 && ` · ${importShacl.data.conflicts.length} конфликтов перезаписано`}
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <RegulationHeader
        regulation={regulation}
        isLoading={regLoading}
        sourceId={id}
        active="constraints"
        stats={stats}
        actions={actions}
        subHeader={subHeader}
      />

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
