import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  /** Заголовок секции (опционально). Появится в bordered-полоске сверху. */
  title?: ReactNode
  /** Описание под заголовком (опционально, маленький текст). */
  description?: ReactNode
  /** Actions-slot справа от заголовка (кнопки, переключатели). */
  actions?: ReactNode
  /** Без padding'а внутри (для таблиц, full-bleed контента). */
  flush?: boolean
  /** Карточка с приподнятым выделением (subtle shadow) — для главного блока на странице. */
  elevated?: boolean
  className?: string
  children: ReactNode
}

/**
 * Bordered-карточка для группировки контента. Аналог панели в Camunda Cockpit /
 * Inspector-section в IDE / Section в Notion-database. Используется как универсальный
 * контейнер блока на странице.
 *
 * Title-полоска появляется только если задан `title` — без неё это просто bordered area.
 */
export function Section({
  title,
  description,
  actions,
  flush = false,
  elevated = false,
  className,
  children,
}: Props) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-stone-200 bg-white',
        elevated && 'shadow-sm',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/60 px-4 py-2">
          <div className="min-w-0">
            {title && <div className="text-sm font-semibold text-stone-800">{title}</div>}
            {description && (
              <div className="mt-0.5 text-xs text-stone-500">{description}</div>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  )
}
