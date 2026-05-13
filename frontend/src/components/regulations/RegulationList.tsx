import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, GitBranch, Shield } from 'lucide-react'
import { api, type Domain } from '@/lib/api'

interface RegRow {
  id: string
  name: string
  domain: string | null
}

function extractRow(d: unknown): RegRow | null {
  if (typeof d === 'string') return { id: d, name: d, domain: null }
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>
    const id = (o.id ?? o.source_id ?? o.dataset_id ?? o.uuid) as string | undefined
    if (typeof id !== 'string') return null
    const name = typeof o.name === 'string' ? o.name : id
    const domain = typeof o.domain === 'string' ? o.domain : null
    return { id, name, domain }
  }
  return null
}

export function RegulationList() {
  const { data: rawDatasets, isLoading, error } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  const items: RegRow[] = (() => {
    if (!rawDatasets) return []
    const arr = Array.isArray(rawDatasets)
      ? rawDatasets
      : Array.isArray((rawDatasets as any).items) ? (rawDatasets as any).items : []
    return arr.map(extractRow).filter(Boolean) as RegRow[]
  })()

  // Группировка по доменам в порядке из /api/domains, плюс «без домена» в хвосте
  const byDomain = new Map<string | null, RegRow[]>()
  for (const it of items) {
    const key = it.domain ?? null
    if (!byDomain.has(key)) byDomain.set(key, [])
    byDomain.get(key)!.push(it)
  }
  const orderedKeys: Array<string | null> = [
    ...domains.map((d) => d.id),
    ...Array.from(byDomain.keys()).filter((k) => k && !domains.some((d) => d.id === k)),
    null,
  ].filter((k, i, a) => a.indexOf(k) === i)

  return (
    <div className="h-full overflow-auto px-6 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">Регламенты</h1>
        <div className="text-xs text-stone-500">источник: upstream /admin/datasets</div>
      </div>

      {isLoading && <div className="text-sm text-stone-500">Загрузка…</div>}
      {error && (
        <div className="rounded-md border border-accent-notification bg-accent-notification-highlight px-3 py-2 text-sm text-accent-notification">
          Не удалось загрузить список: {(error as Error).message}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="rounded-md border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          Регламенты не найдены. Создайте dataset через upstream API
          <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">POST /api/v1/regulations/admin/datasets/&#123;app_id&#125;</code>.
        </div>
      )}

      {orderedKeys.map((key) => {
        const group = byDomain.get(key)
        if (!group || group.length === 0) return null
        const domain = domains.find((d) => d.id === key)
        return (
          <DomainSection
            key={key ?? '_undef'}
            domain={domain ?? null}
            fallbackKey={key}
            items={group}
          />
        )
      })}
    </div>
  )
}

function DomainSection({
  domain,
  fallbackKey,
  items,
}: {
  domain: Domain | null
  fallbackKey: string | null
  items: RegRow[]
}) {
  const label = domain?.label ?? (fallbackKey ?? 'Без домена')
  return (
    <section className="mb-6">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">{label}</h2>
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] text-stone-600">{items.length}</span>
      </header>
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2">Название</th>
            <th className="px-3 py-2">ID источника</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="bg-white shadow-sm">
              <td className="rounded-l-md px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 font-mono text-xs text-stone-500">{r.id}</td>
              <td className="rounded-r-md px-3 py-2 text-right">
                <div className="inline-flex gap-1.5">
                  <Link
                    to={`/regulations/${r.id}/flow`}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset"
                  >
                    <GitBranch size={12} /> Поток
                  </Link>
                  <Link
                    to={`/regulations/${r.id}/constraints`}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset"
                  >
                    <Shield size={12} /> Ограничения
                  </Link>
                  <Link
                    to={r.domain ? `/graph?domain=${r.domain}` : '/graph'}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:bg-surface-offset"
                  >
                    <Activity size={12} /> Граф
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
