import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  FileSearch,
  Layers,
  Loader2,
  type LucideIcon,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { api, type DocumentAnalysisResult, type UserDocument } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Badge, Button } from '@/components/ui'
import { CreateDomainDialog } from '@/components/regulations/CreateDomainDialog'

/**
 * Cross-corpus анализ документа против корпуса регламентов.
 *
 * NotebookLM-style «Briefing doc»: единый отчёт с тремя секциями:
 *   1. Картина по доменам (spectrum bar chart)
 *   2. LLM summary (4-6 предложений с цитированием)
 *   3. Релевантные регламенты, сгруппированные по доменам, с прямыми ссылками
 *
 * Алгоритм на бэке (см. `document_analysis.py`): bge-m3 retrieve top-3 для
 * каждого chunk, агрегация по регламентам и доменам, LLM-summary через qwen2.5.
 * Время: 5 сек retrieval + 10-30 сек LLM.
 */

const DOMAIN_LABELS: Record<string, string> = {
  heating: 'Теплоснабжение',
  housing: 'ЖКХ',
  safety: 'Безопасность',
  environment: 'Экология',
  unknown: 'Без домена',
}

const DOMAIN_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  heating: { bg: 'bg-orange-50', text: 'text-orange-800', bar: 'bg-orange-400' },
  housing: { bg: 'bg-blue-50', text: 'text-blue-800', bar: 'bg-blue-400' },
  safety: { bg: 'bg-rose-50', text: 'text-rose-800', bar: 'bg-rose-400' },
  environment: { bg: 'bg-emerald-50', text: 'text-emerald-800', bar: 'bg-emerald-400' },
  unknown: { bg: 'bg-stone-100', text: 'text-stone-700', bar: 'bg-stone-400' },
}

interface Props {
  doc: UserDocument
  onClose: () => void
}

export function DocumentAnalysisModal({ doc, onClose }: Props) {
  const [autoTriggered, setAutoTriggered] = useState(false)
  const [showCreateDomain, setShowCreateDomain] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const analyze = useMutation({
    mutationFn: () => api.sandbox.analyzeDocument(doc.doc_id),
  })

  // Префилл для CreateDomainDialog: имя файла без расширения как кандидат
  // на label, чтобы аналитик не печатал с нуля.
  const filenameStem = doc.filename.replace(/\.[a-z0-9]+$/i, '').trim()

  // Авто-запуск при открытии (один раз)
  useEffect(() => {
    if (!autoTriggered) {
      setAutoTriggered(true)
      analyze.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTriggered])

  // Escape закрывает
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-stone-200 bg-stone-50/60 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-100 text-violet-700">
              <FileSearch size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                Анализ документа
              </div>
              <div className="truncate text-sm font-semibold text-stone-800" title={doc.filename}>
                {doc.filename}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {analyze.isPending && <AnalyzingPlaceholder />}
          {analyze.isError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Не удалось проанализировать документ:{' '}
              <span className="font-mono text-xs">{(analyze.error as Error).message}</span>
            </div>
          )}
          {analyze.data && (
            <AnalysisReport
              data={analyze.data}
              doc={doc}
              onBootstrap={() => setShowCreateDomain(true)}
            />
          )}
        </div>

        <CreateDomainDialog
          open={showCreateDomain}
          onClose={() => setShowCreateDomain(false)}
          initialLabel={filenameStem}
          initialHint={`Создан из документа «${doc.filename}»`}
          onCreated={(d) => {
            qc.invalidateQueries({ queryKey: ['domains'] })
            // Закрываем модалку анализа и ведём на /regulations с подсветкой
            // нового домена. UX: следующий шаг — нажать «Создать регламент»
            // в нём, либо использовать «Извлечь параметры» из песочницы.
            onClose()
            navigate(`/regulations?domain=${encodeURIComponent(d.id)}`)
          }}
        />

        <footer className="flex items-center justify-between border-t border-stone-200 bg-stone-50/60 px-5 py-3">
          <div className="text-[11px] text-stone-500">
            {analyze.data && (
              <>
                <Layers size={11} className="-mt-0.5 mr-1 inline" />
                {analyze.data.stats.chunks_analyzed} фрагментов ·{' '}
                {analyze.data.stats.regulations_matched} регламентов ·{' '}
                {analyze.data.stats.avg_hits_per_chunk} ср. совпадений на фрагмент
              </>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </footer>
      </div>
    </div>
  )
}

function AnalyzingPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 size={28} className="animate-spin text-violet-600" />
      <div className="text-sm font-medium text-stone-700">Анализирую документ…</div>
      <div className="max-w-md text-xs leading-relaxed text-stone-500">
        Прохожу по фрагментам, ищу совпадения с корпусом регламентов через bge-m3,
        строю LLM-summary через qwen2.5. Обычно 15–30 секунд.
      </div>
    </div>
  )
}

