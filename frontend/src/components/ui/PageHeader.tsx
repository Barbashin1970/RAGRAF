import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type LayerTone = 'author' | 'model' | 'execute' | 'neutral'

interface Props {
  icon: LucideIcon
  /** Тон рамки иконки и (опционально) layer-бейджа. */
  tone?: LayerTone
  title: string
  /** Tooltip на title (через title-атрибут). Когда description слишком длинный
   *  и отнимает вертикаль у основного контента, мы прячем его в hover-подсказку. */
  titleTooltip?: string
  /** Текстовое описание под title (1-3 предложения). Поддерживает React-узлы для ссылок/<code>. */
  description?: ReactNode
  /** Бейджи в строке с title (Badge компоненты). */
  badges?: ReactNode
  /** Action-слот справа: кнопки, ссылки, статус. Float-right в header'е. */
  actions?: ReactNode
  /** Дополнительный контент под description — например status-bar, info-callout. */
  children?: ReactNode
  className?: string
}

const TONE_STYLES: Record<LayerTone, { bg: string; fg: string }> = {
  author: { bg: 'bg-violet-100', fg: 'text-violet-700' },
  model: { bg: 'bg-primary/10', fg: 'text-primary' },
  execute: { bg: 'bg-blue-100', fg: 'text-blue-700' },
  neutral: { bg: 'bg-stone-100', fg: 'text-stone-700' },
}

/**
 * Единая шапка страницы — обязательный layout верха каждого основного экрана.
 *
 * Структура: левая часть (иконка + title + бейджи + description), правая (actions).
 * Под этим — `children` для опциональных дополнений (status-bar, info-блок).
 *
 * Tone задаёт цвет рамки иконки и подсказывает к какому слою архитектуры
 * относится экран (Author / Model / Execute). Это поддерживает визуальную
 * навигацию пользователя по разделам.
 */
export function PageHeader({
  icon: Icon,
  tone = 'neutral',
  title,
  titleTooltip,
  description,
  badges,
  actions,
  children,
  className,
}: Props) {
  const t = TONE_STYLES[tone]
  return (
    <header className={cn('border-b border-stone-200 bg-white px-6 pb-3 pt-5', className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', t.bg)}>
              <Icon size={18} className={t.fg} />
            </div>
            <h1
              className={cn(
                'text-2xl font-semibold tracking-tight text-stone-900',
                titleTooltip && 'cursor-help',
              )}
              title={titleTooltip}
            >
              {title}
            </h1>
            {badges}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-stone-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
