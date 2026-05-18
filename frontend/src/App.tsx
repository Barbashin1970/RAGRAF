import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, Beaker, BookOpen, ExternalLink, FileJson, GitBranch, ListTree, Maximize2, Minimize2, PlayCircle, Radar } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GraphView } from '@/components/graph/GraphView'
import { TwinDesignerScreen } from '@/components/twins/TwinDesignerScreen'
import { LandingScreen } from '@/components/landing/LandingScreen'
import { RegulationList } from '@/components/regulations/RegulationList'
import { RegulationEditorScreen } from '@/components/regulations/RegulationEditorScreen'
import { FlowEditorScreen } from '@/components/flow/FlowEditorScreen'
import { ConstraintEditorScreen } from '@/components/constraints/ConstraintEditorScreen'
import { SandboxScreen } from '@/components/sandbox/SandboxScreen'
import { SandboxBacklog } from '@/components/sandbox/SandboxBacklog'
import { RaguStudioScreen } from '@/components/ragu/RaguStudioScreen'
import { SensorLibraryScreen } from '@/components/sensors/SensorLibraryScreen'
import { ExecuteScreen } from '@/components/execute/ExecuteScreen'
import { RegulationExtractScreen } from '@/components/regulations/RegulationExtractScreen'
import { cn } from '@/lib/cn'

function NavLink({ to, icon: Icon, label }: { to: string; icon: typeof Activity; label: string }) {
  const { pathname } = useLocation()
  const active = pathname === to || (to !== '/' && pathname.startsWith(to))
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
        // Шапка унифицирована под синюю палитру Σ-лого (см. LandingScreen).
        // Раньше использовали primary=teal — это цвет Model Layer в design
        // system (ARC.md §1.5), а в шапке это создавало «кашу» из 3+ цветов.
        // Active = bg-blue-600 совпадает с Σ-бейджем слева.
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700',
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  )
}

/**
 * Активная навигация на «Исполнение». В отличие от прежней заглушки, теперь
 * работает симулятор: пользователь выбирает регламент, подаёт тестовый
 * payload, видит вердикт. Полный event-driven runtime (приёмник событий
 * от СИГМЫ, webhook на OUTPUT, журнал срабатываний) — в бэклоге.
 *
 * Бейдж «beta» сигнализирует частичную готовность: симулятор работает,
 * боевой режим — в работе. ExecuteScreen объясняет детально что готово.
 */
function ExecutionNavLink() {
  const { pathname } = useLocation()
  const active = pathname.startsWith('/execute')
  return (
    <Link
      to="/execute"
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700',
      )}
    >
      <PlayCircle size={16} />
      Исполнение
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
          // beta-badge остаётся amber — это явный «warning»-сигнал статуса,
          // должен отличаться от nav-палитры. Универсальная конвенция.
          active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700',
        )}
      >
        beta
      </span>
    </Link>
  )
}

/**
 * Docs-меню в шапке справа: ведёт на FastAPI Swagger UI (/docs), ReDoc (/redoc)
 * и сырой OpenAPI JSON. Пробрасывается через vite proxy на backend :8000.
 *
 * Назначение — визуально проверять собственное API RAGRAF: какие эндпоинты
 * доступны, схемы запросов/ответов, пробовать «Try it out» прямо из браузера.
 */
/**
 * Кнопка перехода в Fullscreen режим браузера — скрывает строку браузера
 * (URL bar, табы) и даёт максимум места под канвас/таблицы. Особенно полезно
 * для Flow Editor: при 100% масштабе нижние блоки палитры и SHACL уходят
 * под viewport, fullscreen возвращает им место.
 *
 * Использует стандартный Fullscreen API. `document.documentElement.requestFullscreen()`
 * охватывает всю страницу — не только текущий компонент.
 */
function FullscreenToggle() {
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
      // Если браузер не поддерживает (Safari < 16.4 webkit-only) — тихо игнорим;
      // shimming через webkitRequestFullscreen не делаем, чтобы не разрастаться.
      void document.documentElement.requestFullscreen?.()
    }
  }
  const Icon = isFs ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={toggle}
      title={isFs ? 'Выйти из полноэкранного режима' : 'На весь экран (скрыть строку браузера)'}
      aria-label={isFs ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"
    >
      <Icon size={14} />
    </button>
  )
}


