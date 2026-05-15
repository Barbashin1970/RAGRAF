import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui'

interface Props {
  open: boolean
  onClose: () => void
  /** Callback после успешного создания — UI может предложить «теперь извлечь регламенты». */
  onCreated?: (domain: { id: string; label: string; hint?: string }) => void
  /** Префилл из контекста (например, имя файла исходного документа). */
  initialLabel?: string
  initialHint?: string
}

/**
 * Создание пользовательского домена. Сценарий — bootstrap: загрузили документ
 * по новой теме, анализ не нашёл соседей по корпусу, открываем диалог отсюда
 * чтобы завести домен и сразу извлекать регламенты в него.
 *
 * Поля:
 *  - Название (label, обязательно) — рус.
 *  - Подсказка (hint, опционально) — короткое описание для UI.
 *  - id формируется на сервере (slug от label).
 */
export function CreateDomainDialog({ open, onClose, onCreated, initialLabel, initialHint }: Props) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (open) {
      setLabel(initialLabel ?? '')
      setHint(initialHint ?? '')
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
    mutationFn: () => api.domains.create({ label: label.trim(), hint: hint.trim() || undefined }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      onCreated?.(d)
      onClose()
    },
  })

  if (!open) return null

  const canSubmit = label.trim().length > 0 && !create.isPending

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white shadow-xl"
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

        <div className="space-y-3 px-5 py-4 text-sm">
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
              ID будет сформирован автоматически из названия (slug). Регламенты будут группироваться по этому домену.
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
