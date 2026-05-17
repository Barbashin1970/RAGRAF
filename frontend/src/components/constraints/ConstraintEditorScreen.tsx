import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Code2,
  Download,
  Hash,
  Info,
  MessageSquare,
  Plus,
  Regex,
  Save,
  Shield,
  Trash2,
  Type,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { api, type Constraint } from '@/lib/api'
import { nanoid } from '@/lib/nanoid'
import { Button } from '@/components/ui'
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

// Тонировка select'а по текущему severity — чтобы строка читалась сразу
// (нарушение бросается в глаза, info уходит на второй план).
const SEVERITY_SELECT_TONE: Record<Constraint['severity'], string> = {
  violation: 'border-rose-300 bg-rose-50 text-rose-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-800',
  info: 'border-sky-300 bg-sky-50 text-sky-800',
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

  // R8 (Sigma-audit): обёрнуто в useMutation, чтобы ошибки сети не уходили
  // в unhandled rejection при `onClick={exportShacl}`. react-query сам
  // ловит throw из mutationFn и кладёт в mutation.error / onError.
  const exportShacl = useMutation({
    mutationFn: async () => {
      const ttl = await api.constraints.exportShacl(id)
      const blob = new Blob([ttl], { type: 'text/turtle' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${id}-shapes.ttl`
      a.click()
      URL.revokeObjectURL(url)
      return { ok: true as const }
    },
  })

  const patch = (i: number, p: Partial<EditableConstraint>) =>
    setRows((rs) => rs.map((r, j) => (i === j ? { ...r, ...p } : r)))

  const saving = save.isPending
  const importing = importShacl.isPending

  // dirty = текущие rows отличаются от загруженных constraints. Сравниваем
  // нормализованную форму (без служебного _new флага) — тот же паттерн что
  // в RegulationEditorScreen / FlowEditorScreen, чтобы кнопка Сохранить
  // была бледной когда нечего сохранять.
  const dirty = useMemo(() => {
    if (!data) return false
    const normalize = (cs: Constraint[]) =>
      JSON.stringify(cs.map((c) => ({ ...c })).sort((a, b) => a.id.localeCompare(b.id)))
    const stripped: Constraint[] = rows.map(({ _new: _, ...c }) => c)
    return normalize(data) !== normalize(stripped)
  }, [data, rows])

  const actions = (
    <>
      {/* Import — file-input спрятан в <label>; кастомное поведение нельзя
          целиком отдать <Button>. Используем тот же класс что и secondary, плюс
          синий tint иконки чтобы отличить от "Сохранить" / "Создать".

          Принимаем .ttl И .zip (SIGMA-bundle): пользователь может выгрузить
          bundle через «Экспорт в СИГМУ», поправить shapes.ttl в самом архиве
          (или в СИГМЕ) и вернуть тот же ZIP обратно. Backend извлечёт shapes.ttl
          из ZIP-а и применит к текущему регламенту. Для импорта самого
          регламента (data.ttl + создание/обновление в DuckDB) — отдельный
          путь через «Импорт из СИГМЫ» на странице списка. */}
      <label
        className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-stone-200 bg-white px-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50 ${importing ? 'opacity-60' : ''}`}
        title="Загрузить SHACL: Turtle (.ttl) или SIGMA-bundle (.zip — возьмём shapes.ttl изнутри)"
      >
        <Upload size={13} className="text-blue-600" />
        {importing ? 'Импорт…' : 'Импорт SHACL'}
        <input
          type="file"
          accept=".ttl,text/turtle,.zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importShacl.mutate(f)
            e.currentTarget.value = ''
          }}
        />
      </label>
      <Button
        size="sm"
        variant="secondary"
        icon={<Download size={13} className="text-emerald-600" />}
        onClick={() => exportShacl.mutate()}
        loading={exportShacl.isPending}
      >
        {exportShacl.isPending ? 'Экспорт…' : 'Экспорт SHACL'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Plus size={13} />}
        onClick={() => setRows((rs) => [...rs, EMPTY_ROW()])}
      >
        Добавить
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon={<Save size={13} />}
        loading={saving}
        disabled={!dirty || saving}
        onClick={() => save.mutate(rows.map(({ _new: _, ...c }) => c))}
      >
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </Button>
    </>
  )

  const stats = [
    { icon: Shield,         value: rows.length,            label: 'всего'           },
    { icon: AlertCircle,    value: severityCounts.violation, label: 'нарушений'      },
    { icon: AlertTriangle,  value: severityCounts.warning,   label: 'предупреждений' },
    { icon: Info,           value: severityCounts.info,      label: 'информационных' },
  ]

  const subHeader = (
    <>
      {importShacl.data && (
        <div className="border-t border-blue-200 bg-blue-50 px-5 py-1.5 text-xs text-blue-800">
          Импортировано {importShacl.data.merged_constraints} ограничений
          {importShacl.data.conflicts.length > 0 && ` · ${importShacl.data.conflicts.length} конфликтов перезаписано`}
        </div>
      )}
      {exportShacl.isError && (
        <div className="border-t border-rose-200 bg-rose-50 px-5 py-1.5 text-xs text-rose-700">
          Не удалось экспортировать SHACL: {(exportShacl.error as Error).message}
        </div>
      )}
    </>
  )

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
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-stone-500">
              <tr>
                <ColHeader icon={Code2} label="путь (sh:path)" />
                <ColHeader icon={Type} label="datatype" />
                <ColHeader icon={ArrowDownToLine} label="min" hint="нижняя граница диапазона" />
                <ColHeader icon={ArrowUpToLine} label="max" hint="верхняя граница диапазона" />
                <ColHeader icon={Hash} label="minCount" hint="минимальное число значений" />
                <ColHeader icon={Regex} label="pattern" />
                <ColHeader icon={AlertOctagon} label="severity" />
                <ColHeader icon={MessageSquare} label="сообщение" />
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
                      className={`${inp} font-medium ${SEVERITY_SELECT_TONE[r.severity]}`}
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

function ColHeader({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint?: string }) {
  return (
    <th className="px-2 py-1" title={hint}>
      <span className="inline-flex items-center gap-1.5 text-stone-500">
        <Icon size={12} className="text-stone-400" />
        {label}
      </span>
    </th>
  )
}

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
