import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  children: ReactNode
  /** Дополнительный класс на корневом контейнере. Использовать редко — обычно
   *  PageShell задаёт все нужные базовые отступы и фон. */
  className?: string
}

/**
 * Корневой контейнер любого основного экрана. Обеспечивает:
 *  - flex column на всю высоту main-area
 *  - неяркий фон stone-50 (как Notion/Linear/Camunda Cockpit — workspace-feel)
 *  - overflow-hidden (внутренние scroll-области сами управляют прокруткой)
 *
 * Внутри `PageHeader` идёт первым, дальше — основной контент в `<div className="flex-1 overflow-auto p-6">`
 * или специфичная разметка экрана (graph/flow editor с canvas'ом).
 */
export function PageShell({ children, className }: Props) {
  return <div className={cn('flex h-full flex-col bg-stone-50', className)}>{children}</div>
}

interface BodyProps {
  children: ReactNode
  /** При false — без padding'а (для full-bleed canvas как graph/flow). */
  padded?: boolean
  /** maxWidth контента — для текстовых экранов лучше container, для editor'ов full. */
  contained?: boolean
  className?: string
}

/**
 * Стандартная scroll-зона под PageHeader. Включает padding (если `padded=true`)
 * и опционально center-ограничение ширины для лучшей читаемости текста.
 */
export function PageBody({
  children,
  padded = true,
  contained = false,
  className,
}: BodyProps) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-auto',
        padded && 'p-6',
        contained && 'mx-auto w-full max-w-5xl',
        className,
      )}
    >
      {children}
    </div>
  )
}
