import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Activity,
  Beaker,
  BookOpen,
  ClipboardList,
  GitBranch,
  ListTree,
  Maximize2,
  Minimize2,
  PlayCircle,
  Plug,
  Radar,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * VS Code-style activity bar: узкая колонка слева, иконки + тултипы при
 * ховере, активный раздел подсвечивается левой акцент-полоской и фоном.
 *
 * Это новый layout вместо старой горизонтальной шапки сверху: даёт больше
 * вертикального места под канвас (Flow editor, Cytoscape, audit timeline)
 * и узнаваемый dev-tool look. Названия разделов появляются в тултипах +
 * внутри каждого экрана (заголовок задаёт сам экран).
 */

const RAIL_WIDTH = 56  // px — стандартная ширина activity bar в VS Code (48-56px)

interface RailItem {
  to: string
  icon: LucideIcon
  label: string
  badge?: 'beta'
  /** prefix match вместо точного — если '/sandbox' активен, то и '/sandbox/...' тоже */
  prefixMatch?: boolean
}

const PRIMARY_ITEMS: RailItem[] = [
  { to: '/sandbox', icon: Beaker, label: 'Студия аналитика', prefixMatch: true },
  { to: '/regulations', icon: ListTree, label: 'Регламенты', prefixMatch: true },
  { to: '/sensors', icon: Radar, label: 'Датчики', prefixMatch: true },
  { to: '/modules', icon: Plug, label: 'Модули', prefixMatch: true },
  { to: '/audit-log', icon: ClipboardList, label: 'Аудит инцидентов', prefixMatch: true },
  { to: '/graph', icon: Activity, label: 'Граф связей', prefixMatch: true },
  { to: '/twins', icon: GitBranch, label: 'Цифровой двойник', prefixMatch: true },
  { to: '/execute', icon: PlayCircle, label: 'Исполнение', badge: 'beta', prefixMatch: true },
]

export function SideRail() {
  return (
    <aside
      className="flex shrink-0 flex-col items-center gap-1 border-r border-stone-200 bg-stone-50 py-2"
      style={{ width: RAIL_WIDTH }}
    >
      {/* Лого — клик ведёт на главную */}
      <BrandTile />

      <div className="my-1 h-px w-8 bg-stone-200" />

      {/* Основная навигация */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {PRIMARY_ITEMS.map((it) => (
          <RailLink key={it.to} {...it} />
        ))}
      </nav>

      {/* Низ — служебные действия */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-1">
        <div className="my-1 h-px w-8 bg-stone-200" />
        <FullscreenButton />
        <DocsButton />
      </div>
    </aside>
  )
}

function BrandTile() {
  return (
    <Tooltip label="Главная — RAGRAF">
      <Link
        to="/"
        className="group flex h-10 w-10 items-center justify-center rounded-md bg-blue-600 text-white transition hover:bg-blue-700"
        aria-label="На главную"
      >
        <span aria-hidden style={{ fontWeight: 700, lineHeight: 1, fontSize: 18 }}>
          Σ
        </span>
      </Link>
    </Tooltip>
  )
}

function RailLink({ to, icon: Icon, label, badge, prefixMatch }: RailItem) {
  const { pathname } = useLocation()
  const active = prefixMatch ? pathname.startsWith(to) : pathname === to

  return (
    <Tooltip label={label} badge={badge}>
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-md transition',
          active
            ? 'bg-blue-50 text-blue-700'
            : 'text-stone-500 hover:bg-stone-200/70 hover:text-stone-900',
        )}
      >
        <Icon size={18} />
        {active && (
          <span
            aria-hidden
            className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-blue-600"
          />
        )}
        {badge && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 rounded-full px-1 text-[8px] font-semibold uppercase tracking-wide',
              active ? 'bg-blue-600 text-white' : 'bg-amber-100 text-amber-700',
            )}
          >
            β
          </span>
        )}
      </Link>
    </Tooltip>
  )
}

function FullscreenButton() {
  const [isFs, setIsFs] = useState<boolean>(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  )
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen?.()
    }
  }
  const Icon = isFs ? Minimize2 : Maximize2
  const label = isFs ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="flex h-10 w-10 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900"
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  )
}

function DocsButton() {
  // Прямая ссылка на Swagger UI — без поповера. ReDoc/OpenAPI JSON убраны
  // как избыточные для аналитика (его рабочий инструмент — Swagger с
  // «Try it out»; raw OpenAPI и ReDoc — для разработчика, у которого есть
  // прямые URL).
  return (
    <Tooltip label="API документация (Swagger)">
      <a
        href="/docs"
        target="_blank"
        rel="noreferrer"
        aria-label="API документация — Swagger UI"
        className="flex h-10 w-10 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900"
      >
        <BookOpen size={16} />
      </a>
    </Tooltip>
  )
}

function Tooltip({
  label,
  badge,
  children,
}: {
  label: string
  badge?: 'beta'
  children: React.ReactNode
}) {
  // CSS-only tooltip: открывается справа, не блокирует клик.
  return (
    <div className="group/tt relative">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition delay-200 group-hover/tt:visible group-hover/tt:opacity-100"
      >
        {label}
        {badge && (
          <span className="ml-1.5 rounded-sm bg-amber-300 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
            beta
          </span>
        )}
      </span>
    </div>
  )
}
