import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CheckSquare,
  ExternalLink,
  FileText,
  Loader2,
  ScrollText,
  Square,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { getDomainVisual } from '@/lib/domains'

/**
 * Левая панель «Регламенты» — список регламентов с галкой «использовать
 * в retrieval'е этого чата». Параллельно DocumentsPanel — UX похож:
 * галочка для включения/исключения, badge с числом параметров, ссылка
 * в редактор. Группировка по доменам, чтобы при 30+ регламентах
 * можно было быстро отключить весь домен.
 *
 * Зачем: когда юзер просит «суммаризируй этот PDF», лезть в корпус
 * регламентов LLM не нужно — это пустая трата токенов на prompt-eval и
 * шанс «подмесить» нерелевантную регламентную выдачу в ответ. Снимая
 * галки с регламентов целиком, мы сужаем контекст до документов.
 *
 * Состояние «что отключено» живёт в SearchDemo (per-chat), без persistence.
 */

interface RegItem {
  id: string
  name: string
  domain: string | null
  parameters_count?: number
}

interface Props {
  /** Идентификаторы регламентов, ИСКЛЮЧЁННЫХ из контекста. */
  disabledIds: Set<string>
  onToggle: (regulationId: string, nextDisabled: boolean) => void
  onSetMany: (ids: string[], disabled: boolean) => void
}

export function RegulationsPanel({ disabledIds, onToggle, onSetMany }: Props) {
  const { data: raw, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const { data: domainList } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  // Достаём id/name/domain из дискриминированного объединения datasets API.
  const items: RegItem[] = useMemo(() => {
    if (!raw) return []
    const arr: unknown[] = Array.isArray(raw)
      ? raw
      : 'items' in raw && Array.isArray(raw.items)
        ? raw.items
        : []
    const out: RegItem[] = []
    for (const d of arr) {
      if (typeof d === 'string') {
        out.push({ id: d, name: d, domain: null })
      } else if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>
        const id = (o.id ?? o.source_id ?? o.dataset_id) as string | undefined
        if (typeof id !== 'string') continue
        out.push({
          id,
          name: typeof o.name === 'string' ? o.name : id,
          domain: typeof o.domain === 'string' ? o.domain : null,
          parameters_count: typeof o.parameters_count === 'number' ? o.parameters_count : undefined,
        })
      }
    }
    return out
  }, [raw])

  // Группировка по доменам — порядок такой же как в RegulationList:
  // сначала seed-домены в их «нативном» порядке, потом всё остальное.
  const byDomain = useMemo(() => {
    const m = new Map<string | null, RegItem[]>()
    for (const it of items) {
      const k = it.domain ?? null
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(it)
    }
    return m
  }, [items])

  const totalEnabled = items.length - items.filter((r) => disabledIds.has(r.id)).length
  const allOff = totalEnabled === 0
  const allOn = totalEnabled === items.length && items.length > 0

  const allIds = items.map((it) => it.id)
  const toggleAll = () => {
    if (allOff) onSetMany(allIds, false)
    else onSetMany(allIds, true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Шапка: counter включённых + master-toggle */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Регламенты
          </div>
          <div className="text-sm font-semibold text-stone-800">
            {isLoading ? 'Загрузка…' : `${totalEnabled} / ${items.length} включено`}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAll}
          disabled={items.length === 0}
          title={
            allOff
              ? 'Включить все регламенты в контекст'
              : 'Исключить все регламенты — LLM будет отвечать только по документам'
          }
        >
          {allOff ? 'Все' : 'Никого'}
        </Button>
      </header>

      {/* Список */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center py-6 text-xs text-stone-500">
            <Loader2 size={14} className="mr-2 animate-spin" />
            Загрузка списка…
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-3 text-center text-[11px] leading-snug text-stone-500">
            В корпусе пока нет регламентов. Создай первый в разделе{' '}
            <Link to="/regulations" className="font-medium text-violet-700 underline-offset-2 hover:underline">
              «Регламенты»
            </Link>
            .
          </div>
        )}

        {Array.from(byDomain.entries()).map(([domain, list]) => (
          <DomainGroup
            key={domain ?? '__none__'}
            domain={domain}
            domainLabel={
              domain
                ? domainList?.find((d) => d.id === domain)?.label ?? domain
                : 'Без домена'
            }
            items={list}
            disabledIds={disabledIds}
            onToggle={onToggle}
            onSetMany={onSetMany}
          />
        ))}
      </div>

      {/* Footer: подсказка */}
      <footer className="border-t border-stone-200 bg-white px-3 py-2 text-[10px] leading-snug text-stone-500">
        <div className="flex items-start gap-1.5">
          <ScrollText size={11} className="mt-0.5 shrink-0 text-stone-400" />
          <span>
            Снятая галка = регламент <b>не попадёт</b> в retrieval и system-prompt.
            {allOn && ' Сейчас все включены — стандартный сценарий.'}
            {allOff && ' Все исключены — LLM ответит только по документам слева.'}
          </span>
        </div>
      </footer>
    </div>
  )
}

