import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Edge, Node } from 'reactflow'
import {
  CheckCircle2,
  GitCommitVertical,
  History,
  Network,
  Play,
  Save,
  Shield,
  Sliders,
  XCircle,
} from 'lucide-react'
import { api, type ExecutionResult, type FlowNode, type RuleDSL } from '@/lib/api'
import { dslToFlow, flowToDsl } from '@/lib/rulesDsl'
import { useFlowStore } from '@/store/flowStore'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { RegulationHeader } from '../regulations/RegulationHeader'
import { ExecutePanel } from './ExecutePanel'
import { FlowCanvas } from './FlowCanvas'
import { NodePalette } from './NodePalette'
import { PropertyPanel } from './PropertyPanel'

// Маркер «подсветки сработавшего пути» (см. highlightedEdges ниже): наша
// конкретная заливка ребра. Используем, чтобы отличить НАШУ подсветку от
// animated:true, которое dslToFlow ставит на ребрах с condition.
const FIRED_EDGE_STROKE = 'rgb(16, 185, 129)'

export function FlowEditorScreen() {
  const { id = '' } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
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
  // Храним только id выбранного узла, не сам объект. Иначе PropertyPanel
  // получает stale-снимок node.data и поля не обновляются, когда мы
  // патчим nodes через updateNodeData — pull всегда из актуального nodes[].
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo<Node | null>(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [nodes, selectedId],
  )
  const [showHistory, setShowHistory] = useState(false)
  // ?run=1 в URL открывает ExecutePanel автоматически. Используется из
  // /execute (ExecuteScreen) — пользователь жмёт «Симулировать», попадает
  // сразу в режим симуляции. После открытия параметр чистим, чтобы
  // refresh страницы не залипал в этом состоянии навсегда.
  const [showExecute, setShowExecute] = useState(() => searchParams.get('run') === '1')
  useEffect(() => {
    if (searchParams.get('run') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('run')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  // Результат последнего Execute — используется для подсветки сработавших
  // узлов/рёбер на канвасе. Очищается «Очистить значения и подсветку» в панели.
  const [executeResult, setExecuteResult] = useState<ExecutionResult | null>(null)

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

  // Подсветка сработавшего пути после Execute. Применяется через className
  // на wrapper'е react-flow__node (см. .react-flow__node.flow-fired в styles.css)
  // + animated/stroke на edges. Сброс — кнопкой «Очистить» в ExecutePanel.
  const firedNodes = useMemo(() => new Set(executeResult?.fired_nodes ?? []), [executeResult])
  const firedEdges = useMemo(() => new Set(executeResult?.fired_edges ?? []), [executeResult])
  const highlightedNodes = useMemo<Node[]>(
    () => nodes.map((n) => (firedNodes.has(n.id) ? { ...n, className: 'flow-fired' } : n)),
    [nodes, firedNodes],
  )
  const highlightedEdges = useMemo<Edge[]>(
    () => edges.map((e) => (
      firedEdges.has(e.id) || firedEdges.has(`${e.source}__${e.target}`)
        ? { ...e, animated: true, style: { stroke: FIRED_EDGE_STROKE, strokeWidth: 2 } }
        : e
    )),
    [edges, firedEdges],
  )

  const updateNodeData = (nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data as FlowNode), ...patch } } : n)),
    )
  }

  const deleteNode = (nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedId(null)
  }

  const validating = validateMutation.isPending
  const saving = saveMutation.isPending

  // Несохранённые правки = текущий currentDsl отличается от загруженного.
  // Сериализуем оба в JSON и сравниваем — самый прямой способ; nodes/edges
  // нормализованы (см. flowToDsl). Тот же паттерн, что в RegulationEditorScreen.
  const dirty = useMemo(() => {
    if (!dsl) return false
    return JSON.stringify(dsl) !== JSON.stringify(currentDsl)
  }, [dsl, currentDsl])

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
        disabled={!dirty || saving}
        onClick={() => {
          clearErrors()
          saveMutation.mutate(currentDsl)
        }}
      >
        {saving ? 'Сохраняю…' : 'Сохранить'}
      </Button>
      <Button
        size="sm"
        variant={showExecute ? 'secondary' : 'ghost'}
        icon={<Play size={13} className="text-emerald-600" />}
        onClick={() => {
          setShowExecute((x) => !x)
          // Взаимно-исключающие правые панели: открыли Run — закрыли History.
          if (!showExecute) setShowHistory(false)
        }}
        aria-pressed={showExecute}
        className={cn(showExecute && 'border-emerald-300 bg-emerald-50 text-emerald-800')}
      >
        Запуск
      </Button>
      <Button
        size="sm"
        variant={showHistory ? 'secondary' : 'ghost'}
        icon={<History size={13} />}
        onClick={() => {
          setShowHistory((x) => !x)
          if (!showHistory) setShowExecute(false)
        }}
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
            nodes={highlightedNodes}
            edges={highlightedEdges}
            onChange={({ nodes, edges }) => {
              setNodes(stripHighlight(nodes))
              setEdges(stripHighlight(edges))
            }}
            onSelect={(n) => setSelectedId(n?.id ?? null)}
          />
        </div>
        {showHistory ? (
          <HistoryPanel regulationId={id} />
        ) : showExecute ? (
          <ExecutePanel
            regulationId={id}
            currentDsl={currentDsl}
            nodes={nodes as Node<FlowNode>[]}
            onResult={setExecuteResult}
          />
        ) : (
          <PropertyPanel
            node={selected}
            parameters={regulation?.parameters ?? []}
            allNodes={nodes as Node<FlowNode>[]}
            regulationId={id}
            constraints={regulation?.constraints ?? []}
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

// Снять только наши декорации подсветки, не трогая прочие user-properties.
// Без этого reactflow возвращает в onChange ноды/рёбра с зашитой подсветкой
// и она не сбросится при «Очистить» в ExecutePanel.
function stripHighlight<T extends Node | Edge>(items: T[]): T[] {
  return items.map((item) => {
    const asNode = item as Node
    if (asNode.className === 'flow-fired') {
      return { ...asNode, className: undefined } as unknown as T
    }
    const asEdge = item as Edge
    if (asEdge.style && (asEdge.style as { stroke?: string }).stroke === FIRED_EDGE_STROKE) {
      const { animated: _a, style: _s, ...rest } = asEdge
      return rest as unknown as T
    }
    return item
  })
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
