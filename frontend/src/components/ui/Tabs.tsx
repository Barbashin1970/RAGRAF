import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface TabDef<TId extends string = string> {
  id: TId
  label: string
  icon?: LucideIcon
  /** Маленький бейдж справа (счётчик / статус). */
  badge?: string | number
  disabled?: boolean
}

interface Props<TId extends string = string> {
  tabs: TabDef<TId>[]
  active: TId
  onChange: (id: TId) => void
  /** Цветовая роль активного таба. По умолчанию primary teal. */
  tone?: 'primary' | 'author' | 'execute'
  className?: string
}

const TONE_ACTIVE: Record<NonNullable<Props['tone']>, string> = {
  primary: 'bg-primary/10 text-primary',
  author: 'bg-violet-100 text-violet-800',
  execute: 'bg-blue-100 text-blue-800',
}

/**
 * Единые горизонтальные табы для секций с режимами (Поля/Поток/Ограничения,
 * Диалог/Извлечь параметры, и т.п.). Стиль: pill-кнопки внутри bordered-rail —
 * аналог Segmented Control из iOS, GitHub PR review tabs, Linear filter tabs.
 *
 * `tone` подсказывает к какому слою архитектуры относится экран — внутри
 * Author Layer (Студия) активный таб violet, внутри Model Layer — teal,
 * внутри Execute (в будущем) — blue.
 */
export function Tabs<TId extends string = string>({
  tabs,
  active,
  onChange,
  tone = 'primary',
  className,
}: Props<TId>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md border border-stone-200 bg-white p-0.5',
        className,
      )}
    >
      {tabs.map((t) => {
        const isActive = t.id === active
        const Icon = t.icon
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition',
              isActive ? TONE_ACTIVE[tone] : 'text-stone-600 hover:bg-stone-50',
              t.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {Icon && <Icon size={13} />}
            {t.label}
            {t.badge !== undefined && t.badge !== '' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  isActive ? 'bg-white/70' : 'bg-stone-100',
                )}
              >
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
