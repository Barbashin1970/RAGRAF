import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'author'
  | 'execute'

interface Props {
  tone?: BadgeTone
  /** uppercase + tracking — для seriousness, как enterprise-tools (Camunda, Linear). */
  uppercase?: boolean
  /** Маленькая точка-индикатор слева (опционально). */
  dot?: boolean
  className?: string
  children: ReactNode
}

const TONE_STYLES: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: 'bg-stone-100', fg: 'text-stone-700', dot: 'bg-stone-400' },
  info: { bg: 'bg-sky-50', fg: 'text-sky-700', dot: 'bg-sky-500' },
  success: { bg: 'bg-emerald-50', fg: 'text-emerald-700', dot: 'bg-emerald-500' },
  warning: { bg: 'bg-amber-50', fg: 'text-amber-800', dot: 'bg-amber-500' },
  danger: { bg: 'bg-rose-50', fg: 'text-rose-700', dot: 'bg-rose-500' },
  author: { bg: 'bg-violet-50', fg: 'text-violet-700', dot: 'bg-violet-500' },
  execute: { bg: 'bg-blue-50', fg: 'text-blue-700', dot: 'bg-blue-500' },
}

/**
 * Inline-бейдж для статусов, тегов, мета-инфо. Семантика по тонам:
 *
 *  - `neutral` — нейтральное (count, id, тип)
 *  - `info` — справочное (sky)
 *  - `success` — позитивное / активное (green) — «RAGU подключён», «v1.2 published»
 *  - `warning` — внимание (amber) — «mock-режим», «draft»
 *  - `danger` — критично (rose) — «archived», «conflict»
 *  - `author` — Author Layer (violet) — Студия аналитика
 *  - `execute` — Execute Layer (blue) — Runtime
 *
 * `uppercase` рекомендуется для коротких меток типа категории/слоя (1-2 слова),
 * для значений-данных оставлять без.
 */
export function Badge({
  tone = 'neutral',
  uppercase = false,
  dot = false,
  className,
  children,
}: Props) {
  const t = TONE_STYLES[tone]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        t.bg,
        t.fg,
        uppercase && 'uppercase tracking-wide',
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  )
}
