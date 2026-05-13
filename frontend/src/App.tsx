import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, GitBranch, ListTree, Shield } from 'lucide-react'
import { GraphView } from '@/components/graph/GraphView'
import { RegulationList } from '@/components/regulations/RegulationList'
import { FlowEditorScreen } from '@/components/flow/FlowEditorScreen'
import { ConstraintEditorScreen } from '@/components/constraints/ConstraintEditorScreen'
import { cn } from '@/lib/cn'

function NavLink({ to, icon: Icon, label }: { to: string; icon: typeof Activity; label: string }) {
  const { pathname } = useLocation()
  const active = pathname === to || (to !== '/' && pathname.startsWith(to))
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
        active
          ? 'bg-primary text-white'
          : 'text-stone-700 hover:bg-surface-offset',
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  )
}

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2">
        <div className="mr-2 text-lg font-semibold text-primary">RAGRAF</div>
        <nav className="flex gap-1">
          <NavLink to="/regulations" icon={ListTree} label="Регламенты" />
          <NavLink to="/graph" icon={Activity} label="Граф" />
        </nav>
        <div className="ml-auto text-xs text-stone-500">
          визуализатор и редактор регламентов
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/regulations" replace />} />
          <Route path="/regulations" element={<RegulationList />} />
          <Route path="/regulations/:id/flow" element={<FlowEditorScreen />} />
          <Route path="/regulations/:id/constraints" element={<ConstraintEditorScreen />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="*" element={<div className="p-6 text-stone-500">Страница не найдена</div>} />
        </Routes>
      </main>
    </div>
  )
}
