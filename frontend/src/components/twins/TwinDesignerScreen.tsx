import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { api, type Process, type ProcessWiringEntry } from '@/lib/api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DOMAIN_VISUALS, getDomainVisual } from '@/lib/domains'
import { TwinFlowTabsView } from './TwinFlowTabsView'

/**
 * «Цифровой двойник управления» — страница /twins.
 *
 * Не путать с:
 *   - /graph — карта связей ВСЕГО корпуса регламентов;
 *   - /regulations/:id/flow — поток одного регламента (логика реакции).
 *
 * Здесь аналитик собирает 2-N регламентов в именованный процесс, видит
 * композиционную цепочку (через :sourceRegulation триггеры), экспортирует
 * артефакт (Turtle / SIGMA-bundle ZIP) для передачи в исполнительный движок.
 *
 * Layout:
 *   ┌─────────────┬────────────────────────────────────────────────────┐
 *   │ Список      │ Header: имя + описание                              │
 *   │ двойников   │ ─────────────────────────────────────────────────── │
 *   │ + Создать   │ Регламенты в составе (можно добавлять / убирать)    │
 *   │             │ ─────────────────────────────────────────────────── │
 *   │             │ Экспорт: Turtle / SIGMA-bundle ZIP                  │
 *   └─────────────┴────────────────────────────────────────────────────┘
 */