function DomainGroup({
  domain,
  domainLabel,
  items,
  disabledIds,
  onToggle,
  onSetMany,
}: {
  domain: string | null
  domainLabel: string
  items: RegItem[]
  disabledIds: Set<string>
  onToggle: (id: string, disabled: boolean) => void
  onSetMany: (ids: string[], disabled: boolean) => void
}) {
  const v = domain ? getDomainVisual(domain) : null
  const enabledHere = items.length - items.filter((r) => disabledIds.has(r.id)).length
  const groupIds = items.map((r) => r.id)
  const allOff = enabledHere === 0
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        {v && (
          <span className={cn('inline-block h-2 w-2 rounded-full', v.accent)} />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
          {domainLabel}
        </span>
        <span className="text-[10px] text-stone-400">
          {enabledHere}/{items.length}
        </span>
        <button
          onClick={() => onSetMany(groupIds, !allOff)}
          className="ml-auto rounded px-1 py-0.5 text-[10px] text-violet-700 hover:bg-violet-50"
          title={allOff ? 'Включить всю группу' : 'Выключить всю группу'}
        >
          {allOff ? '+ все' : '− все'}
        </button>
      </div>
      <div className="space-y-1">
        {items.map((reg) => (
          <RegRow
            key={reg.id}
            reg={reg}
            disabled={disabledIds.has(reg.id)}
            onToggle={(d) => onToggle(reg.id, d)}
          />
        ))}
      </div>
    </div>
  )
}

function RegRow({
  reg,
  disabled,
  onToggle,
}: {
  reg: RegItem
  disabled: boolean
  onToggle: (disabled: boolean) => void
}) {
  const v = getDomainVisual(reg.domain)
  const Toggler = disabled ? Square : CheckSquare
  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-md border bg-white p-2 transition',
        disabled ? 'border-stone-200 opacity-60' : 'border-violet-200 shadow-sm',
      )}
    >
      <button
        onClick={() => onToggle(!disabled)}
        className={cn(
          'mt-0.5 shrink-0 transition',
          disabled
            ? 'text-stone-400 hover:text-stone-600'
            : 'text-violet-600 hover:text-violet-700',
        )}
        title={disabled ? 'Включить в контекст' : 'Исключить из контекста'}
        aria-pressed={!disabled}
      >
        <Toggler size={15} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('shrink-0 rounded px-1 py-0.5', v.iconBg)}>
            <FileText size={9} className={v.iconFg} />
          </span>
          <div
            className="line-clamp-2 text-xs font-medium leading-tight text-stone-800"
            title={reg.name}
          >
            {reg.name}
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-500">
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px]">
            {reg.id}
          </code>
          {reg.parameters_count !== undefined && (
            <span>{reg.parameters_count} парам.</span>
          )}
        </div>
      </div>
      <Link
        to={`/regulations/${reg.id}/edit`}
        className="shrink-0 rounded p-1 text-stone-300 opacity-0 transition hover:bg-violet-50 hover:text-violet-600 group-hover:opacity-100"
        title="Открыть в редакторе"
      >
        <ExternalLink size={11} />
      </Link>
    </div>
  )
}
