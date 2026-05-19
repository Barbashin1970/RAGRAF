import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { registerUserDomainVisuals } from '@/lib/domains'
// Eager-loaded: лёгкие экраны, которые на первый paint показываются часто
// (Landing → конверсия, RegulationList → дефолтная страница работы аналитика,
// Sensor/Module libraries — справочники, открываются быстро после input).
import { LandingScreen } from '@/components/landing/LandingScreen'
import { RegulationList } from '@/components/regulations/RegulationList'
import { SensorLibraryScreen } from '@/components/sensors/SensorLibraryScreen'
import { ModuleLibraryScreen } from '@/components/modules/ModuleLibraryScreen'
import { DomainDetailScreen } from '@/components/domains/DomainDetailScreen'
import { SideRail } from '@/components/layout/SideRail'
import { cn } from '@/lib/cn'
// Lazy-loaded: тяжёлые экраны с большими библиотеками. Каждый — отдельный
// чанк, грузится только при заходе на маршрут. На Railway это критично:
// initial-load падает с 1.4MB до ~200kB → сайт открывается за секунды.
//   - FlowEditorScreen — React Flow (~200kB)
//   - GraphView, TwinDesignerScreen — Cytoscape + cola (~300kB)
//   - SandboxScreen — chat / RAGU / document analysis
//   - AuditLogScreen — timeline + heavy rendering
//   - RegulationEditorScreen — большая форма с табами + Monaco-like editor
//   - RegulationExtractScreen, ConstraintEditorScreen — редкие сценарии
const GraphView = lazy(() => import('@/components/graph/GraphView').then(m => ({ default: m.GraphView })))
const TwinDesignerScreen = lazy(() => import('@/components/twins/TwinDesignerScreen').then(m => ({ default: m.TwinDesignerScreen })))
const FlowEditorScreen = lazy(() => import('@/components/flow/FlowEditorScreen').then(m => ({ default: m.FlowEditorScreen })))
const ConstraintEditorScreen = lazy(() => import('@/components/constraints/ConstraintEditorScreen').then(m => ({ default: m.ConstraintEditorScreen })))
const SandboxScreen = lazy(() => import('@/components/sandbox/SandboxScreen').then(m => ({ default: m.SandboxScreen })))
const SandboxBacklog = lazy(() => import('@/components/sandbox/SandboxBacklog').then(m => ({ default: m.SandboxBacklog })))
const AuditLogScreen = lazy(() => import('@/components/audit/AuditLogScreen').then(m => ({ default: m.AuditLogScreen })))
const ExecuteScreen = lazy(() => import('@/components/execute/ExecuteScreen').then(m => ({ default: m.ExecuteScreen })))
const RegulationEditorScreen = lazy(() => import('@/components/regulations/RegulationEditorScreen').then(m => ({ default: m.RegulationEditorScreen })))
const RegulationExtractScreen = lazy(() => import('@/components/regulations/RegulationExtractScreen').then(m => ({ default: m.RegulationExtractScreen })))

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-stone-500">
      <Loader2 size={16} className="mr-2 animate-spin" /> Загрузка…
    </div>
  )
}

export default function App() {
  // На главной (LandingScreen) показываем «маркетинговый» layout без
  // top-nav — landing — это полностраничный hero. На всех остальных
  // экранах — стандартная шапка с навигацией.
  const { pathname } = useLocation()
  const isLanding = pathname === '/'

  // Регистр пользовательских визуалов: при загрузке списка доменов
  // (один раз на сессию, кешируется react-query'ем) пушим icon/color
  // user-доменов в модуль domains.ts. Это даёт `getDomainVisual(id)` во
  // ВСЕХ местах UI учитывать пользовательскую палитру, без рефактора
  // каждого call-site'а.
  const { data: domainsForVisuals } = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.domains.list(),
  })
  useEffect(() => {
    if (domainsForVisuals) {
      registerUserDomainVisuals(
        domainsForVisuals.map((d) => ({
          id: d.id,
          icon: (d as { icon?: string | null }).icon ?? null,
          color: (d as { color?: string | null }).color ?? null,
        })),
      )
    }
  }, [domainsForVisuals])

  return (
    <div className="flex h-full">
      {/* VS Code-style activity bar: узкая иконочная панель слева. На
          landing-странице её не показываем — landing это «маркетинговый»
          fullscreen-hero. Названия разделов всплывают в тултипах справа
          от иконки + дублируются в шапке каждого экрана. */}
      {!isLanding && <SideRail />}

      {/* Landing — это длинная single-page страница, она ДОЛЖНА скроллиться
          вертикально. Внутренние экраны (Регламенты, Студия, Flow Editor)
          управляют скроллом сами и хотят `overflow-hidden` чтобы не было
          двойного скролл-бара. Поэтому overflow main зависит от маршрута. */}
      <main
        className={cn(
          'min-h-0 min-w-0 flex-1',
          isLanding ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingScreen />} />
            <Route path="/regulations" element={<RegulationList />} />
            <Route path="/regulations/new-from-text" element={<RegulationExtractScreen />} />
            <Route path="/regulations/:id/edit" element={<RegulationEditorScreen />} />
            <Route path="/regulations/:id/flow" element={<FlowEditorScreen />} />
            <Route path="/regulations/:id/constraints" element={<ConstraintEditorScreen />} />
            <Route path="/sensors" element={<SensorLibraryScreen />} />
            <Route path="/modules" element={<ModuleLibraryScreen />} />
            <Route path="/audit-log" element={<AuditLogScreen />} />
            <Route path="/execute" element={<ExecuteScreen />} />
            <Route path="/graph" element={<GraphView />} />
            <Route path="/domains/:id" element={<DomainDetailScreen />} />
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
        </Suspense>
      </main>
    </div>
  )
}
