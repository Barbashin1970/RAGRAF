import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BookText,
  Brain,
  GitCompare,
  Layers,
  Network,
  ScanText,
  Search,
} from 'lucide-react'

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

        {/* Развёрнутое описание системы для руководителя — простой язык, конкретные value-prop'ы,
            без жаргона про embeddings и community detection. Они есть в карточках ниже. */}
        <section className="mt-5 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/90 text-white">
              <Brain size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-900">О связке RAGU + RAGRAF</h2>
              <p className="text-xs text-stone-500">
                Почему имеет смысл рассматривать их вместе при планировании разработки
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm leading-relaxed text-stone-700">
            <p>
              <b>Проблема.</b> В любом крупном объекте — ВУЗ, ТЭЦ, ЖКХ, кампус — накопились
              сотни регламентов, приказов, СНиПов и инструкций. Они в Word и PDF, написаны
              разными авторами в разные годы. Найти что-то конкретное — долго; понять{' '}
              <i>какой параметр в каком документе фигурирует</i> — почти невозможно;
              согласовать новый приказ со старыми — это часы ручного сличения.
            </p>

            <p>
              <b>RAGU</b> <span className="text-xs text-stone-500">(Retrieval-Augmented Graph Utility)</span> —
              открытый движок <i>GraphRAG</i>. На входе — массив технических текстов; на выходе —
              <b> связная база знаний</b>, где каждый параметр, действие, ссылка на нормативку и
              сценарий реагирования превращается в узел графа, связанный с другими. Это уже не
              «поиск по словам», а понимание <i>что с чем связано</i>.
            </p>

            <p>
              <b>RAGRAF</b> — визуальный слой над этими данными: карта регламентов по доменам,
              редактор с слайдерами для калибровки уставок, Rule DSL Flow для моделирования
              сценариев реагирования, SHACL-ограничения для валидации, версионирование с
              историей. То, что обычно делают в Excel + Word + почте, здесь делается в одном
              месте — и с проверкой консистентности.
            </p>

            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Что это даёт в практике
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <ScanText size={14} className="mt-0.5 shrink-0 text-violet-600" />
                  <span>
                    <b>Новый приказ — за минуты, не за часы.</b> Загружаешь текст постановления
                    или фрагмент СНиПа — RAGU предлагает 5-10 параметров (диаметр, давление,
                    температура, время реакции и т.п.) с уставками и допусками. Эксперт правит
                    очевидное и публикует — рутинного ввода нет.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Search size={14} className="mt-0.5 shrink-0 text-violet-600" />
                  <span>
                    <b>Поиск по смыслу, а не по словам.</b> Запрос «куда звонить при пожаре в
                    серверной?» находит нужный регламент, даже если внутри нет слова «пожар»
                    (есть «термический инцидент», «задымление», «эскалация ЕДДС»). Сотрудник
                    в стрессе получает ответ за секунды.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Network size={14} className="mt-0.5 shrink-0 text-violet-600" />
                  <span>
                    <b>Карта связей между документами.</b> Видно где один параметр (например
                    температура) участвует в 4 регламентах разных доменов; где два регламента
                    дают <i>противоречащие</i> допуски; где новый приказ перекрывает старый.
                    Это база для аудита и унификации.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Layers size={14} className="mt-0.5 shrink-0 text-violet-600" />
                  <span>
                    <b>От документа — к управляемым данным.</b> «Температура должна быть 70 ± 10 °C»
                    в тексте превращается в узел графа: его можно мониторить, сравнивать с
                    реальными показаниями, моделировать «что если допуск 5°C вместо 10°C».
                    Регламенты становятся <b>исполняемой</b> частью системы, а не PDF в архиве.
                  </span>
                </li>
              </ul>
            </div>

            <p className="text-stone-600">
              <b>Почему вместе.</b> RAGU без RAGRAF — это API, в которое нечем кликать и нет
              визуальной обратной связи: данные есть, человек их не видит. RAGRAF без RAGU —
              это красивый редактор регламентов-«островов», без понимания связей и без
              авто-извлечения. Связка покрывает обе стороны: <b>интеллект</b> разбора и поиска
              даёт RAGU, <b>UX</b> работы с этими знаниями и экспертная калибровка — RAGRAF.
              Поэтому в плане развития имеет смысл закладывать оба сразу: один без другого
              даёт сильно меньше пользы.
            </p>

            <div className="rounded-md border border-stone-200 bg-stone-50/60 p-3 text-xs text-stone-600">
              <div className="mb-1.5 font-semibold uppercase tracking-wide text-stone-500">
                Где мы сейчас и что нужно для следующего шага
              </div>
              <p className="leading-relaxed">
                Сейчас в коде работает <b>mock-режим</b> — regex по числам + keyword scoring
                по словарю. Он покрывает оба текущих демо (поиск по регламентам, извлечение
                параметров) <b>без внешних зависимостей</b>: ни LLM-ключей, ни GPU, ни
                сторонних серверов. Этого достаточно для презентации идеи и тестирования
                UX-цикла «текст → параметры → регламент».
              </p>
              <p className="mt-1.5 leading-relaxed">
                Чтобы включить <b>настоящий RAGU</b>, помимо{' '}
                <code className="rounded bg-stone-100 px-1">pip install -e external/RAGU</code>
                {' '}и{' '}
                <code className="rounded bg-stone-100 px-1">RAGU_ENABLED=true</code>
                {' '}нужен <b>доступ к LLM</b> и <b>embedding-модели</b>: extractor сущностей и
                community-summarization вызывают модель. Варианты:
              </p>
              <ul className="mt-1 space-y-0.5 pl-4 text-[11px]">
                <li>· OpenAI / Anthropic / Mistral — облачный ключ в{' '}
                  <code className="rounded bg-stone-100 px-1">OPENAI_API_KEY</code></li>
                <li>· OpenRouter / Together / Fireworks — те же ключи + кастомный{' '}
                  <code className="rounded bg-stone-100 px-1">OPENAI_BASE_URL</code></li>
                <li>· локально: <code className="rounded bg-stone-100 px-1">llama-server</code> /
                  vLLM / ollama (без облака, но нужны GPU)</li>
              </ul>
              <p className="mt-1.5 leading-relaxed">
                Интерфейсы и API при переключении остаются те же — меняется только
                <code className="mx-1 rounded bg-stone-100 px-1">backend_mode()</code>: бейдж в шапке
                становится <span className="rounded bg-emerald-100 px-1 text-emerald-700">RAGU подключён</span>{' '}
                вместо <span className="rounded bg-amber-100 px-1 text-amber-800">mock-режим</span>.
              </p>
            </div>
          </div>
        </section>

        <h2 className="mt-8 text-lg font-semibold text-stone-900">Сценарии в очереди</h2>
        <p className="mt-1 text-sm text-stone-500">
          Конкретные демо которые ставятся рядом с текущими (поиск + extractor) и постепенно
          раскрывают возможности связки.
        </p>

        <div className="mt-3 space-y-3">
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