export function TwinDesignerScreen() {
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: twins = [], isLoading: twinsLoading } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.processes.list(),
  })
  const { data: datasetsRaw } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.datasets.list(),
  })
  const allRegulations = useMemo(() => {
    if (!datasetsRaw) return []
    const items = Array.isArray(datasetsRaw)
      ? datasetsRaw
      : ('items' in datasetsRaw && Array.isArray(datasetsRaw.items) ? datasetsRaw.items : [])
    return items.map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      domain: r.domain ?? null,
    }))
  }, [datasetsRaw])

  // Выбранный двойник = из URL или первый в списке (после первой загрузки).
  const selected = useMemo(() => {
    if (routeId) return twins.find((t) => t.id === routeId) ?? null
    return twins[0] ?? null
  }, [twins, routeId])

  const [draft, setDraft] = useState<Process | null>(null)
  // Когда selected меняется — обновляем draft. Защита от потери незакоммиченных
  // правок: если у текущего draft есть несохранённые изменения по сравнению с
  // selected, мы их теряем — но переключение twin'а пользовательское, явное,
  // достаточно показать confirm. Пока MVP — просто заменяем.
  useMemo(() => {
    setDraft(selected ? structuredClone(selected) : null)
  }, [selected])

  const dirty = useMemo(() => {
    if (!selected || !draft) return false
    return JSON.stringify(selected) !== JSON.stringify(draft)
  }, [selected, draft])

  const createTwin = useMutation({
    mutationFn: () =>
      api.processes.create({
        name: 'Новый двойник',
        description: null,
        regulation_ids: [],
        wiring: [],
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['processes'] })
      navigate(`/twins/${created.id}`)
    },
  })
  const saveTwin = useMutation({
    mutationFn: (next: Process) => api.processes.update(next.id, next),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['processes'] })
      qc.setQueryData(['processes', saved.id], saved)
    },
  })
  const deleteTwin = useMutation({
    mutationFn: (twinId: string) => api.processes.delete(twinId),
    onSuccess: (_, twinId) => {
      qc.invalidateQueries({ queryKey: ['processes'] })
      if (selected?.id === twinId) navigate('/twins')
    },
  })

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <GitBranch size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-stone-900">
            Цифровой двойник процесса управления
          </h1>
          <p className="text-xs text-stone-500">
            Соберите цепочку из 2+ регламентов с датчиками и экспортируйте
            артефакт (Turtle / SIGMA-bundle) для исполнительного движка.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => createTwin.mutate()}
          loading={createTwin.isPending}
        >
          Новый двойник
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Левая колонка — список */}
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-white">
          <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Сохранённые двойники
          </div>
          {twinsLoading && <div className="p-3 text-xs text-stone-500">Загрузка…</div>}
          {!twinsLoading && twins.length === 0 && (
            <div className="m-3 rounded-md border border-dashed border-stone-300 p-3 text-xs text-stone-500">
              Двойников пока нет. Нажмите «Новый двойник» вверху справа.
            </div>
          )}
          <div className="flex flex-col gap-0.5 p-2">
            {twins.map((t) => {
              const active = t.id === selected?.id
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/twins/${t.id}`)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition',
                    active
                      ? 'bg-violet-50 text-violet-900 ring-1 ring-violet-200'
                      : 'text-stone-700 hover:bg-stone-50',
                  )}
                  title={t.name}
                >
                  <span className="line-clamp-2 break-words font-medium leading-snug">
                    {t.name}
                  </span>
                  <span className="text-[10px] text-stone-500">
                    {t.regulation_ids.length}{' '}
                    {pluralRus(t.regulation_ids.length, ['регламент', 'регламента', 'регламентов'])}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Правая колонка — редактор */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!selected || !draft ? (
            <div className="grid flex-1 place-items-center text-center text-sm text-stone-500">
              <div>
                <GitBranch size={32} className="mx-auto mb-2 text-stone-300" />
                <p>Выберите двойник в списке слева или создайте новый.</p>
                <p className="mt-2 text-xs">
                  Цифровой двойник = именованная коллекция регламентов с цепочкой
                  событий между ними. Артефакт можно выгрузить как Turtle или
                  SIGMA-bundle ZIP.
                </p>
              </div>
            </div>
          ) : (
            <TwinEditor
              draft={draft}
              setDraft={setDraft}
              dirty={dirty}
              allRegulations={allRegulations}
              onSave={() => draft && saveTwin.mutate(draft)}
              onSaving={saveTwin.isPending}
              onDelete={() => {
                if (confirm(`Удалить двойник «${draft.name}»? Регламенты в составе не пострадают.`)) {
                  deleteTwin.mutate(draft.id)
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  )
}


// ── Редактор одного двойника ──────────────────────────────────────────


function TwinEditor({
  draft,
  setDraft,
  dirty,
  allRegulations,
  onSave,
  onSaving,
  onDelete,
}: {
  draft: Process
  setDraft: (p: Process) => void
  dirty: boolean
  allRegulations: Array<{ id: string; name: string; domain: string | null }>
  onSave: () => void
  onSaving: boolean
  onDelete: () => void
}) {
  const includedIds = new Set(draft.regulation_ids)
  const included = useMemo(
    () => draft.regulation_ids.map((rid) => allRegulations.find((r) => r.id === rid))
                              .filter((r): r is { id: string; name: string; domain: string | null } => !!r),
    [draft.regulation_ids, allRegulations],
  )
  const available = allRegulations.filter((r) => !includedIds.has(r.id))

  // Группируем доступные регламенты по домену — удобнее искать.
  const availableByDomain = useMemo(() => {
    const grouped = new Map<string, typeof available>()
    for (const r of available) {
      const key = r.domain ?? 'без домена'
      const list = grouped.get(key) ?? []
      list.push(r)
      grouped.set(key, list)
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [available])

  const addReg = (rid: string) => {
    if (includedIds.has(rid)) return
    setDraft({ ...draft, regulation_ids: [...draft.regulation_ids, rid] })
  }
  const removeReg = (rid: string) => {
    setDraft({ ...draft, regulation_ids: draft.regulation_ids.filter((x) => x !== rid) })
  }
  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...draft.regulation_ids]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setDraft({ ...draft, regulation_ids: next })
  }
  const moveDown = (idx: number) => {
    if (idx === draft.regulation_ids.length - 1) return
    const next = [...draft.regulation_ids]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setDraft({ ...draft, regulation_ids: next })
  }

  return (
    <div className="space-y-4 p-5">
      {/* Шапка двойника */}
      <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-800">Параметры двойника</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} className="text-rose-600" />}
              onClick={onDelete}
            >
              Удалить
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Check size={13} />}
              onClick={onSave}
              loading={onSaving}
              disabled={!dirty || onSaving}
            >
              {onSaving ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_2fr]">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Имя</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-sm text-stone-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="Например: Реагирование на прорыв тепловвода"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Описание</span>
            <input
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-sm text-stone-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="Что покрывает этот процесс"
            />
          </label>
        </div>
      </div>

      {/* Регламенты в составе */}
      <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-800">
            Регламенты в составе ({included.length})
          </h2>
        </div>
        {included.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">
            Двойник пока пустой. Добавьте регламенты из списка ниже.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {included.map((r, idx) => {
              const visual = getDomainVisual(r.domain)
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50/40 px-2.5 py-1.5"
                >
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px]',
                      visual.iconBg,
                      visual.iconFg,
                    )}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-stone-800">{r.name}</div>
                    <div className="font-mono text-[10px] text-stone-500">{r.id}</div>
                  </div>
                  <div className="flex items-center gap-0.5 text-stone-400">
                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="rounded p-1 disabled:opacity-30 hover:bg-stone-100 hover:text-stone-700"
                      title="Поднять"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx === included.length - 1}
                      className="rounded p-1 disabled:opacity-30 hover:bg-stone-100 hover:text-stone-700"
                      title="Опустить"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeReg(r.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50"
                      title="Убрать из двойника"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Связи внутри двойника — wiring B.output → A.input */}
      <WiringSection
        draft={draft}
        setDraft={setDraft}
        included={included}
      />

      {/* Полотно «как поток»: вкладки по регламентам + click-through по wiring.
          UX: каждый регламент на своей вкладке (тот же reactflow что в Flow
          Editor), на output/event-пилюлях overlay-кнопки ↘ / ↖ для прыжка
          к связанному регламенту с подсветкой узла. */}
      <TwinFlowTabsView
        twin={draft}
        members={included.map((r) => ({ id: r.id, name: r.name }))}
      />

      {/* Доступные для добавления */}
      <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-stone-800">
          Доступные регламенты ({available.length})
        </h2>
        {available.length === 0 ? (
          <div className="text-xs text-stone-500">Все регламенты уже включены.</div>
        ) : (
          <div className="space-y-3">
            {availableByDomain.map(([domain, items]) => {
              const visual = DOMAIN_VISUALS[domain]
              return (
                <div key={domain}>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    <span
                      className={cn(
                        'inline-flex h-3 w-3 items-center justify-center rounded',
                        visual?.iconBg ?? 'bg-stone-200',
                      )}
                    />
                    {domain}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-stone-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-stone-800">{r.name}</div>
                          <div className="font-mono text-[10px] text-stone-500">{r.id}</div>
                        </div>
                        <button
                          onClick={() => addReg(r.id)}
                          className="ml-2 rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 hover:bg-violet-100"
                          title="Добавить в двойник"
                        >
                          + Добавить
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Экспорт */}
      <div className="rounded-md border border-violet-200 bg-violet-50/40 p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-violet-900">Экспорт артефакта</h2>
        <p className="mb-2 text-[11px] text-violet-800/80">
          Готовый двойник можно выгрузить для передачи в исполнительный движок или
          для аудита нормативного основания. Артефакты не зависят от RAGRAF и
          читаются стандартными OWL/SHACL-инструментами (Apache Jena, Protégé).
        </p>
        <div className="mb-3 rounded border border-violet-200 bg-white/60 p-2 text-[10px] leading-relaxed text-violet-900">
          <div className="mb-0.5 font-semibold uppercase tracking-wide text-violet-700">Что внутри</div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li><b>.ttl</b> — RDF-данные двойника (`:DigitalTwin` + `:hasMember` + `:Wiring`) и каждого регламента.</li>
            <li><b>.zip</b> — то же самое плюс <code>flow.json</code> (Rule DSL),
              <code>regulation.json</code> (Pydantic-дамп), <code>shapes.ttl</code> (SHACL),
              <code>manifest.json</code> на каждый регламент. Полный артефакт для SIGMA.</li>
          </ul>
          <div className="mt-1 font-semibold uppercase tracking-wide text-violet-700">Где проверить .ttl онлайн</div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li><a href="https://www.ldf.fi/service/rdf-grapher" target="_blank" rel="noreferrer" className="underline hover:text-violet-700">RDF Grapher</a> — paste &amp; visualize (быстрая визуализация графа).</li>
            <li><a href="https://rdfshape.weso.es/" target="_blank" rel="noreferrer" className="underline hover:text-violet-700">RDFShape</a> — валидатор + SPARQL-консоль.</li>
            <li><a href="https://webprotege.stanford.edu/" target="_blank" rel="noreferrer" className="underline hover:text-violet-700">WebProtégé</a> — полноценный OWL-редактор (нужна регистрация).</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={api.processes.bundleUrl(draft.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm font-medium text-violet-900 hover:bg-violet-50',
              (dirty || draft.regulation_ids.length === 0) && 'pointer-events-none opacity-50',
            )}
            title={
              dirty
                ? 'Сначала сохраните двойник'
                : draft.regulation_ids.length === 0
                  ? 'Двойник пуст — добавьте хотя бы один регламент'
                  : 'Скачать SIGMA-bundle ZIP'
            }
            download
          >
            <Download size={13} />
            <FileCode2 size={13} />
            SIGMA-bundle (.zip)
          </a>
          <a
            href={api.processes.turtleUrl(draft.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm font-medium text-violet-900 hover:bg-violet-50',
              (dirty || draft.regulation_ids.length === 0) && 'pointer-events-none opacity-50',
            )}
            title={
              dirty
                ? 'Сначала сохраните двойник'
                : draft.regulation_ids.length === 0
                  ? 'Двойник пуст — добавьте хотя бы один регламент'
                  : 'Скачать объединённый Turtle'
            }
            target="_blank"
            rel="noreferrer"
          >
            <Download size={13} />
            <FileText size={13} />
            Объединённый Turtle (.ttl)
          </a>
          <TurtleVerifyButton
            twinId={draft.id}
            disabled={dirty || draft.regulation_ids.length === 0}
            disabledHint={
              dirty
                ? 'Сначала сохраните двойник'
                : 'Добавьте хотя бы один регламент'
            }
          />
          {dirty && (
            <span className="text-[11px] text-violet-700/70">
              Сохраните двойник, чтобы экспорт стал активен.
            </span>
          )}
        </div>
      </div>

      {/* Подсказка про композицию */}
      <div className="rounded-md border border-stone-200 bg-stone-50/60 p-3 text-[11px] text-stone-600">
        <div className="mb-1 flex items-center gap-1 font-medium text-stone-700">
          <Zap size={11} />
          Композиция между регламентами
        </div>
        Если регламент в составе ссылается через триггер на output другого
        регламента (`:sourceRegulation`/`:sourceOutput`) — связь автоматически
        видна на странице «Граф связей» и переезжает в экспортируемый Turtle.
        Здесь, в составе двойника, эти связи дают сквозную картину
        реагирования на цепочку событий.
      </div>
    </div>
  )
}


function pluralRus(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}


// ── Секция «Связи» — wiring внутри Twin'а ─────────────────────────────
//
// Принцип «Двух уровней» (2026-05-19): композиция регламентов живёт ТУТ,
// в двойнике, а не на самих регламентах. Каждая запись wiring говорит
// «выход регламента B (action Y) кормит вход регламента A (параметр X)».
// На save Twin'а backend проецирует эти записи в flow.json членов
// (см. process_store.project_wiring_to_flows).
//
// UX: dropdown для target_regulation → target_param_ref → source_regulation
// → source_output. Все источники и цели — только члены этого Twin'а
// (иначе wiring «утекает» наружу и теряет смысл).

function WiringSection({
  draft,
  setDraft,
  included,
}: {
  draft: Process
  setDraft: (p: Process) => void
  included: Array<{ id: string; name: string; domain: string | null }>
}) {
  // Параметры каждого регламента-члена — нужно для dropdown target_param_ref.
  const regulationQueries = useQueries({
    queries: included.map((r) => ({
      queryKey: ['regulation', r.id],
      queryFn: () => api.regulations.get(r.id),
      staleTime: 30_000,
    })),
  })
  // Output-actions каждого регламента — нужно для source_output dropdown.
  const outputQueries = useQueries({
    queries: included.map((r) => ({
      queryKey: ['output-actions', r.id],
      queryFn: () => api.regulations.outputActions(r.id),
      staleTime: 30_000,
    })),
  })

  // Индексируем по id для быстрого lookup'а в рендере и validation'е.
  const paramsByReg = useMemo(() => {
    const out = new Map<string, Array<{ id: string; name: string }>>()
    included.forEach((r, i) => {
      const reg = regulationQueries[i]?.data
      out.set(r.id, (reg?.parameters ?? []).map((p) => ({ id: p.id, name: p.name })))
    })
    return out
  }, [included, regulationQueries])
  const outputsByReg = useMemo(() => {
    const out = new Map<string, Array<{ action: string; label: string }>>()
    included.forEach((r, i) => {
      const data = outputQueries[i]?.data
      out.set(r.id, (data?.actions ?? []).map((a) => ({ action: a.action, label: a.label })))
    })
    return out
  }, [included, outputQueries])

  const wiring = draft.wiring ?? []

  const addEntry = () => {
    // Стартовый шаблон — пользователь дозаполнит. Чтобы не «прятать» пустые
    // dropdown'ы за «+ Добавить», создаём строку с дефолтами и сразу рендерим
    // её с пустыми селектами; пользователь выбирает поэтапно.
    setDraft({
      ...draft,
      wiring: [
        ...wiring,
        { target_regulation: '', target_param_ref: '', source_regulation: '', source_output: null },
      ],
    })
  }
  const updateEntry = (idx: number, patch: Partial<ProcessWiringEntry>) => {
    const next = [...wiring]
    next[idx] = { ...next[idx], ...patch }
    setDraft({ ...draft, wiring: next })
  }
  const removeEntry = (idx: number) => {
    const next = wiring.filter((_, i) => i !== idx)
    setDraft({ ...draft, wiring: next })
  }

  if (included.length < 2) {
    return (
      <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-stone-800 flex items-center gap-1.5">
          <Link2 size={14} className="text-violet-600" />
          Связи между регламентами
        </h2>
        <div className="text-[11px] text-stone-500">
          Добавьте минимум два регламента в состав, чтобы связать их выходы и входы.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
          <Link2 size={14} className="text-violet-600" />
          Связи между регламентами ({wiring.length})
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={13} />}
          onClick={addEntry}
        >
          Добавить связь
        </Button>
      </div>

      {wiring.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">
          Связей пока нет. Кнопка «+ Добавить связь» сверху создаёт wiring:
          выход одного регламента → вход другого.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {wiring.map((w, idx) => {
            const targetParams = paramsByReg.get(w.target_regulation) ?? []
            const sourceOutputs = outputsByReg.get(w.source_regulation) ?? []
            return (
              <li
                key={idx}
                className="rounded-md border border-violet-200 bg-violet-50/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                    Связь #{idx + 1}
                  </span>
                  <button
                    onClick={() => removeEntry(idx)}
                    className="rounded p-1 text-rose-500 hover:bg-rose-50"
                    title="Удалить связь"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {/* Source — слева */}
                  <div className="space-y-1.5 rounded border border-violet-200 bg-white/50 p-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-violet-700">
                      <Send size={9} className="-mt-0.5 mr-1 inline" />
                      Источник
                    </div>
                    <WiringSelect
                      label="Регламент"
                      value={w.source_regulation}
                      onChange={(v) => updateEntry(idx, {
                        source_regulation: v,
                        // При смене источника старый action заведомо может
                        // не существовать. Чистим.
                        source_output: null,
                      })}
                      options={[
                        { value: '', label: '— выберите —' },
                        ...included.map((r) => ({ value: r.id, label: r.name })),
                      ]}
                    />
                    <WiringSelect
                      label="Output (action)"
                      value={w.source_output ?? ''}
                      onChange={(v) => updateEntry(idx, { source_output: v || null })}
                      disabled={!w.source_regulation}
                      options={[
                        { value: '', label: '— любой —' },
                        ...sourceOutputs.map((o) => ({
                          value: o.action,
                          label: o.label && o.label !== o.action
                            ? `${o.action} · ${o.label}` : o.action,
                        })),
                      ]}
                    />
                  </div>
                  {/* Target — справа */}
                  <div className="space-y-1.5 rounded border border-violet-200 bg-white/50 p-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-violet-700">
                      → Цель
                    </div>
                    <WiringSelect
                      label="Регламент"
                      value={w.target_regulation}
                      onChange={(v) => updateEntry(idx, {
                        target_regulation: v,
                        target_param_ref: '',
                      })}
                      options={[
                        { value: '', label: '— выберите —' },
                        ...included
                          .filter((r) => r.id !== w.source_regulation)
                          .map((r) => ({ value: r.id, label: r.name })),
                      ]}
                    />
                    <WiringSelect
                      label="Параметр (вход)"
                      value={w.target_param_ref}
                      onChange={(v) => updateEntry(idx, { target_param_ref: v })}
                      disabled={!w.target_regulation}
                      options={[
                        { value: '', label: '— выберите —' },
                        ...targetParams.map((p) => ({
                          value: p.id,
                          label: p.name && p.name !== p.id ? `${p.id} · ${p.name}` : p.id,
                        })),
                      ]}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3 rounded-md border border-violet-100 bg-violet-50/40 p-2 text-[10px] leading-relaxed text-violet-900">
        <b>Как это работает:</b> при сохранении двойника backend прописывает
        связи во flow.json целевых регламентов (sensor с режимом «Регламент»
        получает конкретный источник). Удаление связи здесь — wiring снимается.
        Один параметр одного регламента может быть в связи только одного двойника.
      </div>
    </div>
  )
}

function WiringSelect({
  label, value, onChange, options, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <label className="block">
      <div className="text-[10px] text-violet-700">{label}</div>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-violet-200 bg-white px-1.5 py-1 text-xs text-stone-800 disabled:bg-stone-50 disabled:text-stone-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}


// ── Кнопка «Проверить Turtle» — встроенный rdflib-валидатор ────────────
//
// UX: один клик → запрос на /verify-turtle → inline результат рядом
// с кнопкой (зелёный «valid + статистика» или красный «строка X: ошибка»).
// Не нужно идти на RDF Grapher / RDFShape ради проверки синтаксиса.

function TurtleVerifyButton({
  twinId,
  disabled,
  disabledHint,
}: {
  twinId: string
  disabled: boolean
  disabledHint: string
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; triples: number; stats: { digital_twins?: number; wirings?: number; regulations?: number } }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const verify = async () => {
    setState({ kind: 'loading' })
    try {
      const r = await api.processes.verifyTurtle(twinId)
      if (r.ok) {
        setState({ kind: 'ok', triples: r.triples, stats: r.stats })
      } else {
        setState({ kind: 'error', message: r.error || 'Ошибка парсинга' })
      }
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={verify}
        disabled={disabled || state.kind === 'loading'}
        title={disabled ? disabledHint : 'Прогнать Turtle через rdflib и показать результат'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm font-medium text-violet-900 hover:bg-violet-50',
          (disabled || state.kind === 'loading') && 'pointer-events-none opacity-50',
        )}
      >
        {state.kind === 'loading'
          ? <Loader2 size={13} className="animate-spin" />
          : <ShieldCheck size={13} />}
        Проверить Turtle
      </button>
      {state.kind === 'ok' && (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
          <CheckCircle2 size={12} className="text-emerald-600" />
          <span className="font-medium">Валидно</span>
          <span className="font-mono opacity-70">
            · {state.triples} трипл{plural(state.triples, 'а', 'а', 'ов')}
            {state.stats.digital_twins ? ` · twin: ${state.stats.digital_twins}` : ''}
            {state.stats.wirings ? ` · wiring: ${state.stats.wirings}` : ''}
            {state.stats.regulations ? ` · reg: ${state.stats.regulations}` : ''}
          </span>
        </span>
      )}
      {state.kind === 'error' && (
        <span
          className="inline-flex max-w-md items-start gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-900"
          title={state.message}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rose-600" />
          <span className="line-clamp-2 break-all">{state.message}</span>
        </span>
      )}
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
