import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import {
  DOMAIN_COLORS_REGISTRY,
  DOMAIN_GROUP_LABELS,
  DOMAIN_ICONS_REGISTRY,
  type DomainIconOption,
  buildUserDomainVisual,
} from '@/lib/domains'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface ModuleDraft {
  id: string
  name: string
  purpose: string
  owner: string | null
  domain: string | null
  status: 'draft' | 'piloting' | 'production' | 'deprecated'
  version: string
  icon: string | null
  color: string | null
  api_contract: {
    channel: 'rest' | 'webhook' | 'queue' | 'file_drop' | 'other'
    url: string | null
    auth_type: 'none' | 'api_key' | 'oauth2' | 'mtls' | 'basic'
    event_format: 'json' | 'xml' | 'csv' | 'binary' | 'other'
    rate_limit: string | null
    notes: string | null
  }
  quality_rules: {
    completeness: string | null
    max_latency_seconds: number | null
    max_error_rate_percent: number | null
    deduplication: boolean
  }
  event_types: string[]
  contact_email: string | null
  documentation_url: string | null
  notes: string | null
}

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Partial<ModuleDraft> & { id?: string }
  onClose: () => void
  onSaved?: (m: ModuleDraft) => void
}

const STATUS_OPTIONS: Array<{ id: ModuleDraft['status']; label: string; hint: string }> = [
  { id: 'draft', label: 'Черновик', hint: 'паспорт ещё дорабатывается, не для прод-данных' },
  { id: 'piloting', label: 'Пилот', hint: 'опытная эксплуатация, ограниченный контур' },
  { id: 'production', label: 'Промышленная эксплуатация', hint: 'внедрение, штатный источник событий' },
  { id: 'deprecated', label: 'Снят с поддержки', hint: 'события не принимаются, остался ради истории' },
]

const CHANNEL_OPTIONS: Array<{ id: ModuleDraft['api_contract']['channel']; label: string }> = [
  { id: 'rest', label: 'REST API' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'queue', label: 'Очередь сообщений' },
  { id: 'file_drop', label: 'Файловый обмен' },
  { id: 'other', label: 'Иной канал' },
]

