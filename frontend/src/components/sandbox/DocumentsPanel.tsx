import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckSquare,
  FileSearch,
  FileText,
  Loader2,
  Plus,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, type UserDocument } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { DocumentAnalysisModal } from './DocumentAnalysisModal'

/**
 * NotebookLM-style панель источников: левая колонка студии аналитика.
 *
 * Сценарий аналитика:
 *  1. Перетаскивает PDF / DOCX (или жмёт «+ Источник»);
 *  2. Документ векторизуется (bge-m3 через Ollama), появляется в списке;
 *  3. Toggle «включить в контекст» добавляет chunks этого документа в
 *     system-prompt Q&A;
 *  4. При 2+ включённых документах показываем предупреждение про скорость
 *     (контекст растёт, qwen2.5:7b на M2 уже не быстрый).
 *
 * Лимиты — задаются сервером (см. document_store: 10 файлов × 10 МБ).
 */

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function DocumentsPanel() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [analyzeDocId, setAnalyzeDocId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['sandbox-documents'],
    queryFn: () => api.sandbox.listDocuments(),
  })

  const upload = useMutation({
    mutationFn: (file: File) => api.sandbox.uploadDocument(file),
    onSuccess: () => {
      setErrMsg(null)
      qc.invalidateQueries({ queryKey: ['sandbox-documents'] })
    },
    onError: (e: Error) => setErrMsg(e.message),
  })

  const toggle = useMutation({
    mutationFn: ({ docId, enabled }: { docId: string; enabled: boolean }) =>
      api.sandbox.toggleDocument(docId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sandbox-documents'] }),
  })

  const del = useMutation({
    mutationFn: (docId: string) => api.sandbox.deleteDocument(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sandbox-documents'] }),
  })

  const docs: UserDocument[] = data?.documents ?? []
  const limits = data?.limits
  const enabledCount = limits?.enabled_count ?? 0
  const atLimit = limits ? limits.current_count >= limits.max_documents : false

  // Предупреждение про скорость при 2+ включённых источниках.
  const showSlowWarn = enabledCount >= 2

  const onPickFile = () => fileRef.current?.click()
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) upload.mutate(f)
    e.currentTarget.value = '' // позволить повторно загрузить тот же файл
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-stone-200 bg-stone-50/60">
      {/* Шапка с counter и кнопкой загрузки */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Источники
          </div>
          <div className="text-sm font-semibold text-stone-800">
            {limits ? `${limits.current_count} / ${limits.max_documents}` : 'Загрузка…'}
          </div>
        </div>
        <Button
          variant="author"
          size="sm"
          icon={upload.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          onClick={onPickFile}
          disabled={atLimit || upload.isPending}
          title={atLimit ? 'Достигнут лимит документов' : 'Загрузить PDF или DOCX'}
        >
          Источник
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onFileChange}
        />
      </header>

      {/* Slow-response warning при 2+ включённых */}
      {showSlowWarn && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <b>{enabledCount}</b> источника включено — ответ LLM займёт больше времени.
            Контекст для qwen2.5:7b на M2: ~30 сек при 2 файлах, ~60+ сек при 3.
          </span>
        </div>
      )}

      {/* Upload error */}
      {errMsg && (
        <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {errMsg}
        </div>
      )}

      {/* Список источников */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-xs text-stone-500">
            <Loader2 size={14} className="mr-2 animate-spin" />
            Загрузка списка…
          </div>
        )}
        {!isLoading && docs.length === 0 && (
          <EmptySources onPick={onPickFile} />
        )}
        {docs.map((d) => (
          <DocumentRow
            key={d.doc_id}
            doc={d}
            onToggle={(enabled) => toggle.mutate({ docId: d.doc_id, enabled })}
            onDelete={() => del.mutate(d.doc_id)}
            onAnalyze={() => setAnalyzeDocId(d.doc_id)}
            busy={toggle.isPending || del.isPending}
          />
        ))}
      </div>

      {/* Footer: подсказка */}
      <footer className="border-t border-stone-200 bg-white px-3 py-2 text-[10px] leading-snug text-stone-500">
        <div className="flex items-start gap-1.5">
          <Upload size={11} className="mt-0.5 shrink-0 text-stone-400" />
          <span>
            PDF / DOCX до 10 МБ. Текст разрезается на фрагменты по 800 знаков и
            векторизуется через bge-m3.
          </span>
        </div>
      </footer>

      {/* Cross-corpus анализ документа против регламентов */}
      {analyzeDocId && (() => {
        const doc = docs.find((d) => d.doc_id === analyzeDocId)
        return doc ? (
          <DocumentAnalysisModal doc={doc} onClose={() => setAnalyzeDocId(null)} />
        ) : null
      })()}
    </aside>
  )
}

function EmptySources({ onPick }: { onPick: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-stone-300 bg-white p-4 text-center">
      <FileText size={28} className="mx-auto text-stone-300" />
      <div className="mt-2 text-sm font-medium text-stone-700">Нет источников</div>
      <div className="mt-1 text-[11px] leading-snug text-stone-500">
        Загрузи PDF или DOCX — нормативные акты, регламенты, инструкции — чтобы
        ИИ-ассистент мог цитировать их в ответах.
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={<Upload size={12} />}
        onClick={onPick}
        className="mt-3"
      >
        Загрузить документ
      </Button>
    </div>
  )
}

function DocumentRow({
  doc,
  onToggle,
  onDelete,
  onAnalyze,
  busy,
}: {
  doc: UserDocument
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onAnalyze: () => void
  busy: boolean
}) {
  const ext = useMemo(() => {
    const m = doc.filename.match(/\.([a-z0-9]+)$/i)
    return m ? m[1].toUpperCase() : 'DOC'
  }, [doc.filename])

  const sizeKb = (doc.size_bytes / 1024).toFixed(0)
  const Toggler = doc.enabled ? CheckSquare : Square

  return (
    <div
      className={cn(
        'group mb-1.5 flex items-start gap-2 rounded-md border bg-white p-2 transition',
        doc.enabled ? 'border-violet-300 shadow-sm' : 'border-stone-200',
      )}
    >
      <button
        onClick={() => onToggle(!doc.enabled)}
        disabled={busy}
        className={cn(
          'mt-0.5 shrink-0 transition',
          doc.enabled ? 'text-violet-600 hover:text-violet-700' : 'text-stone-400 hover:text-stone-600',
        )}
        title={doc.enabled ? 'Исключить из контекста' : 'Включить в контекст'}
        aria-pressed={doc.enabled}
      >
        <Toggler size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wider',
              ext === 'PDF' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700',
            )}
          >
            {ext}
          </span>
          <div
            className="truncate text-xs font-medium text-stone-800"
            title={doc.filename}
          >
            {doc.filename}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-500">
          <span>{sizeKb} КБ</span>
          <span>·</span>
          <span>{doc.total_chunks} фрагм.</span>
          {doc.error === 'embeddings_unavailable' && (
            <>
              <span>·</span>
              <span className="text-amber-700" title="Без векторизации — поиск по ключевым словам">
                ⚠ без эмбеддингов
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          onClick={onAnalyze}
          disabled={busy}
          className="rounded p-1 text-violet-400 opacity-0 transition hover:bg-violet-50 hover:text-violet-700 group-hover:opacity-100"
          title="Анализ связей с регламентами по всем доменам"
        >
          <FileSearch size={12} />
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="rounded p-1 text-stone-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
          title="Удалить источник"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}
