import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  AlignLeft,
  BookOpen,
  Boxes,
  Copy,
  Download,
  FileText,
  LayoutGrid,
  ListTree,
  Loader2,
  type LucideIcon,
  Network,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Shield,
  Sliders,
  Star,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import { api, type Domain } from '@/lib/api'
import { cn } from '@/lib/cn'
import { type DomainVisual, FALLBACK_VISUAL, getDomainVisual } from '@/lib/domains'
import {
  Badge,
  Button,
  EmptyState as EmptyStateBlock,
  PageBody,
  PageHeader,
  PageShell,
} from '@/components/ui'
import { CreateRegulationDialog } from './CreateRegulationDialog'
import { CreateDomainDialog } from './CreateDomainDialog'

interface RegRow {
  id: string
  name: string
  domain: string | null
  parameters_count?: number
  constraints_count?: number
  recommendations_count?: number
  // SIGMA-compliance: критичность (priority 1/2/3) + срок + норматив.
  priority?: 1 | 2 | 3 | null
  valid_to?: string | null
  source_document?: string | null
  // PROV-O attachment indicators (на карточке показываем только наличие, не значение).
  has_source_file?: boolean
  has_source_url?: boolean
}

function extractRow(d: unknown): RegRow | null {
  if (typeof d === 'string') return { id: d, name: d, domain: null }
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>
    const id = (o.id ?? o.source_id ?? o.dataset_id ?? o.uuid) as string | undefined
    if (typeof id !== 'string') return null
    const name = typeof o.name === 'string' ? o.name : id
    const domain = typeof o.domain === 'string' ? o.domain : null
    const pr = typeof o.priority === 'number' && [1, 2, 3].includes(o.priority)
      ? (o.priority as 1 | 2 | 3)
      : null
    return {
      id,
      name,
      domain,
      parameters_count: typeof o.parameters_count === 'number' ? o.parameters_count : undefined,
      constraints_count: typeof o.constraints_count === 'number' ? o.constraints_count : undefined,
      recommendations_count: typeof o.recommendations_count === 'number' ? o.recommendations_count : undefined,
      priority: pr,
      valid_to: typeof o.valid_to === 'string' ? o.valid_to : null,
      source_document: typeof o.source_document === 'string' ? o.source_document : null,
      has_source_file: typeof o.source_file_path === 'string' && o.source_file_path.length > 0,
      has_source_url: typeof o.source_url === 'string' && o.source_url.length > 0,
    }
  }
  return null
}

const PRIORITY_META: Record<1 | 2 | 3, { label: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  1: { label: 'критический', tone: 'danger' },
  2: { label: 'важный', tone: 'warning' },
  3: { label: 'обычный', tone: 'neutral' },
}

function expirationBadge(valid_to: string | null | undefined): { label: string; tone: 'danger' | 'warning' } | null {
  if (!valid_to) return null
  const exp = new Date(valid_to + 'T00:00:00')
  if (isNaN(exp.getTime())) return null
  const now = new Date()
  const days = Math.floor((exp.getTime() - now.getTime()) / 86_400_000)
  if (days < 0) return { label: `истёк ${valid_to}`, tone: 'danger' }
  if (days < 60) return { label: `до ${valid_to}`, tone: 'warning' }
  return null
}

// id'ы seed-доменов из бэкенда (fixtures.DOMAINS). Их нельзя удалить из UI,
// поэтому корзина не показывается. Если на бэке появятся новые seed-домены,
// сюда тоже нужно добавить — иначе UI предложит удалить, а сервер ответит 409.
const SEED_DOMAIN_IDS = new Set(['heating', 'housing', 'safety', 'environment'])

// ── UX-state hooks ────────────────────────────────────────────────────
//
// «Мои регламенты» — личный рабочий набор аналитика, чтобы быстро находить
// 2-3 регламента, над которыми он сейчас работает, не листая все 20+.
// Storage в localStorage — позже синхронизируется с user-prefs БД.
const STARRED_KEY = 'ragraf:starred-regulations:v1'

