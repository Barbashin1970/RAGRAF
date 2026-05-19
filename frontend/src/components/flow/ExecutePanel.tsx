import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Info, Play, Radar, Sparkles } from 'lucide-react'
import type { Node } from 'reactflow'
import {
  api,
  SENSOR_TYPE_META,
  type ExecutionResult,
  type FlowNode,
  type RuleDSL,
  type SensorReading,
  type SensorType,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'

interface Props {
  regulationId: string
  /** Текущий live-draft DSL (нодоиды совпадают с canvas'ом). */
  currentDsl: RuleDSL
  /** Ноды canvas'а — берём из них sensor-ы и input'ы (если sensor'ов ещё нет). */
  nodes: Node<FlowNode>[]
  /** Колбэк: подсветить результирующий путь на канвасе. */
  onResult: (result: ExecutionResult | null) => void
}

/**
 * Боковая панель «Запуск» (Execute) — симулятор regulation'а.
 *
 * Идея: аналитик собирает поток (sensor → input → threshold → output), затем
 * жмёт «Запустить». Бэк зовёт flow_executor, возвращает вердикт + список
 * сработавших узлов и рёбер. UI красит canvas (через onResult в родителе) и
 * показывает level + recommendation + trace.
 *
 * Двойное назначение этого же endpoint'а — боевой режим для СИГМЫ: ETL шлёт
 * readings, RAGRAF отдаёт {level, recommendation}. В UI это просто кнопка
 * проверки до публикации.
 */
export function ExecutePanel({ regulationId, currentDsl, nodes, onResult }: Props) {
  // Source-of-truth для значений — id sensor-ноды (или input-ноды если sensor
  // ещё не нарисовали). Это позволяет менять value независимо для каждого
  // канала без перепаха DSL'а.
  const [values, setValues] = useState<Record<string, string>>({})
  const [scenarioPreset, setScenarioPreset] = useState<string>('')

  const { sensorNodes, fallbackInputs } = useMemo(() => {
    const sensors = nodes.filter((n) => (n.data?.type ?? n.type) === 'sensor')
    const inputs = nodes.filter((n) => (n.data?.type ?? n.type) === 'input')
    return { sensorNodes: sensors, fallbackInputs: inputs }
  }, [nodes])

  // Если есть sensor-ноды — собираем readings по ним. Если их нет (старые
  // регламенты без sensor-нод), позволяем «прямой» вброс по param_id.
  const channels = useMemo(() => {
    if (sensorNodes.length > 0) {
      return sensorNodes.map((n) => {
        const d = n.data ?? ({} as FlowNode)
        return {
          key: n.id,
          kind: 'sensor' as const,
          sensorType: d.sensorType ?? null,
          label: d.label || (d.externalId ? `${d.sensorType ?? 'sensor'} · ${d.externalId}` : `sensor ${n.id.slice(0, 6)}`),
          bindsTo: d.bindsTo ?? null,
          externalId: d.externalId ?? null,
        }
      })
    }
    return fallbackInputs.map((n) => {
      const d = n.data ?? ({} as FlowNode)
      return {
        key: n.id,
        kind: 'input' as const,
        sensorType: null,
        label: d.paramRef ? `вход: ${d.paramRef}` : `вход ${n.id.slice(0, 6)}`,
        paramRef: d.paramRef ?? null,
      }
    })
  }, [sensorNodes, fallbackInputs])

  const exec = useMutation({
    mutationFn: async (): Promise<ExecutionResult> => {
      const readings: SensorReading[] = []
      for (const c of channels) {
        const raw = values[c.key]
        if (raw === undefined || raw === '') continue
        const value = Number(raw)
        if (Number.isNaN(value)) continue
        if (c.kind === 'sensor') {
          readings.push({ value, sensor_id: c.key })
        } else {
          const paramRef = (c as { paramRef: string | null }).paramRef
          if (paramRef) readings.push({ value, param_id: paramRef })
        }
      }
      return api.flow.execute(regulationId, { dsl: currentDsl, readings })
    },
    onSuccess: (r) => onResult(r),
  })

  const result = exec.data

  const applyPreset = (preset: 'norm' | 'warning' | 'critical') => {
    setScenarioPreset(preset)
    const next: Record<string, string> = {}
    for (const c of channels) {
      // Догадки для preset'ов по sensor-type. Не идеально, но даёт быстрый
      // прогон без копания в значениях. Аналитик правит точечно.
      const stype = c.sensorType
      // Эвристические пресеты по типам датчиков. Давление в атм., температура
      // в °C, расход в м³/ч — порядки взяты из типичных теплосетевых сценариев.
      // Для fiber/detector «значение» = confidence ML-классификатора (0..1).
      // Для air — концентрация CO2 в ppm (норма ~400, ПДК помещения 1000).
      if (preset === 'norm') {
        if (stype === 'p') next[c.key] = '20.5'
        else if (stype === 't') next[c.key] = '20'
        else if (stype === 'flow') next[c.key] = '10'
        else if (stype === 'fiber' || stype === 'detector') next[c.key] = '0.3'
        else if (stype === 'air') next[c.key] = '400'
        else next[c.key] = '1'
      } else if (preset === 'warning') {
        if (stype === 'p') next[c.key] = '23'
        else if (stype === 't') next[c.key] = '40'
        else if (stype === 'flow') next[c.key] = '25'
        else if (stype === 'fiber' || stype === 'detector') next[c.key] = '0.75'
        else if (stype === 'air') next[c.key] = '1200'
        else next[c.key] = '5'
      } else {
        if (stype === 'p') next[c.key] = '50'
        else if (stype === 't') next[c.key] = '100'
        else if (stype === 'flow') next[c.key] = '80'
        else if (stype === 'fiber' || stype === 'detector') next[c.key] = '0.95'
        else if (stype === 'air') next[c.key] = '5000'
        else next[c.key] = '10'
      }
    }
    setValues(next)
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-stone-200 bg-white text-sm">
      <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
        <Radar size={14} className="text-orange-600" />
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-700">
          Исполнение регламента
        </div>
      </div>

      <div className="border-b border-stone-100 bg-stone-50 px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-500">Сценарий</div>
        <div className="flex flex-wrap gap-1">
          <PresetChip active={scenarioPreset === 'norm'}    onClick={() => applyPreset('norm')}    label="Норма"    tone="emerald" />
          <PresetChip active={scenarioPreset === 'warning'} onClick={() => applyPreset('warning')} label="Внимание" tone="amber" />
          <PresetChip active={scenarioPreset === 'critical'} onClick={() => applyPreset('critical')} label="Критика" tone="rose" />
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        {channels.length === 0 && (
          <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs text-stone-500">
            На канвасе нет ни событий, ни input-узлов — добавьте «Событие» из палитры слева
            и привяжите его к input-ноде.
          </div>
        )}
        {channels.map((c) => {
          const stype = c.sensorType
          const meta = stype ? SENSOR_TYPE_META[stype] : null
          return (
            <label key={c.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs text-stone-600">{c.label}</span>
                {meta && (
                  <span className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                    meta.bg, meta.fg,
                  )}>
                    {meta.short}
                  </span>
                )}
              </div>
              <input
                type="number"
                step="any"
                placeholder={meta ? meta.label : 'значение'}
                value={values[c.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
                className="rounded border border-stone-200 px-2 py-1 text-sm font-mono tabular-nums"
              />
            </label>
          )
        })}
      </div>

      <div className="border-t border-stone-100 px-3 py-2">
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={13} />}
          onClick={() => exec.mutate()}
          loading={exec.isPending}
          disabled={channels.length === 0}
          className="w-full justify-center"
        >
          {exec.isPending ? 'Запуск…' : 'Запустить'}
        </Button>
        {channels.length > 0 && (
          <button
            className="mt-1 w-full text-[11px] text-stone-500 hover:text-stone-700"
            onClick={() => {
              setValues({})
              setScenarioPreset('')
              onResult(null)
              exec.reset()
            }}
          >
            Очистить значения и подсветку
          </button>
        )}
      </div>

      {exec.error && (
        <div className="m-3 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {String(exec.error)}
        </div>
      )}

      {result && <ResultCard result={result} />}
    </aside>
  )
}


function PresetChip({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean
  label: string
  tone: 'emerald' | 'amber' | 'rose'
  onClick: () => void
}) {
  // Цветовая шкала повторяет уровни критичности executor'а: норма=emerald,
  // внимание=amber, критика=rose. Совпадает с верстальной палитрой
  // ResultCard, чтобы преcет и результат «звучали одинаково».
  const inactiveCls = {
    emerald: 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50',
    amber:   'border-amber-200 bg-white text-amber-800 hover:bg-amber-50',
    rose:    'border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
  }[tone]
  const activeCls = {
    emerald: 'border-emerald-400 bg-emerald-100 text-emerald-900 font-semibold',
    amber:   'border-amber-400 bg-amber-100 text-amber-900 font-semibold',
    rose:    'border-rose-400 bg-rose-100 text-rose-900 font-semibold',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-[11px] transition',
        active ? activeCls : inactiveCls,
      )}
    >
      {label}
    </button>
  )
}


