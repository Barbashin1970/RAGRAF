import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Edge, Node } from 'reactflow'
import {
  CheckCircle2,
  GitCommitVertical,
  History,
  Network,
  Save,
  Shield,
  Sliders,
  XCircle,
} from 'lucide-react'
import { api, type FlowNode, type RuleDSL } from '@/lib/api'
import { dslToFlow, flowToDsl } from '@/lib/rulesDsl'
import { useFlowStore } from '@/store/flowStore'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { RegulationHeader } from '../regulations/RegulationHeader'
import { FlowCanvas } from './FlowCanvas'
import { NodePalette } from './NodePalette'
import { PropertyPanel } from './PropertyPanel'

export function FlowEditorScreen() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const setErrors = useFlowStore((s) => s.setErrors)
  const clearErrors = useFlowStore((s) => s.clearErrors)
  const globalErrors = useFlowStore((s) => s.globalErrors)

  const dslKey = ['flow', id] as const
  const regKey = ['regulation', id] as const

  const { data: dsl, isLoading } = useQuery({ queryKey: dslKey, queryFn: () => api.flow.get(id), enabled: !!id })
  const { data: regulation } = useQuery({ queryKey: regKey, queryFn: () => api.regulations.get(id), enabled: !!id })

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selected, setSelected] = useState<Node | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  useEffect(() => {
    if (!dsl) return
    const flow = dslToFlow(dsl)
    setNodes(flow.nodes)
    setEdges(flow.edges)
  }, [dsl])

  // Autosave draft to localStorage every 30s. See § Data Flow Diagrams.
  useEffect(() => {
    if (!id) return
    const key = `ragraf:flow-draft:${id}`
    const t = setInterval(() => {
      const draft = flowToDsl({ rule_id: dsl?.rule_id ?? `rule_${id}`, regulation_id: id }, nodes, edges)
      localStorage.setItem(key, JSON.stringify(draft))
    }, 30_000)
    return () => clearInterval(t)
  }, [id, nodes, edges, dsl?.rule_id])

  const saveMutation = useMutation({
    mutationFn: (next: RuleDSL) => api.flow.save(id, next),
    onSuccess: () => {
      // На бэке save_flow синхронизирует регламент: derive_params_from_flow
      // выводит параметры из input-нод и обновляет DuckDB. Инвалидируем оба
      // запроса, чтобы Form Editor / списки увидели актуальные параметры.
      qc.invalidateQueries({ queryKey: dslKey })
      qc.invalidateQueries({ queryKey: regKey })
      qc.invalidateQueries({ queryKey: ['datasets'] })
      qc.invalidateQueries({ queryKey: ['regulation-history', id] })
    },
  })

  const validateMutation = useMutation({
    mutationFn: (next: RuleDSL) => api.flow.validate(id, next),
    onSuccess: (r) => setErrors(r.errors),
  })

  const currentDsl = useMemo<RuleDSL>(
    () => flowToDsl({ rule_id: dsl?.rule_id ?? `rule_${id}`, regulation_id: id }, nodes, edges),
    [dsl?.rule_id, id, nodes, edges],
  )

  const updateNodeData = (nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as FlowNode), ...patch } } : n)),
    )
  }

  const deleteNode = (nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelected(null)
  }

  const validating = validateMutation.isPending
  const saving = saveMutation.isPending

  const actions = (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<CheckCircle2 size={13} className="text-amber-600" />}
        onClick={() => validateMutation.mutate(currentDsl)}
        loading={validating}
      >
        {validating ? 'Проверка…' : 'Проверить'}
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon={<Save size={13} />}
        loading={saving}
        onClick={() => {
          clearErrors()
          saveMutation.mutate(currentDsl)
        }}
      >
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </Button>
      <Button
        size="sm"
        variant={showHistory ? 'secondary' : 'ghost'}
        icon={<History size={13} />}
        onClick={() => setShowHistory((x) => !x)}
        aria-pressed={showHistory}
        className={cn(showHistory && 'border-stone-300 bg-stone-100 text-stone-800')}
      >
        История
      </Button>
    </>
  )

  const stats = [
    { icon: Sliders,           value: regulation?.parameters.length ?? 0, label: 'параметров' },
    { icon: Network,           value: nodes.length,                       label: 'узлов'      },
    { icon: GitCommitVertical, value: edges.length,                       label: 'связей'     },
    { icon: Shield,            value: regulation?.constraints.length ?? 0, label: 'ограничений' },
  ]

  const subHeader = globalErrors.length > 0 ? (
    <div className="border-t border-rose-200 bg-rose-50 px-5 py-1.5 text-xs text-rose-700">
      <XCircle size={12} className="-mt-0.5 mr-1 inline" />
      {globalErrors.map((e) => `${e.code}: ${e.message}`).join(' · ')}
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <RegulationHeader
        regulation={regulation}
        isLoading={isLoading}
        sourceId={id}
        active="flow"
        stats={stats}
        actions={actions}
        subHeader={subHeader}
      />

      <div className="flex min-h-0 flex-1">
        <NodePalette />
        <div className="relative min-h-0 flex-1">
          {isLoading && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/60 text-sm text-stone-500">
              Загрузка потока…
            </div>
          )}
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onChange={({ nodes, edges }) => {
              setNodes(nodes)
              setEdges(edges)
            }}
            onSelect={setSelected}
          />
        </div>
        {showHistory ? (
          <HistoryPanel regulationId={id} />
        ) : (
          <PropertyPanel
            node={selected}
            parameters={regulation?.parameters ?? []}
            onChange={updateNodeData}
            onDelete={deleteNode}
            collapsed={panelCollapsed}
            onToggleCollapsed={() => setPanelCollapsed((x) => !x)}
          />
        )}
      </div>
    </div>
  )
}

function HistoryPanel({ regulationId }: { regulationId: string }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['flow-history', regulationId],
    queryFn: () => api.flow.history(regulationId),
  })
  const restore = useMutation({
    mutationFn: (vid: string) => api.flow.restore(regulationId, vid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flow', regulationId] }),
  })

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-3 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-stone-500">История версий</div>
      {isLoading && <div className="text-stone-500">Загрузка…</div>}
      {(data ?? []).map((v) => (
        <div key={v.version_id} className="mb-1 rounded-md border border-stone-200 p-2">
          <div className="font-mono text-[10px] text-stone-500">{v.version_id.slice(0, 8)}</div>
          <div className="text-xs text-stone-700">{new Date(v.created_at).toLocaleString('ru-RU')}</div>
          {v.comment && <div className="text-xs text-stone-500">{v.comment}</div>}
          <button
            onClick={() => restore.mutate(v.version_id)}
            className="mt-1 rounded-md border border-stone-200 px-2 py-0.5 text-[10px] hover:bg-surface-offset"
          >
            Восстановить
          </button>
        </div>
      ))}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="text-stone-400">Сохранения пока не было.</div>
      )}
    </aside>
  )
}
