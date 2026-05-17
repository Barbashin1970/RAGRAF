import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Wand2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDomainVisual } from '@/lib/domains'
import { Button } from '@/components/ui'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Модальное окно создания нового регламента.
 *
 * Поля:
 *  - Домен (chip-выбор, обязателен)
 *  - Название (textarea; если пустое — берётся default_name шаблона)
 *  - «Использовать шаблон» (toggle, по умолчанию ON)
 *
 * При успехе — invalidate `['datasets']` + navigate в `/regulations/{id}/edit`.
 */
export function CreateRegulationDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: domains = [] } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })

  const [domain, setDomain] = useState<string>('')
  const [name, setName] = useState('')
  const [useTemplate, setUseTemplate] = useState(true)

  // Сбрасываем форму при каждом открытии (включая повторное)
  useEffect(() => {
    if (open) {
      setDomain(domains[0]?.id ?? '')
      setName('')
      setUseTemplate(true)
    }
  }, [open, domains])

  // Close on Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const create = useMutation({
    mutationFn: () =>
      api.regulations.create({
        domain,
        name: name.trim() || undefined,
        use_template: useTemplate,
      }),
    onSuccess: (reg) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      onClose()
      navigate(`/regulations/${reg.id}/edit`)
    },
  })

  if (!open) return null

  const canSubmit = !!domain && !create.isPending

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-base font-semibold text-stone-900">Новый регламент</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть" className="h-7 w-7 p-0">
            <X size={14} />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Домен */}
          <section>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Домен</div>
            <div className="grid grid-cols-2 gap-2">
              {domains.map((d) => {
                const v = getDomainVisual(d.id)
                const Icon = v.icon
                const active = domain === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => setDomain(d.id)}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2.5 text-left transition',
                      active
                        ? cn(v.cardBorder.split(' ')[0], 'bg-stone-50 ring-1 ring-primary')
                        : 'border-stone-200 hover:bg-stone-50',
                    )}
                  >
                    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded', v.iconBg)}>
                      <Icon size={14} className={v.iconFg} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800">{d.label}</div>
                      {d.hint && <div className="text-[10px] leading-tight text-stone-500">{d.hint}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Название */}
          <section>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">
                Название <span className="text-stone-400 normal-case">(необязательно)</span>
              </div>
              <textarea
                rows={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Если оставить пустым — возьмётся название из шаблона"
                className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>
          </section>

          {/* Шаблон */}
          <section>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-stone-200 p-3 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-stone-800">
                  Заполнить из шаблона домена
                </div>
                <div className="text-xs text-stone-500">
                  Создадутся 3–5 типичных параметров с диапазонами, стартовый Rule DSL поток
                  и каркас рекомендации. Это сильно ускоряет начало: правите/удаляете готовое,
                  а не создаёте с нуля.
                </div>
              </div>
            </label>
          </section>

          {create.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Не удалось создать регламент: {(create.error as Error).message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
          {/* Альтернативный entry-point: «текст → параметры → регламент».
              Раньше переходило в Sandbox (там жил extract-tab), теперь —
              в полноэкранный /regulations/new-from-text. Это rules-based
              regex без LLM, поэтому экран в разделе «Регламенты», а не в
              «Студии аналитика». Если в диалоге уже выбран домен — пробрасываем
              его в новый экран через ?domain=, чтобы выбор не сбрасывался. */}
          <Button
            variant="author"
            icon={<Wand2 size={14} />}
            onClick={() => {
              onClose()
              const q = domain ? `?domain=${encodeURIComponent(domain)}` : ''
              navigate(`/regulations/new-from-text${q}`)
            }}
            disabled={create.isPending}
            title="Открыть полноэкранный режим извлечения параметров: вставляешь текст, выбираешь параметры, создаётся регламент"
          >
            Извлечь из текста
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
              Отмена
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              loading={create.isPending}
              disabled={!canSubmit}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Создаю…' : 'Создать'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