function ResultCard({ result }: { result: ExecutionResult }) {
  const tone =
    result.level === 0 ? { bg: 'bg-emerald-50', border: 'border-emerald-200', fg: 'text-emerald-800', label: 'Норма', Icon: CheckCircle2 } :
    result.level === 1 ? { bg: 'bg-amber-50',   border: 'border-amber-200',   fg: 'text-amber-800',   label: 'Обычный',  Icon: Info } :
    result.level === 2 ? { bg: 'bg-orange-50',  border: 'border-orange-200',  fg: 'text-orange-800',  label: 'Важный',   Icon: AlertTriangle } :
                         { bg: 'bg-rose-50',    border: 'border-rose-200',    fg: 'text-rose-800',    label: 'Критический', Icon: AlertTriangle }
  const Icon = tone.Icon

  return (
    <div className="m-3 flex flex-col gap-2">
      <div className={cn('rounded-md border p-2', tone.bg, tone.border)}>
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold', tone.fg)}>
          <Icon size={13} />
          <span>Уровень {result.level} · {tone.label}</span>
        </div>
        {result.recommendation && (
          <div className="mt-1 whitespace-pre-line text-xs text-stone-700">
            {result.recommendation}
          </div>
        )}
      </div>

      <div className="rounded-md border border-stone-200 p-2">
        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-500">
          <Sparkles size={11} />
          Шаги исполнения
        </div>
        <ol className="space-y-1 text-[11px] leading-snug text-stone-700">
          {result.trace.map((t, i) => (
            <li key={`${t.node_id}-${i}`} className={cn(
              'rounded px-1.5 py-1',
              t.fired ? 'bg-emerald-50' : 'bg-stone-50 text-stone-500',
            )}>
              <span className="mr-1 font-mono text-[10px] text-stone-500">{t.node_type}</span>
              <span className="font-mono text-[10px]">{t.node_id}</span>
              {t.explanation && <span> — {t.explanation}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
