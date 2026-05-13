import { Link } from 'react-router-dom'
import { ArrowLeft, BookText, GitCompare, Network } from 'lucide-react'

interface BacklogItem {
  id: string
  title: string
  description: string
  complexity: 'низкая' | 'средняя' | 'высокая'
  icon: typeof BookText
  ragu_features: string[]
}

const BACKLOG: BacklogItem[] = [
  {
    id: 'knowledge-graph',
    title: 'Knowledge Graph всех регламентов',
    description:
      'Cytoscape-карта где регламенты связаны общими параметрами / action-типами / доменами. Например, `temperature` упоминается в 4 регламентах разных доменов — это cross-domain entity. RAGU GlobalSearchEngine с community detection найдёт такие кластеры. Mock без RAGU: статический graph_builder на parameter-name overlap.',
    complexity: 'средняя',
    icon: Network,
    ragu_features: ['GlobalSearchEngine', 'community detection', 'graph traversal'],
  },
  {
    id: 'compare-regulations',
    title: 'Сравнение двух регламентов',
    description:
      'Выбираешь два — RAGU подсвечивает «эти параметры общие», «эти противоречат», «эта рекомендация в первом перекрывает действия из второго». Полезно при унификации регламентов из разных источников (например, Sigma + ТСЖ + кампусные).',
    complexity: 'средняя',
    icon: GitCompare,
    ragu_features: ['embedding similarity', 'LocalSearchEngine cross-query', 'semantic overlap'],
  },
  {
    id: 'auto-tag-domain',
    title: 'Авто-классификация домена нового регламента',
    description:
      'При создании регламента (или импорте из текста) RAGU предсказывает домен — heating / housing / safety / environment / другой — по embeddings и сравнению с центроидами существующих регламентов. Помогает в Scenario B (flow-first).',
    complexity: 'низкая',
    icon: BookText,
    ragu_features: ['embedder', 'cosine similarity к центроидам'],
  },
  {
    id: 'qa-over-regulation',
    title: 'Q&A над одним регламентом',
    description:
      'Открываешь регламент → панель «Спроси у RAGU». «Какие параметры наиболее критичные?», «На что ссылается этот регламент?», «Что делать если pressure упал на 2 атм?». LocalSearchEngine по KG этого регламента (узлы = параметры + рекомендации).',
    complexity: 'средняя',
    icon: BookText,
    ragu_features: ['LocalSearchEngine', 'QueryPlanEngine', 'subgraph extraction'],
  },
]

const COMPLEXITY_COLOR: Record<BacklogItem['complexity'], string> = {
  низкая:  'bg-emerald-100 text-emerald-700',
  средняя: 'bg-amber-100 text-amber-700',
  высокая: 'bg-rose-100 text-rose-700',
}

export function SandboxBacklog() {
  return (
    <div className="h-full overflow-auto bg-stone-50 p-6">
      <div className="mx-auto max-w-3xl">
        <Link to="/sandbox" className="mb-3 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800">
          <ArrowLeft size={12} /> Назад в песочницу
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900">Бэклог RAGU-сценариев</h1>
        <p className="mt-1 text-sm text-stone-500">
          Идеи которые можно быстро поставить рядом с текущими демо. Не обязательно делать все —
          реализуем когда станет ясно что нужно.
        </p>

        <div className="mt-5 space-y-3">
          {BACKLOG.map((it) => {
            const Icon = it.icon
            return (
              <article key={it.id} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100">
                    <Icon size={16} className="text-violet-700" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-stone-900">{it.title}</h3>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${COMPLEXITY_COLOR[it.complexity]}`}>
                        {it.complexity} сложность
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-stone-600">{it.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-stone-400">RAGU:</span>
                      {it.ragu_features.map((f) => (
                        <span key={f} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-700">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
