import {
  Activity,
  AlertTriangle,
  Banknote,
  Bird,
  Briefcase,
  Building2,
  Bus,
  Cctv,
  Cog,
  Construction,
  CreditCard,
  Cross,
  Droplet,
  Factory,
  Flame,
  GraduationCap,
  HardHat,
  Heart,
  Home,
  Leaf,
  LifeBuoy,
  type LucideIcon,
  Lightbulb,
  Monitor,
  Package,
  PawPrint,
  Pill,
  PlugZap,
  Recycle,
  Route,
  School,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Store,
  Trash2,
  TreePine,
  Truck,
  Users,
  Utensils,
  Wifi,
  Wrench,
  Settings2,
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

// ──────────────────────────────────────────────────────────
// SmartCity icon registry — для выбора иконки при создании
// пользовательского домена. Группы покрывают типовые сферы умного
// города: строительство, ИТ, экология, медицина, транспорт, ритейл и т.д.
// Пользователь выбирает один из этих ID; backend сохраняет в
// user_domains.icon. getDomainVisual читает обратно.
// ──────────────────────────────────────────────────────────

export interface DomainIconOption {
  id: string
  label: string
  icon: LucideIcon
  /** Группа в селекторе — UI рисует их под общими заголовками. */
  group: 'infra' | 'tech' | 'people' | 'env' | 'transport' | 'trade' | 'safety'
}

export const DOMAIN_ICONS_REGISTRY: DomainIconOption[] = [
  // Инфраструктура и стройка
  { id: 'construction', label: 'Строительство', icon: Construction, group: 'infra' },
  { id: 'development', label: 'Девелопмент', icon: Building2, group: 'infra' },
  { id: 'design', label: 'Проектирование', icon: HardHat, group: 'infra' },
  { id: 'housing', label: 'Жильё / ЖКХ', icon: Home, group: 'infra' },
  { id: 'utilities', label: 'Коммуналка', icon: Wrench, group: 'infra' },
  { id: 'energy', label: 'Энергетика', icon: PlugZap, group: 'infra' },
  { id: 'water', label: 'Водоснабжение', icon: Droplet, group: 'infra' },
  { id: 'industry', label: 'Промышленность', icon: Factory, group: 'infra' },
  // ИТ и связь
  { id: 'it', label: 'ИТ-системы', icon: Monitor, group: 'tech' },
  { id: 'telecom', label: 'Связь', icon: Wifi, group: 'tech' },
  { id: 'innovation', label: 'Инновации', icon: Lightbulb, group: 'tech' },
  // Люди, образование, услуги
  { id: 'education', label: 'Образование', icon: GraduationCap, group: 'people' },
  { id: 'school', label: 'Школы / Детсады', icon: School, group: 'people' },
  { id: 'social', label: 'Соцслужбы', icon: Users, group: 'people' },
  { id: 'services', label: 'Бытовые услуги', icon: Briefcase, group: 'people' },
  // Медицина
  { id: 'healthcare', label: 'Здравоохранение', icon: Cross, group: 'people' },
  { id: 'medical', label: 'Скорая / Клиники', icon: Stethoscope, group: 'people' },
  { id: 'pharmacy', label: 'Аптеки', icon: Pill, group: 'people' },
  { id: 'wellbeing', label: 'Здоровье населения', icon: Heart, group: 'people' },
  // Природа и экология
  { id: 'environment', label: 'Экология', icon: Leaf, group: 'env' },
  { id: 'forest', label: 'Парки и леса', icon: TreePine, group: 'env' },
  { id: 'wildlife', label: 'Охрана животных', icon: PawPrint, group: 'env' },
  { id: 'birds', label: 'Орнитология', icon: Bird, group: 'env' },
  { id: 'recycling', label: 'Переработка', icon: Recycle, group: 'env' },
  { id: 'waste', label: 'Отходы', icon: Trash2, group: 'env' },
  // Транспорт
  { id: 'traffic', label: 'Дорожное движение', icon: Route, group: 'transport' },
  { id: 'cargo', label: 'Грузоперевозки', icon: Truck, group: 'transport' },
  { id: 'transit', label: 'Общественный транспорт', icon: Bus, group: 'transport' },
  { id: 'logistics', label: 'Логистика', icon: Package, group: 'transport' },
  // Торговля и услуги
  { id: 'retail', label: 'Ритейл', icon: ShoppingBag, group: 'trade' },
  { id: 'trade', label: 'Торговля', icon: Store, group: 'trade' },
  { id: 'finance', label: 'Финансы', icon: Banknote, group: 'trade' },
  { id: 'payments', label: 'Платежи', icon: CreditCard, group: 'trade' },
  { id: 'food', label: 'Общепит', icon: Utensils, group: 'trade' },
  // Безопасность
  { id: 'safety', label: 'Безопасность', icon: ShieldAlert, group: 'safety' },
  { id: 'fire', label: 'Пожарная безопасность', icon: Flame, group: 'safety' },
  { id: 'emergency_response', label: 'Ситуационный центр', icon: LifeBuoy, group: 'safety' },
  { id: 'surveillance', label: 'Видеонаблюдение', icon: Cctv, group: 'safety' },
  { id: 'alerts', label: 'Чрезвычайные ситуации', icon: AlertTriangle, group: 'safety' },
  // Универсальные
  { id: 'monitoring', label: 'Мониторинг', icon: Activity, group: 'tech' },
  { id: 'admin', label: 'Управление', icon: Cog, group: 'people' },
  { id: 'culture', label: 'Культура', icon: Sparkles, group: 'people' },
]

export const DOMAIN_ICONS_BY_ID: Record<string, LucideIcon> = Object.fromEntries(
  DOMAIN_ICONS_REGISTRY.map((o) => [o.id, o.icon]),
)

export const DOMAIN_GROUP_LABELS: Record<DomainIconOption['group'], string> = {
  infra: 'Инфраструктура',
  tech: 'ИТ и инновации',
  people: 'Люди и услуги',
  env: 'Экология и природа',
  transport: 'Транспорт',
  trade: 'Торговля',
  safety: 'Безопасность',
}

// SmartCity color palette — пользователь выбирает «акцент» для домена.
// Каждый id соответствует Tailwind tone'у; DomainVisual генерируется
// по схеме `bg-{tone}-100`, `text-{tone}-700` и т.д.
export interface DomainColorOption {
  id: string
  label: string
  /** Tailwind tone name — `orange`, `blue`, ... — без хэша. */
  tone: string
}

export const DOMAIN_COLORS_REGISTRY: DomainColorOption[] = [
  { id: 'orange', label: 'Оранжевый', tone: 'orange' },
  { id: 'amber', label: 'Янтарный', tone: 'amber' },
  { id: 'yellow', label: 'Жёлтый', tone: 'yellow' },
  { id: 'emerald', label: 'Изумрудный', tone: 'emerald' },
  { id: 'green', label: 'Зелёный', tone: 'green' },
  { id: 'teal', label: 'Бирюзовый', tone: 'teal' },
  { id: 'sky', label: 'Небесный', tone: 'sky' },
  { id: 'blue', label: 'Синий', tone: 'blue' },
  { id: 'indigo', label: 'Индиго', tone: 'indigo' },
  { id: 'violet', label: 'Фиолетовый', tone: 'violet' },
  { id: 'fuchsia', label: 'Фуксия', tone: 'fuchsia' },
  { id: 'rose', label: 'Розовый', tone: 'rose' },
  { id: 'stone', label: 'Графит (нейтр.)', tone: 'stone' },
]

function buildVisualFromTone(tone: string, icon: LucideIcon): DomainVisual {
  return {
    icon,
    iconBg: `bg-${tone}-100`,
    iconFg: `text-${tone}-700`,
    accent: `bg-${tone}-500`,
    chipBg: `bg-${tone}-50`,
    chipFg: `text-${tone}-700`,
    cardBorder: `border-${tone}-100 hover:border-${tone}-300`,
    sectionBg: `bg-gradient-to-r from-${tone}-50/80 to-transparent`,
  }
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
  // Ситуационный центр / ЕДДС. Тон — amber (янтарный, как сигнальный круг
  // оперативного дежурного). Это аварийно-диспетчерская тематика, контрастирует
  // с rose (safety = «уже горит»: серверная, охрана) и blue (housing).
  emergency_response: {
    icon: LifeBuoy,
    iconBg: 'bg-amber-100',
    iconFg: 'text-amber-700',
    accent: 'bg-amber-500',
    chipBg: 'bg-amber-50',
    chipFg: 'text-amber-700',
    cardBorder: 'border-amber-100 hover:border-amber-300',
    sectionBg: 'bg-gradient-to-r from-amber-50/80 to-transparent',
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

// Регистр пользовательских визуалов: id → {icon, color}. Заполняется
// useDomainVisualSync() (см. App.tsx) при загрузке списка доменов.
// Без этого getDomainVisual('my-custom-domain') возвращал бы FALLBACK,
// даже если backend сохранил иконку и цвет.
const _userDomainOverrides: Map<string, DomainVisual> = new Map()

export function registerUserDomainVisuals(
  domains: Array<{ id: string; icon?: string | null; color?: string | null }>,
): void {
  _userDomainOverrides.clear()
  for (const d of domains) {
    if (!d.icon && !d.color) continue
    _userDomainOverrides.set(d.id, buildUserDomainVisual(d.icon, d.color))
  }
}

export function getDomainVisual(domainId: string | null | undefined): DomainVisual {
  if (!domainId) return FALLBACK_VISUAL
  // Seed-домены приоритетны (зашиты в коде), но если пользователь явно
  // переопределил визуал для seed-id'а через user_domains.icon/color,
  // overrides побеждают — это даёт «изменить иконку для heating» в будущем.
  return _userDomainOverrides.get(domainId) ?? DOMAIN_VISUALS[domainId] ?? FALLBACK_VISUAL
}

/**
 * Получить визуал для пользовательского домена, у которого backend сохранил
 * `icon` и `color` (см. POST /api/domains). Если icon/color не заданы —
 * fallback на FALLBACK_VISUAL (серый Settings2). Если задан только color —
 * иконка Settings2 на этом тоне. Если задан только icon — иконка на stone.
 */
export function buildUserDomainVisual(
  icon: string | null | undefined,
  color: string | null | undefined,
): DomainVisual {
  const iconCmp = (icon && DOMAIN_ICONS_BY_ID[icon]) || Settings2
  const tone = color || 'stone'
  return buildVisualFromTone(tone, iconCmp)
}

/**
 * Унифицированный resolver: сначала seed-таблица, потом user-overrides
 * (icon/color из объекта domain). Принимает либо id, либо весь объект
 * `{id, icon?, color?}`.
 */
export function resolveDomainVisual(
  domain: string | { id: string; icon?: string | null; color?: string | null } | null | undefined,
): DomainVisual {
  if (!domain) return FALLBACK_VISUAL
  if (typeof domain === 'string') return getDomainVisual(domain)
  // Если для seed-домена пришёл объект — приоритет user overrides если они есть.
  if (domain.icon || domain.color) {
    return buildUserDomainVisual(domain.icon, domain.color)
  }
  return getDomainVisual(domain.id)
}
