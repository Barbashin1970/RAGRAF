import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'author' | 'execute'
export type ButtonSize = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Иконка слева от label'а. Передавай как `<Icon size={14} />` — размер задаёт вызывающий. */
  icon?: ReactNode
  /** Иконка справа (chevron, external-link и т.п.). */
  iconRight?: ReactNode
  children?: ReactNode
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white shadow-sm hover:bg-primary/90 disabled:bg-primary/50',
  secondary:
    'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50',
  ghost:
    'text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50',
  danger:
    'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-600/50',
  author:
    'bg-violet-600 text-white shadow-sm hover:bg-violet-700 disabled:bg-violet-600/50',
  execute:
    'bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-600/50',
}

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2 text-xs',
  md: 'h-9 gap-1.5 px-3 text-sm',
}

/**
 * Базовая кнопка проекта. Шесть вариантов:
 *
 *  - `primary` — teal-акцент (#2C7A7B), главное действие на странице (Сохранить, Создать).
 *  - `secondary` — neutral, отмена/закрытие/вторичные действия.
 *  - `ghost` — без фона, для тулбаров с плотной плотностью.
 *  - `danger` — rose, опасные действия (Удалить, Сбросить).
 *  - `author` — violet, ИИ-инструменты в Студии аналитика (Извлечь, Найти, Спросить).
 *  - `execute` — blue, runtime-действия (Симулировать, Подключить датчик) — для будущей вкладки.
 *
 * При `loading=true` иконка заменяется на спиннер, кнопка disabled. Иконка слева/справа
 * опциональна — оставляет UI чистым без перегруза цветами.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  const showSpinner = loading
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...rest}
    >
      {showSpinner ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
      {!showSpinner && iconRight}
    </button>
  )
}