function DocsMenu() {
  const items: Array<{ href: string; icon: typeof BookOpen; label: string; hint: string }> = [
    { href: '/docs',         icon: BookOpen,    label: 'Swagger UI', hint: 'Интерактивная документация с Try-it-out' },
    { href: '/redoc',        icon: ListTree,    label: 'ReDoc',      hint: 'Читабельная справка' },
    { href: '/openapi.json', icon: FileJson,    label: 'OpenAPI',    hint: 'Сырой OpenAPI spec (JSON)' },
  ]
  return (
    <div className="group relative">
      <button
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
        type="button"
      >
        <BookOpen size={14} className="text-stone-500" />
        Docs
      </button>
      <div className="invisible absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-stone-200 bg-white p-1 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
        {items.map((it) => {
          const Icon = it.icon
          return (
            <a
              key={it.href}
              href={it.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded p-2 text-sm hover:bg-surface-offset"
            >
              <Icon size={14} className="mt-0.5 text-stone-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-medium text-stone-800">
                  {it.label} <ExternalLink size={10} className="text-stone-400" />
                </div>
                <div className="text-xs text-stone-500">{it.hint}</div>
              </div>
            </a>
          )
        })}
        <div className="mt-1 border-t border-stone-100 px-2 py-1.5 text-[10px] text-stone-400">
          Референс модели данных (прототип Sigma) —{' '}
          <a
            href="http://109.202.1.153:8958/docs"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-stone-600"
            title="Исходный API-референс, с которого списан контракт; RAGRAF на проде к нему не обращается"
          >
            109.202.1.153:8958/docs
          </a>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  // На главной (LandingScreen) показываем «маркетинговый» layout без
  // top-nav — landing — это полностраничный hero. На всех остальных
  // экранах — стандартная шапка с навигацией.
  const { pathname } = useLocation()
  const isLanding = pathname === '/'

  return (
    <div className="flex h-full flex-col">
      {!isLanding && (
        <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2">
          <Link
            to="/"
            className="group mr-2 inline-flex items-center gap-1.5 text-lg font-semibold text-blue-700 transition hover:text-blue-800"
            title="На главную «Сигма»"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white transition group-hover:bg-blue-700">
              <span aria-hidden style={{ fontWeight: 700, lineHeight: 1 }}>Σ</span>
            </span>
            <span>RAGRAF</span>
          </Link>
          {/* Навигация отражает Author/Execute split (см. BACKLOG → Phase 1).
              «Студия аналитика» — где LLM/RAGU помогают разобрать документы;
              «Регламенты» — структурированные модели (data layer);
              «Исполнение» — runtime (event-mode), пока заглушка с roadmap. */}
          <nav className="flex items-center gap-1">
            <NavLink to="/sandbox" icon={Beaker} label="Студия аналитика" />
            <NavLink to="/regulations" icon={ListTree} label="Регламенты" />
            <NavLink to="/sensors" icon={Radar} label="Датчики" />
            <NavLink to="/graph" icon={Activity} label="Граф связей" />
            {/* Цифровой двойник — отдельная страница где собираются процессы
                из 2+ регламентов. Не путать с /graph (карта всего корпуса)
                и с /regulations/:id/flow (поток одного регламента). */}
            <NavLink to="/twins" icon={GitBranch} label="Цифровой двойник" />
            {/* RAGU Studio переехала внутрь Студии аналитика как 3-й таб
                (см. SandboxScreen). Из шапки убрана чтобы навигация была
                4-уровневой (3 экрана + roadmap), не превращалась в кашу. */}
            <ExecutionNavLink />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-stone-500 lg:inline">
              среда проектирования цифрового двойника
            </span>
            <FullscreenToggle />
            <DocsMenu />
          </div>
        </header>
      )}

      {/* Landing — это длинная single-page страница, она ДОЛЖНА скроллиться
          вертикально. Внутренние экраны (Регламенты, Студия, Flow Editor)
          управляют скроллом сами и хотят `overflow-hidden` чтобы не было
          двойного скролл-бара. Поэтому overflow main зависит от маршрута. */}
      <main
        className={cn(
          'min-h-0 flex-1',
          isLanding ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <Routes>
          <Route path="/" element={<LandingScreen />} />
          <Route path="/regulations" element={<RegulationList />} />
          <Route path="/regulations/new-from-text" element={<RegulationExtractScreen />} />
          <Route path="/regulations/:id/edit" element={<RegulationEditorScreen />} />
          <Route path="/regulations/:id/flow" element={<FlowEditorScreen />} />
          <Route path="/regulations/:id/constraints" element={<ConstraintEditorScreen />} />
          <Route path="/sensors" element={<SensorLibraryScreen />} />
          <Route path="/execute" element={<ExecuteScreen />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="/twins" element={<TwinDesignerScreen />} />
          <Route path="/twins/:id" element={<TwinDesignerScreen />} />
          <Route path="/sandbox" element={<SandboxScreen />} />
          <Route path="/sandbox/backlog" element={<SandboxBacklog />} />
          {/* Старый маршрут /ragu теперь редиректит в таб RAGU Studio
              внутри Студии аналитика. Старые ссылки в коде/документации
              не ломаются. */}
          <Route path="/ragu" element={<Navigate to="/sandbox?tab=ragu" replace />} />
          {/* Старый маршрут extract-tab — теперь отдельный экран в /regulations. */}
          <Route path="/sandbox/extract" element={<Navigate to="/regulations/new-from-text" replace />} />
          <Route path="*" element={<div className="p-6 text-stone-500">Страница не найдена</div>} />
        </Routes>
      </main>
    </div>
  )
}
