import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, X } from 'lucide-react'
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

interface Props {
  open: boolean
  onClose: () => void
  /** Callback после успешного создания — UI может предложить «теперь извлечь регламенты». */
  onCreated?: (domain: { id: string; label: string; hint?: string }) => void
  /** Префилл из контекста (например, имя файла исходного документа). */
  initialLabel?: string
  initialHint?: string
}

const DEFAULT_COLOR = 'stone'
const GROUP_ORDER: Array<DomainIconOption['group']> = [
  'infra', 'tech', 'people', 'env', 'transport', 'trade', 'safety',
]

/**
 * Создание пользовательского домена. Сценарий — bootstrap: загрузили документ
 * по новой теме, анализ не нашёл соседей по корпусу, открываем диалог отсюда
 * чтобы завести домен и сразу извлекать регламенты в него.
 *
 * Поля:
 *  - Название (label, обязательно) — рус.
 *  - Подсказка (hint, опционально) — короткое описание для UI.
 *  - Иконка — SmartCity-палитра (Строительство, ИТ, Экология, ...).
 *  - Цвет — Tailwind tone (orange, blue, ...).
 *  - id формируется на сервере (slug от label).
 */
export function CreateDomainDialog({ open, onClose, onCreated, initialLabel, initialHint }: Props) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [hint, setHint] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)

  useEffect(() => {
    if (open) {
      setLabel(initialLabel ?? '')
      setHint(initialHint ?? '')
      setIcon(null)
      setColor(DEFAULT_COLOR)
    }
  }, [open, initialLabel, initialHint])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const create = useMutation({
    mutationFn: () =>
      api.domains.create({
        label: label.trim(),
        hint: hint.trim() || undefined,
        icon: icon ?? undefined,
        color: color || undefined,
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      onCreated?.(d)
      onClose()
    },
  })

  // Превью карточки домена с выбранными иконкой+цветом
  const previewVisual = useMemo(() => buildUserDomainVisual(icon, color), [icon, color])
  const PreviewIcon = previewVisual.icon

  if (!open) return null

  const canSubmit = label.trim().length > 0 && !create.isPending

  const iconsByGroup = useMemo(() => {
    const map: Record<DomainIconOption['group'], DomainIconOption[]> = {
      infra: [], tech: [], people: [], env: [], transport: [], trade: [], safety: [],
    }
    for (const opt of DOMAIN_ICONS_REGISTRY) {
      map[opt.group].push(opt)
    }
    return map
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Boxes size={16} className="text-emerald-600" />
            Создать новый домен
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={create.isPending}
            aria-label="Закрыть"
            className="h-7 w-7 p-0"
          >
            <X size={14} />
          </Button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {/* Превью карточки — показывает как домен будет выглядеть в списке */}
          <div className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50/60 p-3">
            <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-md', previewVisual.iconBg)}>
              <PreviewIcon className={cn('h-6 w-6', previewVisual.iconFg)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-stone-900">
                {label.trim() || 'Название домена…'}
              </div>
              <div className="truncate text-xs text-stone-500">
                {hint.trim() || 'Превью карточки — выберите иконку и цвет'}
              </div>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', previewVisual.chipBg, previewVisual.chipFg)}>
              превью
            </span>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-600">
              Название домена *
            </label>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="например: Транспортная безопасность"
              maxLength={80}
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <p className="mt-1 text-[11px] text-stone-500">
              ID будет сформирован автоматически из названия (slug).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-600">
              Подсказка (опционально)
            </label>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="например: безопасность пассажирских перевозок, ремонт подвижного состава"
              maxLength={200}
              rows={2}
              className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Иконка — SmartCity-палитра, сгруппированная по сферам умного города */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-600">
              Иконка
            </label>
            <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50/40 p-2">
              {GROUP_ORDER.map((group) => (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    {DOMAIN_GROUP_LABELS[group]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {iconsByGroup[group].map((opt) => {
                      const Icon = opt.icon
                      const selected = icon === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setIcon(selected ? null : opt.id)}
                          title={opt.label}
                          className={cn(
                            'inline-flex h-9 w-9 items-center justify-center rounded-md border transition',
                            selected
                              ? cn('border-primary ring-2 ring-primary/30', previewVisual.iconBg, previewVisual.iconFg)
                              : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:bg-stone-100',
                          )}
                        >
                          <Icon size={16} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-stone-500">
              {icon
                ? DOMAIN_ICONS_REGISTRY.find((o) => o.id === icon)?.label
                : 'Иконка по умолчанию — «Настройка». Кликни иконку, чтобы выбрать.'}
            </p>
          </div>

          {/* Цветовая палитра */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-600">
              Цвет акцента
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DOMAIN_COLORS_REGISTRY.map((c) => {
                const v = buildUserDomainVisual(icon, c.id)
                const selected = color === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    title={c.label}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-md border transition',
                      v.accent,
                      selected
                        ? 'border-stone-900 ring-2 ring-stone-900/30'
                        : 'border-stone-200 hover:border-stone-400',
                    )}
                  >
                    {selected && <span className="text-white">✓</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[11px] text-stone-500">
              {DOMAIN_COLORS_REGISTRY.find((c) => c.id === color)?.label}
            </p>
          </div>

          {create.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не удалось создать домен: {(create.error as Error).message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Отмена
          </Button>
          <Button
            variant="primary"
            icon={<Boxes size={14} />}
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Создаю…' : 'Создать домен'}
          </Button>
        </div>
      </div>
    </div>
  )
}