function AnalysisReport({
  data,
  doc,
  onBootstrap,
}: {
  data: DocumentAnalysisResult
  doc: UserDocument
  onBootstrap: () => void
}) {
  // Max total_hits для нормализации bar chart
  const maxHits = useMemo(
    () => Math.max(...data.domain_spectrum.map((d) => d.total_hits), 1),
    [data.domain_spectrum],
  )

  // LLM-summary тяжёлая (qwen2.5:7b ~60 сек на M2 Air + swap-thrashing), поэтому
  // не вызываем её автоматически. Кнопка показывается только если на бэке LLM
  // вообще доступна (`summary_llm_available=true`).
  const llmSummary = useMutation({
    mutationFn: () => api.sandbox.analyzeDocumentSummary(doc.doc_id),
  })

  return (
    <div className="space-y-6">
      <SectionTitle icon={BarChart3} label="Картина по доменам" />
      {data.domain_spectrum.length === 0 ? (
        <EmptyAnswer onBootstrap={onBootstrap} />
      ) : (
        <div className="space-y-1.5">
          {data.domain_spectrum.map((d) => {
            const meta = DOMAIN_COLORS[d.domain] ?? DOMAIN_COLORS.unknown
            const widthPct = (d.total_hits / maxHits) * 100
            return (
              <div key={d.domain} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={cn('font-medium', meta.text)}>
                    {DOMAIN_LABELS[d.domain] ?? d.domain}
                  </span>
                  <span className="font-mono text-stone-500">
                    {d.regulation_count} регл. · {d.total_hits} совпад.
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={cn('h-full rounded-full transition-all', meta.bar)}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(data.summary || llmSummary.data) && (
        <>
          <SectionTitle icon={Sparkles} label="Краткий анализ" />
          <div className="whitespace-pre-line rounded-md border border-violet-100 bg-violet-50/40 px-4 py-3 text-sm leading-relaxed text-stone-700">
            {llmSummary.data?.summary || data.summary}
          </div>
          {data.summary_llm_available && !llmSummary.data && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-3 text-xs">
              <span className="text-stone-600">
                Это структурированный отчёт. LLM-анализ (qwen2.5:7b) даёт связный
                абзац с пояснением связей, но занимает <b>60-120 сек</b> на M2 Air
                и грузит память.
              </span>
              <Button
                variant="secondary"
                size="sm"
                icon={llmSummary.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                onClick={() => llmSummary.mutate()}
                disabled={llmSummary.isPending}
              >
                {llmSummary.isPending ? 'Генерирую…' : 'Сгенерировать LLM-анализ'}
              </Button>
              {llmSummary.isError && (
                <span className="text-rose-700">
                  Ошибка: {(llmSummary.error as Error).message}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {data.regulations.length > 0 && (
        <>
          <SectionTitle
            icon={Layers}
            label={`Релевантные регламенты (${data.regulations.length})`}
          />
          <div className="space-y-2">
            {data.regulations.map((r) => (
              <RegulationCard key={r.regulation_id} reg={r} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EmptyAnswer({ onBootstrap }: { onBootstrap: () => void }) {
  // Это не «провал поиска» — это сигнал что мы попали на тему, которой пока
  // нет в корпусе. UX-стратегия: предложить bootstrap нового домена прямо
  // отсюда, чтобы аналитик не уходил на отдельную страницу за CRUD'ом.
  return (
    <div className="rounded-md border border-dashed border-violet-200 bg-violet-50/40 px-4 py-6 text-center">
      <Wand2 size={28} className="mx-auto text-violet-400" />
      <div className="mt-2 text-sm font-semibold text-stone-800">
        Документ открывает новую тему для корпуса
      </div>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-stone-600">
        Регламентов по этим темам пока нет — это типичная ситуация при оцифровке
        нового направления. Заведите домен и начните заполнять его регламентами,
        извлекая параметры прямо из этого документа.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" size="sm" icon={<Boxes size={13} />} onClick={onBootstrap}>
          Создать новый домен
        </Button>
        <Link to="/sandbox?tab=extract" className="inline-flex">
          <Button variant="secondary" size="sm" icon={<Wand2 size={13} />}>
            Извлечь параметры
          </Button>
        </Link>
      </div>
    </div>
  )
}

function RegulationCard({ reg }: { reg: DocumentAnalysisResult['regulations'][number] }) {
  const meta = DOMAIN_COLORS[reg.domain] ?? DOMAIN_COLORS.unknown
  const domainLabel = DOMAIN_LABELS[reg.domain] ?? reg.domain
  return (
    <article
      className={cn(
        'flex items-stretch overflow-hidden rounded-md border border-stone-200 bg-white transition hover:border-violet-300 hover:shadow-sm',
      )}
    >
      <div className={cn('w-1 shrink-0', meta.bar)} />
      <div className="min-w-0 flex-1 p-3">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <Link
            to={`/regulations/${reg.regulation_id}/edit`}
            className="font-medium leading-snug text-stone-900 transition hover:text-primary"
          >
            {reg.name}
          </Link>
          <Badge tone="info">{domainLabel}</Badge>
          <Badge tone="neutral">
            {reg.hits} совпад. · max {reg.max_score.toFixed(2)}
          </Badge>
        </div>
        {reg.chunk_examples.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-stone-500 hover:text-stone-700">
              Совпавшие фрагменты документа ({reg.chunk_examples.length})
            </summary>
            <div className="mt-2 space-y-1">
              {reg.chunk_examples.map((ex, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-stone-200 pl-2 text-[11px] italic leading-relaxed text-stone-600"
                >
                  «{ex}…»
                </blockquote>
              ))}
            </div>
          </details>
        )}
      </div>
      <Link
        to={`/regulations/${reg.regulation_id}/edit`}
        className="flex items-center px-3 text-stone-400 transition hover:bg-stone-50 hover:text-primary"
        title="Открыть в редакторе"
      >
        <ArrowRight size={16} />
      </Link>
    </article>
  )
}

function SectionTitle({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-stone-100 pb-1.5">
      <Icon size={14} className="text-stone-500" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-700">
        {label}
      </h3>
    </div>
  )
}
