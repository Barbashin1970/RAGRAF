import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Hammer,
  Play,
  PlayCircle,
  Search,
  Shield,
  Sliders,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { getDomainVisual } from '@/lib/domains'

/**
 * «Исполнение регламентов» — landing для runtime-режима.
 *
 * Текущая ценность: показывает что РАБОТАЕТ (симулятор) и что в работе
 * (приёмник СИГМЫ, журнал, webhook'и). Из списка регламентов одним кликом
 * переходишь в Flow Editor с авто-открытым ExecutePanel — это и есть
 * симулятор.
 *
 * Архитектурная роль: точка входа в «Execute Layer» (см. BACKLOG.md
 * §Phase 3). Сейчас только симулятор — это уровень MVP. Дальше: вкладки
 * «Журнал», «Источники», «Действия (webhooks)».
 */
interface DatasetItem {
  id: string
  name?: string
  domain?: string | null
  parameters_count?: number
  recommendations_count?: number
  priority?: number | null
}

export function ExecuteScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  // datasetsResponseSchema допускает оба варианта — голый array или
  // {items: array}. Нормализуем здесь, чтобы дальше работать с массивом.
  const datasets: DatasetItem[] = useMemo(() => {
    if (!data) return []
    if (Array.isArray(data)) return data as unknown as DatasetItem[]
    const items = (data as { items?: unknown }).items
    return Array.isArray(items) ? (items as unknown as DatasetItem[]) : []
  }, [data])

  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter((d) =>
      (d.name ?? '').toLowerCase().includes(q) ||
      (d.domain ?? '').toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q),
    )
  }, [datasets, filter])

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-emerald-100 p-2 text-emerald-700">
            <PlayCircle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold text-stone-900">Исполнение регламентов</h1>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                beta · работает частично
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stone-600">
              Runtime-уровень для регламентов: прогон с тестовым payload, подсветка пути,
              в перспективе — приёмник реальных событий от СИГМЫ и webhook-действия.
              Сейчас доступен симулятор: выберите регламент ниже → откроется Flow Editor
              с активной панелью «Запуск» справа.
            </p>
          </div>
        </div>

        <StatusGrid />
      </header>

      <main className="flex-1 px-6 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-stone-800">Регламенты для прогона</h2>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              placeholder="Фильтр по имени / домену…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-72 rounded-md border border-stone-200 bg-white py-1.5 pl-7 pr-2 text-sm placeholder-stone-400"
            />
          </div>
        </div>

        {isLoading && <div className="text-sm text-stone-500">Загрузка регламентов…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-500">
            Регламентов не найдено. Создайте регламент во вкладке{' '}
            <Link to="/regulations" className="text-primary hover:underline">«Регламенты»</Link>.
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d) => (
            <RegulationCard key={d.id} dataset={d} />
          ))}
        </div>
      </main>
    </div>
  )
}


/** Грид «что работает / что в работе» — четыре блока в шапке. */
function StatusGrid() {
  const works: Array<{ icon: typeof CheckCircle2; label: string; hint: string }> = [
    {
      icon: CheckCircle2,
      label: 'Симулятор регламента',
      hint: 'POST /api/regulations/{id}/execute — прогон с тестовым payload, level + recommendation в ответе',
    },
    {
      icon: CheckCircle2,
      label: 'Подсветка пути на канвасе',
      hint: 'fired_nodes / fired_edges в trace; зелёный glow по сработавшим узлам и рёбрам',
    },
    {
      icon: CheckCircle2,
      label: 'Библиотека датчиков (классы / подтипы)',
      hint: '/sensors — CRUD по полям payload для каждого подтипа',
    },
  ]
  const wip: Array<{ icon: typeof Clock; label: string; hint: string }> = [
    {
      icon: Clock,
      label: 'Приёмник событий от СИГМЫ',
      hint: 'POST /api/events/ingest — маппинг payload → SensorReading[], авто-вызов execute. В бэклоге.',
    },
    {
      icon: Clock,
      label: 'Журнал срабатываний',
      hint: 'DuckDB-таблица events + UI-timeline. В бэклоге §«Приёмник событий».',
    },
    {
      icon: Clock,
      label: 'Webhook-actions на OUTPUT',
      hint: 'OUTPUT-нода может вызывать внешний URL с шаблоном payload. В бэклоге §Event-driven execution.',
    },
    {
      icon: Clock,
      label: 'ETL match-event (поиск регламента по payload)',
      hint: 'POST /api/etl/match-event — найти регламенты по полям payload. В бэклоге §Граф × Библиотека датчиков.',
    },
  ]
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
          Работает сейчас
        </div>
        <ul className="space-y-1">
          {works.map((w) => {
            const I = w.icon
            return (
              <li key={w.label} className="flex items-start gap-1.5 text-xs text-stone-700">
                <I size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <span className="font-medium text-stone-800">{w.label}</span>
                  <span className="ml-1 text-stone-500">— {w.hint}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          <Hammer size={11} />
          В работе (бэклог)
        </div>
        <ul className="space-y-1">
          {wip.map((w) => {
            const I = w.icon
            return (
              <li key={w.label} className="flex items-start gap-1.5 text-xs text-stone-700">
                <I size={12} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <span className="font-medium text-stone-800">{w.label}</span>
                  <span className="ml-1 text-stone-500">— {w.hint}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}


function RegulationCard({ dataset }: { dataset: DatasetItem }) {
  const v = getDomainVisual(dataset.domain ?? null)
  const Icon = v.icon
  return (
    <div className={cn('flex flex-col gap-2 rounded-md border bg-white p-3 shadow-sm', 'border-stone-200')}>
      <div className="flex items-start gap-2">
        <div className={cn('rounded-md p-1.5', v.chipBg, v.chipFg)}>
          <Icon size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/regulations/${encodeURIComponent(dataset.id)}/edit`}
            className="line-clamp-2 text-sm font-medium text-stone-900 hover:underline"
            title={dataset.name ?? dataset.id}
          >
            {dataset.name ?? dataset.id}
          </Link>
          <div className="mt-0.5 font-mono text-[10px] text-stone-500">{dataset.id}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
        <span className="inline-flex items-center gap-1">
          <Sliders size={11} className="text-stone-400" />
          {dataset.parameters_count ?? 0} параметров
        </span>
        <span className="inline-flex items-center gap-1">
          <Shield size={11} className="text-stone-400" />
          {dataset.recommendations_count ?? 0} рекомендаций
        </span>
        {dataset.priority != null && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              dataset.priority === 1 ? 'bg-rose-100 text-rose-700' :
              dataset.priority === 2 ? 'bg-amber-100 text-amber-700' :
                                         'bg-stone-100 text-stone-600',
            )}
          >
            <AlertCircle size={10} />
            level {dataset.priority}
          </span>
        )}
      </div>
      <Link
        to={`/regulations/${encodeURIComponent(dataset.id)}/flow?run=1`}
        className="mt-auto"
      >
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={12} />}
          className="w-full justify-center"
        >
          Симулировать
        </Button>
      </Link>
    </div>
  )
}
