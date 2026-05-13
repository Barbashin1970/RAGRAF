import {
  Building2,
  Flame,
  Leaf,
  type LucideIcon,
  Settings2,
  ShieldAlert,
} from 'lucide-react'

export interface DomainVisual {
  icon: LucideIcon
  /** background of the icon chip */
  iconBg: string
  iconFg: string
  /** left accent stripe / top accent line */
  accent: string
  /** chip with count or label */
  chipBg: string
  chipFg: string
  /** subtle border for the card / header */
  cardBorder: string
  /** larger "section" background tint for hero-like headers */
  sectionBg: string
}

export const DOMAIN_VISUALS: Record<string, DomainVisual> = {
  heating: {
    icon: Flame,
    iconBg: 'bg-orange-100',
    iconFg: 'text-orange-700',
    accent: 'bg-orange-500',
    chipBg: 'bg-orange-50',
    chipFg: 'text-orange-700',
    cardBorder: 'border-orange-100 hover:border-orange-300',
    sectionBg: 'bg-gradient-to-r from-orange-50/80 to-transparent',
  },
  housing: {
    icon: Building2,
    iconBg: 'bg-blue-100',
    iconFg: 'text-blue-700',
    accent: 'bg-blue-500',
    chipBg: 'bg-blue-50',
    chipFg: 'text-blue-700',
    cardBorder: 'border-blue-100 hover:border-blue-300',
    sectionBg: 'bg-gradient-to-r from-blue-50/80 to-transparent',
  },
  safety: {
    icon: ShieldAlert,
    iconBg: 'bg-rose-100',
    iconFg: 'text-rose-700',
    accent: 'bg-rose-500',
    chipBg: 'bg-rose-50',
    chipFg: 'text-rose-700',
    cardBorder: 'border-rose-100 hover:border-rose-300',
    sectionBg: 'bg-gradient-to-r from-rose-50/80 to-transparent',
  },
  environment: {
    icon: Leaf,
    iconBg: 'bg-emerald-100',
    iconFg: 'text-emerald-700',
    accent: 'bg-emerald-500',
    chipBg: 'bg-emerald-50',
    chipFg: 'text-emerald-700',
    cardBorder: 'border-emerald-100 hover:border-emerald-300',
    sectionBg: 'bg-gradient-to-r from-emerald-50/80 to-transparent',
  },
}

export const FALLBACK_VISUAL: DomainVisual = {
  icon: Settings2,
  iconBg: 'bg-stone-100',
  iconFg: 'text-stone-700',
  accent: 'bg-stone-400',
  chipBg: 'bg-stone-50',
  chipFg: 'text-stone-700',
  cardBorder: 'border-stone-200 hover:border-stone-300',
  sectionBg: 'bg-gradient-to-r from-stone-50 to-transparent',
}

export function getDomainVisual(domainId: string | null | undefined): DomainVisual {
  if (!domainId) return FALLBACK_VISUAL
  return DOMAIN_VISUALS[domainId] ?? FALLBACK_VISUAL
}