const AUTH_OPTIONS: Array<{ id: ModuleDraft['api_contract']['auth_type']; label: string }> = [
  { id: 'none', label: 'без авторизации' },
  { id: 'api_key', label: 'API-key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
  { id: 'mtls', label: 'mTLS' },
  { id: 'basic', label: 'Basic Auth' },
]

const FORMAT_OPTIONS: Array<{ id: ModuleDraft['api_contract']['event_format']; label: string }> = [
  { id: 'json', label: 'JSON' },
  { id: 'xml', label: 'XML' },
  { id: 'csv', label: 'CSV' },
  { id: 'binary', label: 'Binary' },
  { id: 'other', label: 'другой' },
]

const GROUP_ORDER: Array<DomainIconOption['group']> = [
  'infra', 'tech', 'people', 'env', 'transport', 'trade', 'safety',
]

const EMPTY: ModuleDraft = {
  id: '',
  name: '',
  purpose: '',
  owner: null,
  domain: null,
  status: 'draft',
  version: '1.0',
  icon: null,
  color: null,
  api_contract: {
    channel: 'rest',
    url: null,
    auth_type: 'none',
    event_format: 'json',
    rate_limit: null,
    notes: null,
  },
  quality_rules: {
    completeness: null,
    max_latency_seconds: null,
    max_error_rate_percent: null,
    deduplication: true,
  },
  event_types: [],
  contact_email: null,
  documentation_url: null,
  notes: null,
}

function slugify(s: string): string {
  // ASCII-slug из кириллицы — простая транслитерация для генерации `id`.
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return s
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function ModuleEditorDialog({ open, mode, initial, onClose, onSaved }: Props) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<ModuleDraft>(EMPTY)
  const [idTouched, setIdTouched] = useState(false)
  const [eventTypesText, setEventTypesText] = useState('')

  // Используем список доменов из API, чтобы dropdown совпадал с теми же
  // значениями, что хранятся у регламентов/триггеров.
  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const start = { ...EMPTY, ...(initial ?? {}) } as ModuleDraft
    // Восстанавливаем вложенные объекты при partial initial.
    start.api_contract = { ...EMPTY.api_contract, ...(initial?.api_contract ?? {}) }
    start.quality_rules = { ...EMPTY.quality_rules, ...(initial?.quality_rules ?? {}) }
    start.event_types = initial?.event_types ?? []
    setDraft(start)
    setIdTouched(mode === 'edit')
    setEventTypesText((start.event_types ?? []).join('\n'))
  }, [open, mode, initial])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Авто-slug id из name, пока пользователь не правил id вручную.
  useEffect(() => {
    if (mode === 'edit' || idTouched) return
    setDraft((d) => ({ ...d, id: slugify(d.name) }))
  }, [draft.name, mode, idTouched])

  const previewVisual = useMemo(
    () => buildUserDomainVisual(draft.icon, draft.color),
    [draft.icon, draft.color],
  )
  const iconsByGroup = useMemo(() => {
    const map: Record<DomainIconOption['group'], DomainIconOption[]> = {
      infra: [], tech: [], people: [], env: [], transport: [], trade: [], safety: [],
    }
    for (const opt of DOMAIN_ICONS_REGISTRY) map[opt.group].push(opt)
    return map
  }, [])
  const PreviewIcon = previewVisual.icon

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...draft,
        // event_types парсим из текстарии по newline'ам — UX «один тип на строку».
        event_types: eventTypesText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        purpose: draft.purpose || '',
        // Backend ждёт object с keys, не null — pydantic .model_dump() выдаёт
        // оба варианта корректно, но для cleanly POST шлём заполненными.
      }
      if (mode === 'create') {
        return api.modules.create(payload as unknown as Record<string, unknown>)
      }
      return api.modules.update(draft.id, payload as unknown as Record<string, unknown>)
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['modules'] })
      onSaved?.(m as unknown as ModuleDraft)
      onClose()
    },
  })

  const del = useMutation({
    mutationFn: () => api.modules.delete(draft.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules'] })
      onClose()
    },
  })

  if (!open) return null

  const idValid = /^[a-z0-9][a-z0-9-]{1,60}$/.test(draft.id)
  const canSubmit =
    draft.name.trim().length > 0 && idValid && !save.isPending && !del.isPending

  const setApi = <K extends keyof ModuleDraft['api_contract']>(
    k: K,
    v: ModuleDraft['api_contract'][K],
  ) => setDraft((d) => ({ ...d, api_contract: { ...d.api_contract, [k]: v } }))

  const setQuality = <K extends keyof ModuleDraft['quality_rules']>(
    k: K,
    v: ModuleDraft['quality_rules'][K],
  ) => setDraft((d) => ({ ...d, quality_rules: { ...d.quality_rules, [k]: v } }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col rounded-lg border border-stone-200 bg-white shadow-xl"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Plug size={16} className="text-blue-600" />
            {mode === 'create' ? 'Новый прикладной модуль' : 'Редактирование модуля'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={save.isPending || del.isPending}
            aria-label="Закрыть"
            className="h-7 w-7 p-0"
          >
            <X size={14} />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {/* Превью карточки */}
          <div className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50/60 p-3">
            <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-md', previewVisual.iconBg)}>
              <PreviewIcon className={cn('h-6 w-6', previewVisual.iconFg)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-stone-900">
                {draft.name.trim() || 'Название модуля…'}
              </div>
              <div className="truncate font-mono text-[11px] text-stone-500">
                {draft.id || 'id будет сгенерирован…'} · v{draft.version || '1.0'}
              </div>
            </div>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', STATUS_BADGE_CLS[draft.status])}>
              {STATUS_OPTIONS.find((s) => s.id === draft.status)?.label}
            </span>
          </div>

          {/* Базовые поля */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <FieldLabel required>Название</FieldLabel>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="например: DAS-мониторинг волокна"
                maxLength={120}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel required>ID (slug)</FieldLabel>
              <input
                value={draft.id}
                onChange={(e) => {
                  setIdTouched(true)
                  setDraft({ ...draft, id: e.target.value })
                }}
                disabled={mode === 'edit'}
                placeholder="das-fiber-monitoring"
                maxLength={60}
                className={cn(INPUT_CLS, 'font-mono', mode === 'edit' && 'bg-stone-100 text-stone-500')}
              />
              {!idValid && draft.id.length > 0 && (
                <p className="mt-1 text-[11px] text-rose-600">
                  только латиница, цифры, дефис; начинаться с буквы или цифры
                </p>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>Назначение</FieldLabel>
            <textarea
              value={draft.purpose}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              placeholder="Распределённый акустический сенсор: ловит утечки на магистральном трубопроводе"
              rows={2}
              className={INPUT_CLS}
            />
          </div>

          {/* Статус — крупные радиоселекты с описанием */}
          <div>
            <FieldLabel>Статус жизненного цикла</FieldLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STATUS_OPTIONS.map((s) => {
                const selected = draft.status === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, status: s.id })}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left transition',
                      selected
                        ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                        : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50',
                    )}
                  >
                    <div className={cn('text-xs font-semibold', selected ? 'text-blue-800' : 'text-stone-800')}>
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-stone-500">{s.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <FieldLabel>Владелец</FieldLabel>
              <input
                value={draft.owner ?? ''}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value || null })}
                placeholder="АО Дунай-Связь"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Версия</FieldLabel>
              <input
                value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                placeholder="1.0"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>Домен</FieldLabel>
              <select
                value={draft.domain ?? ''}
                onChange={(e) => setDraft({ ...draft, domain: e.target.value || null })}
                className={INPUT_CLS}
              >
                <option value="">— не выбран —</option>
                {(domains ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Контракт */}
          <section className="rounded-md border border-stone-200 bg-stone-50/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
              Контракт интеграции
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <FieldLabel>Канал</FieldLabel>
                <select
                  value={draft.api_contract.channel}
                  onChange={(e) => setApi('channel', e.target.value as ModuleDraft['api_contract']['channel'])}
                  className={INPUT_CLS}
                >
                  {CHANNEL_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Формат</FieldLabel>
                <select
                  value={draft.api_contract.event_format}
                  onChange={(e) => setApi('event_format', e.target.value as ModuleDraft['api_contract']['event_format'])}
                  className={INPUT_CLS}
                >
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Авторизация</FieldLabel>
                <select
                  value={draft.api_contract.auth_type}
                  onChange={(e) => setApi('auth_type', e.target.value as ModuleDraft['api_contract']['auth_type'])}
                  className={INPUT_CLS}
                >
                  {AUTH_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <FieldLabel>URL / endpoint</FieldLabel>
                <input
                  value={draft.api_contract.url ?? ''}
                  onChange={(e) => setApi('url', e.target.value || null)}
                  placeholder="https://module.example.org/events"
                  className={cn(INPUT_CLS, 'font-mono')}
                />
              </div>
              <div>
                <FieldLabel>Rate limit</FieldLabel>
                <input
                  value={draft.api_contract.rate_limit ?? ''}
                  onChange={(e) => setApi('rate_limit', e.target.value || null)}
                  placeholder="100 событий/сек"
                  className={INPUT_CLS}
                />
              </div>
              <div className="md:col-span-3">
                <FieldLabel>Заметки по контракту</FieldLabel>
                <textarea
                  value={draft.api_contract.notes ?? ''}
                  onChange={(e) => setApi('notes', e.target.value || null)}
                  rows={2}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </section>

          {/* Качество данных */}
          <section className="rounded-md border border-stone-200 bg-stone-50/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
              Требования к качеству данных
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <FieldLabel>Полнота</FieldLabel>
                <input
                  value={draft.quality_rules.completeness ?? ''}
                  onChange={(e) => setQuality('completeness', e.target.value || null)}
                  placeholder="≥ 99% обязательных полей заполнены"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel>Макс. задержка (сек)</FieldLabel>
                <input
                  type="number"
                  min={0}
                  value={draft.quality_rules.max_latency_seconds ?? ''}
                  onChange={(e) =>
                    setQuality('max_latency_seconds', e.target.value === '' ? null : Number(e.target.value))
                  }
                  placeholder="60"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel>Макс. ошибок (%)</FieldLabel>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.quality_rules.max_error_rate_percent ?? ''}
                  onChange={(e) =>
                    setQuality('max_error_rate_percent', e.target.value === '' ? null : Number(e.target.value))
                  }
                  placeholder="0.1"
                  className={INPUT_CLS}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={draft.quality_rules.deduplication}
                    onChange={(e) => setQuality('deduplication', e.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                  />
                  Дедупликация по event_id
                </label>
              </div>
            </div>
          </section>

          {/* Типы событий */}
          <div>
            <FieldLabel>Типы событий (один на строку)</FieldLabel>
            <textarea
              value={eventTypesText}
              onChange={(e) => setEventTypesText(e.target.value)}
              placeholder={'leak.suspected\nleak.confirmed\nfiber.broken'}
              rows={3}
              className={cn(INPUT_CLS, 'font-mono text-[12px]')}
            />
            <p className="mt-1 text-[11px] text-stone-500">
              Должны соответствовать `event_type` в триггерах регламентов.
            </p>
          </div>

          {/* Контакты */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <FieldLabel>Email для интеграции</FieldLabel>
              <input
                type="email"
                value={draft.contact_email ?? ''}
                onChange={(e) => setDraft({ ...draft, contact_email: e.target.value || null })}
                placeholder="integration@module.example.org"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>URL документации</FieldLabel>
              <input
                value={draft.documentation_url ?? ''}
                onChange={(e) => setDraft({ ...draft, documentation_url: e.target.value || null })}
                placeholder="https://docs.example.org/module"
                className={cn(INPUT_CLS, 'font-mono')}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Заметки / ограничения</FieldLabel>
            <textarea
              value={draft.notes ?? ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
              rows={2}
              className={INPUT_CLS}
              placeholder="например: 152-ФЗ для персональных данных, не передавать в облако"
            />
          </div>

          {/* Иконка */}
          <div>
            <FieldLabel>Иконка</FieldLabel>
            <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50/40 p-2">
              {GROUP_ORDER.map((group) => (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    {DOMAIN_GROUP_LABELS[group]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {iconsByGroup[group].map((opt) => {
                      const Icon = opt.icon
                      const selected = draft.icon === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDraft({ ...draft, icon: selected ? null : opt.id })}
                          title={opt.label}
                          className={cn(
                            'inline-flex h-8 w-8 items-center justify-center rounded-md border transition',
                            selected
                              ? cn('border-primary ring-2 ring-primary/30', previewVisual.iconBg, previewVisual.iconFg)
                              : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:bg-stone-100',
                          )}
                        >
                          <Icon size={14} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Цвет */}
          <div>
            <FieldLabel>Цвет акцента</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {DOMAIN_COLORS_REGISTRY.map((c) => {
                const v = buildUserDomainVisual(draft.icon, c.id)
                const selected = draft.color === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, color: c.id })}
                    title={c.label}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md border transition',
                      v.accent,
                      selected ? 'border-stone-900 ring-2 ring-stone-900/30' : 'border-stone-200 hover:border-stone-400',
                    )}
                  >
                    {selected && <span className="text-white">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {save.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не удалось сохранить: {(save.error as Error).message}
            </div>
          )}
          {del.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не удалось удалить: {(del.error as Error).message}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
          {mode === 'edit' ? (
            <Button
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => {
                if (window.confirm(`Удалить модуль «${draft.name}»? Действие необратимо.`)) {
                  del.mutate()
                }
              }}
              disabled={save.isPending || del.isPending}
              className="text-rose-700 hover:bg-rose-50"
            >
              {del.isPending ? 'Удаляю…' : 'Удалить'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={save.isPending || del.isPending}>
              Отмена
            </Button>
            <Button
              variant="primary"
              icon={mode === 'create' ? <Plus size={14} /> : <Save size={14} />}
              disabled={!canSubmit}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? 'Сохраняю…'
                : mode === 'create'
                  ? 'Создать модуль'
                  : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const INPUT_CLS =
  'w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40'

const STATUS_BADGE_CLS: Record<ModuleDraft['status'], string> = {
  draft: 'bg-stone-100 text-stone-700 border-stone-200',
  piloting: 'bg-amber-50 text-amber-800 border-amber-200',
  production: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  deprecated: 'bg-rose-50 text-rose-700 border-rose-200',
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-600">
      {children}
      {required && <span className="text-rose-500"> *</span>}
    </label>
  )
}