function useStarred() {
  const [starred, setStarred] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STARRED_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const toggle = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(STARRED_KEY, JSON.stringify([...next]))
      } catch {
        // localStorage может упасть в private mode — это ОК, состояние
        // живёт в памяти до перезагрузки.
      }
      return next
    })
  }, [])
  return { starred, toggle }
}

// Плотность отображения списка — 2 режима в Phase 1. Compact даёт ~3x больше
// регламентов на экран; cards — для медленного методологического чтения.
type Density = 'cards' | 'compact'
const DENSITY_KEY = 'ragraf:list-density:v1'

function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensityState] = useState<Density>(() => {
    try {
      const v = localStorage.getItem(DENSITY_KEY)
      return v === 'compact' ? 'compact' : 'cards'
    } catch {
      return 'cards'
    }
  })
  const setDensity = useCallback((d: Density) => {
    setDensityState(d)
    try {
      localStorage.setItem(DENSITY_KEY, d)
    } catch {}
  }, [])
  return [density, setDensity]
}

export function RegulationList() {
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateDomain, setShowCreateDomain] = useState(false)
  const [filterTab, setFilterTab] = useState<'all' | 'starred'>('all')
  const [density, setDensity] = useDensity()
  const { starred, toggle: toggleStar } = useStarred()
  const qc = useQueryClient()
  const { data: rawDatasets, isLoading, error } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  // Импорт SIGMA-bundle (ZIP) обратно в RAGRAF. Принимает single или corpus
  // bundle — backend сам различает по структуре ZIP. На успех инвалидируем
  // и список регламентов, и domains (если домены пересортируются).
  const importBundle = useMutation({
    mutationFn: (file: File) => api.regulations.importSigmaBundle(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['domains'] })
    },
  })

  const items: RegRow[] = useMemo(() => {
    if (!rawDatasets) return []
    // После zod-валидации `rawDatasets` — discriminated union: либо массив, либо
    // объект `{ items: [...] }`. R7.1 закрыт без `as any` — TS сам сужает.
    const arr: unknown[] = Array.isArray(rawDatasets)
      ? rawDatasets
      : ('items' in rawDatasets && Array.isArray(rawDatasets.items)) ? rawDatasets.items : []
    return arr.map(extractRow).filter(Boolean) as RegRow[]
  }, [rawDatasets])

  const filtered = useMemo(() => {
    let base = items
    if (filterTab === 'starred') {
      base = base.filter((r) => starred.has(r.id))
    }
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter((r) =>
      r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    )
  }, [items, query, filterTab, starred])

  const starredCount = useMemo(
    () => items.filter((r) => starred.has(r.id)).length,
    [items, starred],
  )

  const byDomain = useMemo(() => {
    const m = new Map<string | null, RegRow[]>()
    for (const it of filtered) {
      const key = it.domain ?? null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(it)
    }
    return m
  }, [filtered])

  const orderedKeys: Array<string | null> = useMemo(() => {
    const known = domains.map((d) => d.id)
    const others = Array.from(byDomain.keys()).filter(
      (k) => k && !known.includes(k as string),
    ) as string[]
    return [...known, ...others, null].filter((k, i, a) => a.indexOf(k) === i)
  }, [domains, byDomain])

  const totals = useMemo(() => {
    return items.reduce(
      (acc, r) => {
        acc.regs += 1
        acc.params += r.parameters_count ?? 0
        acc.constraints += r.constraints_count ?? 0
        return acc
      },
      { regs: 0, params: 0, constraints: 0 },
    )
  }, [items])

  return (
    <PageShell>
      <PageHeader
        icon={ListTree}
        tone="model"
        title="Цифровые регламенты"
        badges={
          <>
            <Badge tone="info" uppercase>Model Layer</Badge>
            <Badge tone="neutral">SIGMA §4.1.3</Badge>
          </>
        }
        description="Машиноисполняемые представления норм: параметры, SHACL-ограничения, потоки реагирования. Каждый связан с источником в нормативной базе и периодом действия."
        actions={
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <Stat icon={FileText} value={totals.regs}        label="регл." />
            <Stat icon={Boxes}    value={domains.length}     label="дом." />
            <Stat icon={Sliders}  value={totals.params}      label="парам." />
            <Stat icon={Shield}   value={totals.constraints} label="огр." />
          </div>
        }
      >
        {/* Тулбар: поиск + primary-кнопка создания. Под header'ом, в той же
            белой плашке — на одной визуальной плоскости с метриками выше. */}
        <div className="mt-4 flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию или ID источника…"
              className="w-full rounded-md border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-stone-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <Button
            variant="secondary"
            icon={<Download size={14} className="text-emerald-600" />}
            onClick={() => {
              // Batch SIGMA export. Прямая GET-навигация — браузер качает ZIP.
              window.location.href = '/api/sigma-export/corpus'
            }}
            title="Скачать ZIP со всем корпусом регламентов в SIGMA-совместимом формате (data.ttl + shapes.ttl на каждый)"
          >
            Экспорт в СИГМУ
          </Button>
          {/* Import — file-input не получается засунуть внутрь <Button>
              (button не может содержать input как форму), поэтому используем
              <label>. Стили один-в-один совпадают с `Button variant=secondary
              size=md` чтобы шрифт/высота/отступы не «прыгали» относительно
              Export-кнопки слева. */}
          <label
            className={cn(
              'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50',
              importBundle.isPending && 'cursor-wait opacity-60',
            )}
            title="Загрузить ZIP с регламентами из СИГМЫ (data.ttl + shapes.ttl): создаст или обновит регламенты в локальной БД"
          >
            <Upload size={14} className="text-blue-600" />
            {importBundle.isPending ? 'Импорт…' : 'Импорт из СИГМЫ'}
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importBundle.mutate(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <Button
            variant="secondary"
            icon={<Boxes size={14} />}
            onClick={() => setShowCreateDomain(true)}
            title="Новый домен — крупный смысловой кластер для регламентов"
          >
            Создать домен
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
            Создать регламент
          </Button>
        </div>
      </PageHeader>

      <CreateRegulationDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <CreateDomainDialog open={showCreateDomain} onClose={() => setShowCreateDomain(false)} />

      {/* Inline-баннер с результатом импорта. Не модалка — пользователь видит
          обновлённый список регламентов под ним и понимает что добавилось. */}
      {importBundle.data && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Upload size={14} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Импорт завершён: добавлено / обновлено {importBundle.data.total_imported}
              {importBundle.data.total_skipped > 0 && `, пропущено ${importBundle.data.total_skipped}`}
              {importBundle.data.total_failed > 0 && `, ошибок ${importBundle.data.total_failed}`}
            </div>
            {importBundle.data.imported.length > 0 && (
              <div className="mt-1 text-xs text-emerald-700">
                {importBundle.data.imported.map((it) => it.source_id).join(', ')}
              </div>
            )}
            {importBundle.data.failed.length > 0 && (
              <ul className="mt-1 text-xs text-rose-700">
                {importBundle.data.failed.map((f, i) => (
                  <li key={f.source_id ?? i}>
                    <code className="rounded bg-rose-100 px-1">{f.source_id}</code> — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => importBundle.reset()}
            className="shrink-0 rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
            aria-label="Закрыть"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {importBundle.isError && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            Не удалось импортировать: <span className="font-mono text-xs">{(importBundle.error as Error).message}</span>
          </div>
          <button
            onClick={() => importBundle.reset()}
            className="shrink-0 rounded p-0.5 text-rose-700 hover:bg-rose-100"
            aria-label="Закрыть"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <PageBody>
        {/* Sub-toolbar: вкладки фильтра + переключатель плотности.
            Live preview UX-эксперимента в Phase 1 backlog'а: «Мои регламенты»
            (рабочий набор аналитика) + density toggle. */}
        <div className="mb-4 flex items-center justify-between border-b border-stone-200 pb-2">
          <div className="flex items-center gap-1 text-sm">
            <TabButton
              active={filterTab === 'all'}
              onClick={() => setFilterTab('all')}
              icon={ListTree}
              label="Все"
              count={items.length}
            />
            <TabButton
              active={filterTab === 'starred'}
              onClick={() => setFilterTab('starred')}
              icon={Star}
              label="Мои"
              count={starredCount}
              accentTone="amber"
            />
          </div>
          <DensityToggle density={density} setDensity={setDensity} />
        </div>

        {filterTab === 'starred' && starredCount === 0 && (
          <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/40 p-6 text-center text-sm text-stone-600">
            <Star size={20} className="mx-auto mb-2 text-amber-400" />
            <div className="font-medium text-stone-800">«Мои регламенты» пусты</div>
            <p className="mt-1 text-xs text-stone-500">
              Кликни на ⭐ на любом регламенте — он попадёт сюда. Удобно держать здесь те,
              над которыми работаешь сейчас, чтобы не листать весь корпус.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader2 size={14} className="animate-spin" /> Загрузка регламентов…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle size={14} className="mt-0.5" />
            <div>
              Не удалось загрузить список: <span className="font-mono">{(error as Error).message}</span>
            </div>
          </div>
        )}

        {!isLoading && items.length === 0 && !error && (
          <EmptyStateBlock
            icon={FileText}
            title="Регламентов пока нет"
            description={
              <>
                Создай первый регламент из шаблона домена, или импортируй через upstream API.
              </>
            }
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
                Создать регламент
              </Button>
            }
          />
        )}

        {!isLoading && items.length > 0 && filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-500">
            По запросу «<b>{query}</b>» ничего не найдено.
          </div>
        )}

        {orderedKeys.map((key) => {
          const group = byDomain.get(key)
          if (!group || group.length === 0) return null
          return (
            <DomainSection
              key={key ?? '_undef'}
              domain={domains.find((d) => d.id === key) ?? null}
              fallbackKey={key}
              items={group}
              density={density}
              starred={starred}
              onToggleStar={toggleStar}
            />
          )
        })}
      </PageBody>
    </PageShell>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  accentTone,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
  count: number
  accentTone?: 'amber'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition',
        active
          ? 'bg-stone-900 text-white shadow-sm'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
      )}
    >
      <Icon
        size={14}
        className={cn(
          active ? '' : accentTone === 'amber' && count > 0 ? 'fill-amber-400 text-amber-500' : 'text-stone-400',
        )}
      />
      {label}
      <span
        className={cn(
          'tabular-nums',
          active ? 'text-white/70' : 'text-stone-400',
        )}
      >
        {count}
      </span>
    </button>
  )
}

function DensityToggle({
  density,
  setDensity,
}: {
  density: Density
  setDensity: (d: Density) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Плотность списка"
      className="inline-flex items-center rounded-md border border-stone-200 bg-white p-0.5"
    >
      <DensityOption
        active={density === 'cards'}
        onClick={() => setDensity('cards')}
        icon={LayoutGrid}
        label="Карточки"
        title="Полные карточки с действиями — медленное чтение"
      />
      <DensityOption
        active={density === 'compact'}
        onClick={() => setDensity('compact')}
        icon={AlignLeft}
        label="Компакт"
        title="Однострочные строки — обзор многих регламентов"
      />
    </div>
  )
}

function DensityOption({
  active,
  onClick,
  icon: Icon,
  label,
  title,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
  title: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition',
        active
          ? 'bg-stone-900 text-white'
          : 'text-stone-600 hover:bg-stone-100',
      )}
    >
      <Icon size={12} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function DomainSection({
  domain,
  fallbackKey,
  items,
  density,
  starred,
  onToggleStar,
}: {
  domain: Domain | null
  fallbackKey: string | null
  items: RegRow[]
  density: Density
  starred: Set<string>
  onToggleStar: (id: string) => void
}) {
  const qc = useQueryClient()
  const v = domain?.id ? getDomainVisual(domain.id) : FALLBACK_VISUAL
  const Icon = v.icon
  const label = domain?.label ?? (fallbackKey ?? 'Без домена')
  // User-created (custom) домен — id не в seed-списке и не null.
  const canDelete = !!domain && !SEED_DOMAIN_IDS.has(domain.id)

  const del = useMutation({
    mutationFn: () => api.domains.delete(domain!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  })

  const onDelete = () => {
    if (!canDelete) return
    const used = items.length
    const msg = used
      ? `В домене «${label}» ${used} регламентов. После удаления они останутся, но окажутся в группе «Без домена». Продолжить?`
      : `Удалить пустой домен «${label}»?`
    if (window.confirm(msg)) del.mutate()
  }

  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center gap-3">
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', v.iconBg)}>
          <Icon size={18} className={v.iconFg} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {domain?.id ? (
              <Link
                to={`/domains/${encodeURIComponent(domain.id)}`}
                className="text-sm font-semibold uppercase tracking-wide text-stone-800 hover:text-primary hover:underline"
                title="Открыть сводку по домену — регламенты, модули, датчики"
              >
                {label}
              </Link>
            ) : (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-800">{label}</h2>
            )}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', v.chipBg, v.chipFg)}>
              {items.length}
            </span>
            {canDelete && (
              <button
                onClick={onDelete}
                disabled={del.isPending}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                title="Удалить пользовательский домен"
                aria-label={`Удалить домен ${label}`}
              >
                <Trash2 size={12} />
              </button>
            )}
            {/* domain-цвет сохраняем — это семантика (heating=orange, housing=blue
                и т.д.). См. DESIGN_SYSTEM.md → §1 «domain-цвета не унифицируем». */}
          </div>
          {domain?.hint && (
            <div className="mt-0.5 text-xs text-stone-500">{domain.hint}</div>
          )}
        </div>
        {domain?.id && (
          <Link
            to={`/domains/${encodeURIComponent(domain.id)}`}
            className="shrink-0 text-xs text-blue-700 hover:underline"
          >
            обзор домена →
          </Link>
        )}
      </header>

      {density === 'compact' ? (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          {items.map((r, i) => (
            <CompactRow
              key={r.id}
              reg={r}
              visual={v}
              starred={starred.has(r.id)}
              onToggleStar={() => onToggleStar(r.id)}
              isFirst={i === 0}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {items.map((r) => (
            <RegulationCard
              key={r.id}
              reg={r}
              visual={v}
              starred={starred.has(r.id)}
              onToggleStar={() => onToggleStar(r.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function RegulationCard({
  reg,
  visual,
  starred,
  onToggleStar,
}: {
  reg: RegRow
  visual: DomainVisual
  starred: boolean
  onToggleStar: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <article
      className={cn(
        'group relative flex items-stretch overflow-hidden rounded-lg border bg-white transition',
        visual.cardBorder,
        'hover:shadow-md hover:shadow-stone-200/40',
      )}
    >
      {/* Domain accent stripe */}
      <div className={cn('w-1 shrink-0', visual.accent)} />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
        {/* Звезда «избранное» — слева, рядом с названием. Удобно при
            быстром скане сверху-вниз: один клик пометил регламент в «Мои». */}
        <StarButton
          starred={starred}
          onToggle={onToggleStar}
          size="md"
          className="shrink-0 self-start mt-0.5"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <Link
              to={`/regulations/${reg.id}/edit`}
              className="line-clamp-2 font-medium leading-snug text-stone-900 transition hover:text-primary"
              title={reg.name}
            >
              {reg.name}
            </Link>
            {/* SIGMA: критичность + срок действия — самая видимая семантика
                регламента. Бэйджи стоят рядом с названием, чтобы аналитик
                сразу понимал «горящий это регламент или нет». */}
            {reg.priority && (
              <Badge tone={PRIORITY_META[reg.priority].tone}>
                {PRIORITY_META[reg.priority].label}
              </Badge>
            )}
            {(() => {
              const exp = expirationBadge(reg.valid_to)
              return exp ? <Badge tone={exp.tone}>{exp.label}</Badge> : null
            })()}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
              {reg.id}
            </code>
            {reg.parameters_count !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Sliders size={11} className="text-stone-400" />
                {reg.parameters_count} параметров
              </span>
            )}
            {reg.constraints_count !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Shield size={11} className="text-stone-400" />
                {reg.constraints_count} ограничений
              </span>
            )}
            {!!reg.recommendations_count && reg.recommendations_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <AlertCircle size={11} className="text-stone-400" />
                {reg.recommendations_count} рекомендации
              </span>
            )}
            {reg.source_document && (
              <span className="inline-flex items-center gap-1 italic" title="Нормативный документ">
                <BookOpen size={11} className="text-stone-400" />
                {reg.source_document}
              </span>
            )}
            {(reg.has_source_file || reg.has_source_url) && (
              <span
                className="inline-flex items-center gap-1 text-emerald-700"
                title={
                  reg.has_source_file
                    ? 'Прикреплён локальный документ-основание (PDF/DOCX) — нажми «Редактор», чтобы открыть'
                    : 'Указана внешняя ссылка на документ-основание'
                }
              >
                <Paperclip size={11} className="text-emerald-500" />
                источник {reg.has_source_file ? 'прикреплён' : '— ссылка'}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Primary action — всегда видна: 90% использования это «Редактор». */}
          <ActionButton
            to={`/regulations/${reg.id}/edit`}
            icon={Pencil}
            label="Редактор"
            colorClasses="border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100"
            iconColor="text-violet-500"
          />
          {/* Secondary actions: появляются на ховере карточки. Снижает шум
              на 60% при сканировании списка, сохраняя 1-клик доступ. */}
          <div className="hidden items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 lg:flex">
            <ActionButton
              to={`/regulations/${reg.id}/flow`}
              icon={Workflow}
              label="Поток"
              colorClasses="border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
              iconColor="text-blue-500"
            />
            <ActionButton
              to={`/regulations/${reg.id}/constraints`}
              icon={Shield}
              label="Ограничения"
              colorClasses="border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100"
              iconColor="text-amber-500"
            />
            <ActionButton
              to={reg.domain ? `/graph?domain=${reg.domain}` : '/graph'}
              icon={Network}
              label="Граф"
              colorClasses="border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
              iconColor="text-emerald-500"
            />
          </div>
          {/* Утилитарные действия (копировать/удалить) — тоже hover-only,
              отбиты отступом. Дублирование в правый блок чтобы держать рядом
              с «Удалить» — оба меняют состав корпуса. */}
          <div className="ml-1 hidden items-center gap-1.5 border-l border-stone-200 pl-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 lg:flex">
            <DuplicateButton regulationId={reg.id} regulationName={reg.name} />
            <button
              onClick={() => setConfirming(true)}
              title="Удалить регламент"
              aria-label={`Удалить ${reg.name}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmDeleteDialog
          regulationId={reg.id}
          regulationName={reg.name}
          onClose={() => setConfirming(false)}
        />
      )}
    </article>
  )
}

// ── CompactRow ─────────────────────────────────────────────────────────
//
// Однострочный вариант для density='compact'. Идея: сжать карточку до
// одной строки с минимумом метаданных, hover-actions справа. Даёт ~3x
// больше регламентов на экран по сравнению с RegulationCard.
function CompactRow({
  reg,
  visual,
  starred,
  onToggleStar,
  isFirst,
}: {
  reg: RegRow
  visual: DomainVisual
  starred: boolean
  onToggleStar: () => void
  isFirst: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <div
        className={cn(
          'group/row relative flex items-center gap-3 px-3 py-1.5 transition hover:bg-stone-50/80',
          !isFirst && 'border-t border-stone-100',
        )}
      >
        {/* Domain-accent тонкая полоска слева от строки */}
        <div className={cn('absolute left-0 top-0 h-full w-1', visual.accent)} />

        {/* Звезда слева — для быстрого pin'а при сканировании */}
        <StarButton
          starred={starred}
          onToggle={onToggleStar}
          size="sm"
          className="ml-1 shrink-0"
        />

        {/* Имя + ID — основной clickable target */}
        <Link
          to={`/regulations/${reg.id}/edit`}
          className="min-w-0 flex-1 truncate text-sm text-stone-900 hover:text-primary"
          title={reg.name}
        >
          {reg.name}
        </Link>

        {/* Минимум метаданных, в одну строку. Скрываются на узких экранах. */}
        <div className="hidden shrink-0 items-center gap-2 text-[11px] text-stone-500 md:flex">
          {reg.priority && (
            <Badge tone={PRIORITY_META[reg.priority].tone}>
              {PRIORITY_META[reg.priority].label}
            </Badge>
          )}
          {(() => {
            const exp = expirationBadge(reg.valid_to)
            return exp ? <Badge tone={exp.tone}>{exp.label}</Badge> : null
          })()}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">
            {reg.id}
          </code>
          {reg.parameters_count !== undefined && (
            <span className="tabular-nums">{reg.parameters_count} пар.</span>
          )}
          {reg.constraints_count !== undefined && (
            <span className="tabular-nums">{reg.constraints_count} огр.</span>
          )}
          {!!reg.recommendations_count && reg.recommendations_count > 0 && (
            <span className="tabular-nums">{reg.recommendations_count} рек.</span>
          )}
          {(reg.has_source_file || reg.has_source_url) && (
            <span title="Прикреплён документ-основание">
              <Paperclip size={10} className="text-emerald-500" />
            </span>
          )}
        </div>

        {/* Hover actions справа: иконки 7×7 без подписи (компакт). */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
          <IconLink to={`/regulations/${reg.id}/flow`} icon={Workflow} title="Поток" tone="blue" />
          <IconLink to={`/regulations/${reg.id}/constraints`} icon={Shield} title="Ограничения" tone="amber" />
          <IconLink to={reg.domain ? `/graph?domain=${reg.domain}` : '/graph'} icon={Network} title="Граф" tone="emerald" />
          <DuplicateButton regulationId={reg.id} regulationName={reg.name} variant="icon" />
          <button
            onClick={() => setConfirming(true)}
            title="Удалить регламент"
            aria-label={`Удалить ${reg.name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {confirming && (
        <ConfirmDeleteDialog
          regulationId={reg.id}
          regulationName={reg.name}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

function IconLink({
  to,
  icon: Icon,
  title,
  tone,
}: {
  to: string
  icon: LucideIcon
  title: string
  tone: 'blue' | 'amber' | 'emerald'
}) {
  const toneCls = {
    blue: 'text-blue-600 hover:bg-blue-50',
    amber: 'text-amber-600 hover:bg-amber-50',
    emerald: 'text-emerald-600 hover:bg-emerald-50',
  }[tone]
  return (
    <Link
      to={to}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded transition',
        toneCls,
      )}
    >
      <Icon size={13} />
    </Link>
  )
}

function StarButton({
  starred,
  onToggle,
  size,
  className,
}: {
  starred: boolean
  onToggle: () => void
  size: 'sm' | 'md'
  className?: string
}) {
  const px = size === 'sm' ? 13 : 16
  const btnPx = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <button
      type="button"
      onClick={onToggle}
      title={starred ? 'Убрать из «Мои»' : 'Добавить в «Мои» (избранное)'}
      aria-label={starred ? 'Убрать из избранного' : 'Добавить в избранное'}
      aria-pressed={starred}
      className={cn(
        'inline-flex items-center justify-center rounded transition',
        btnPx,
        starred
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-stone-300 hover:bg-stone-100 hover:text-amber-400',
        className,
      )}
    >
      <Star size={px} className={starred ? 'fill-amber-400' : ''} />
    </button>
  )
}

function DuplicateButton({
  regulationId,
  regulationName,
  variant = 'inline',
}: {
  regulationId: string
  regulationName: string
  variant?: 'inline' | 'icon'
}) {
  const navigate = useNavigateLocal()
  const qc = useQueryClient()
  const dup = useMutation({
    mutationFn: () => api.regulations.duplicate(regulationId),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      // Сразу открываем редактор копии — пользователь хочет править новую.
      navigate(`/regulations/${encodeURIComponent(created.id)}/edit`)
    },
  })
  const label = `Создать копию регламента «${regulationName}»`
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={() => dup.mutate()}
        disabled={dup.isPending}
        title="Создать копию"
        aria-label={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
      >
        {dup.isPending ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => dup.mutate()}
      disabled={dup.isPending}
      title="Создать копию регламента — те же параметры/поток/SHACL, новый ID"
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800 disabled:opacity-40"
    >
      {dup.isPending ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
    </button>
  )
}

// Локальный wrapper над useNavigate чтобы не плодить импорты — react-router
// useNavigate проще импортировать на месте.
function useNavigateLocal() {
  const navigate = useNavigate()
  return navigate
}

function ConfirmDeleteDialog({
  regulationId,
  regulationName,
  onClose,
}: {
  regulationId: string
  regulationName: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => api.regulations.delete(regulationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      onClose()
    },
  })
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]"
      onClick={() => !del.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <AlertTriangle size={16} className="text-rose-500" />
            Удалить регламент?
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={del.isPending}
            aria-label="Закрыть"
            className="h-7 w-7 p-0"
          >
            <X size={14} />
          </Button>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm text-stone-700">
          <p>
            Будет удалён регламент <b>«{regulationName}»</b> <code className="rounded bg-stone-100 px-1 text-xs">{regulationId}</code>.
          </p>
          <p className="text-xs text-stone-500">
            Удаляется запись из локального DuckDB, вся история версий, стартовый flow и snapshot'ы версий flow.
            Действие <b>необратимо</b> — отката через UI нет.
          </p>
          <p className="text-xs text-stone-500">
            Если регламент был засеян из фикстуры, он восстановится после следующего рестарта backend'а
            (seed повторно создаст его из <code className="rounded bg-stone-100 px-1 text-[11px]">backend/data/fixtures/</code>).
          </p>
          {del.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не удалось удалить: {(del.error as Error).message}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={del.isPending}>
            Нет, оставить
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            loading={del.isPending}
            onClick={() => del.mutate()}
          >
            {del.isPending ? 'Удаляю…' : 'Да, удалить'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  to,
  icon: Icon,
  label,
  colorClasses,
  iconColor,
}: {
  to: string
  icon: LucideIcon
  label: string
  colorClasses: string
  iconColor: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
        colorClasses,
      )}
    >
      <Icon size={13} className={iconColor} />
      {label}
    </Link>
  )
}

/**
 * Inline-метрика в шапке списка: иконка + число + подпись. Нейтральный стиль
 * чтобы 4 метрики в ряд не превращались в светофор. Если в будущем понадобится
 * акцентная метрика (KPI с цветом по статусу) — отдельный вариант, не общий.
 */
function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-1 text-xs">
      <Icon size={12} className="text-stone-500" />
      <span className="font-semibold tabular-nums text-stone-800">{value}</span>
      <span className="text-stone-500">{label}</span>
    </div>
  )
}
