import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { registerUserDomainVisuals } from '@/lib/domains'
import { GraphView } from '@/components/graph/GraphView'
import { TwinDesignerScreen } from '@/components/twins/TwinDesignerScreen'
import { LandingScreen } from '@/components/landing/LandingScreen'
import { RegulationList } from '@/components/regulations/RegulationList'
import { RegulationEditorScreen } from '@/components/regulations/RegulationEditorScreen'
import { FlowEditorScreen } from '@/components/flow/FlowEditorScreen'
import { ConstraintEditorScreen } from '@/components/constraints/ConstraintEditorScreen'
import { SandboxScreen } from '@/components/sandbox/SandboxScreen'
import { SandboxBacklog } from '@/components/sandbox/SandboxBacklog'
import { SensorLibraryScreen } from '@/components/sensors/SensorLibraryScreen'
import { ModuleLibraryScreen } from '@/components/modules/ModuleLibraryScreen'
import { AuditLogScreen } from '@/components/audit/AuditLogScreen'
import { ExecuteScreen } from '@/components/execute/ExecuteScreen'
import { RegulationExtractScreen } from '@/components/regulations/RegulationExtractScreen'
import { DomainDetailScreen } from '@/components/domains/DomainDetailScreen'
import { SideRail } from '@/components/layout/SideRail'
import { cn } from '@/lib/cn'

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
      </main>
    </div>
  )
}
