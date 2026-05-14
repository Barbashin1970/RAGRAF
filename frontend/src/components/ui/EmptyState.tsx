import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  icon: LucideIcon
  title: string
  description?: ReactNode
  /** Действия — обычно primary-кнопка "Создать" + secondary "Импортировать". */
  action?: ReactNode
  /** Когда EmptyState внутри bordered-Section (Section уже даёт border) — оставить без рамки. */
  bare?: boolean
  className?: string
}

/**
 * Unified empty-state для пустых списков, нулевых поисков, "нет данных".
 * Аналог EmptyState в Atlassian Design / Polaris / Linear.
 *
 * Размер: ~280px высоты — достаточно для контентной паузы, не слишком драматично.
 * Иконка нейтральная (stone), title средний bold, description маленький мутный.
 */
export function EmptyState({ icon: Icon, title, description, action, bare = false, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        !bare && 'rounded-lg border border-dashed border-stone-300 bg-white',
        className,
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
        <Icon size={22} className="text-stone-400" />
      </div>
      <div className="mb-1 text-sm font-medium text-stone-800">{title}</div>
      {description && (
        <div className="mb-3 max-w-md text-xs text-stone-500">{description}</div>
      )}
      {action}
    </div>
  )
}
