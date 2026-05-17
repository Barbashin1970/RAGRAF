import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Brain,
  Cable,
  Car,
  Clock,
  Coins,
  Database,
  ExternalLink,
  Flame,
  HeartPulse,
  Layers,
  ListTree,
  MessageSquare,
  Network,
  Sparkles,
  TrendingUp,
  Volume2,
  Wind,
} from 'lucide-react'

/**
 * Главная (landing) RAGRAF — точка входа.
 *
 * Дизайн зеркалит главную NSK_OpenData_Bot (синий градиентный hero +
 * пастельные topic-card'ы, скруглённые rounded-2xl, бейджи-pills):
 * https://nsk-opendata-bot.up.railway.app/
 *
 * Контент — адаптировано из «для Сапфир — версия 1.docx.pdf» (ТЗ на ОТР
 * «Платформа интеллектуального управления городской средой на базе
 * фреймворка СИГМА»). Сократили до «лаконично и по делу».
 *
 * Точки выхода:
 *   • Регламенты (внутрь RAGRAF) — основной CTA.
 *   • NSK Open Data Bot (внешняя ссылка) — соседний сервис на той же платформе.
 *   • Студия аналитика — ИИ-чат над регламентами и документами.
 */

const PRIMARY_SERVICES = [
  {
    title: 'RAGRAF — редактор регламентов',
    description: 'Визуальный редактор цифровых регламентов: параметры, блок-схемы реагирования, SHACL-валидация.',
    href: '/regulations',
    icon: ListTree,
    badge: 'Author Layer',
    badgeColor: 'bg-violet-100 text-violet-700 border-violet-200',
    cardColor: 'from-blue-50 to-indigo-50 border-blue-200 hover:border-blue-400',
    external: false,
  },
  {
    title: 'Открытые данные городов',
    description: 'Чат-бот «Сигма» поверх открытых данных Новосибирска и других городов. Спроси на естественном языке.',
    href: 'https://nsk-opendata-bot.up.railway.app/',
    icon: Database,
    badge: 'live',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    cardColor: 'from-sky-50 to-cyan-50 border-sky-200 hover:border-sky-400',
    external: true,
  },
  {
    title: 'Студия аналитика',
    description: 'ИИ-помощник: семантический поиск по корпусу регламентов, разбор PDF/DOCX, извлечение параметров.',
    href: '/sandbox',
    icon: MessageSquare,
    badge: 'beta',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
    cardColor: 'from-violet-50 to-purple-50 border-violet-200 hover:border-violet-400',
    external: false,
  },
]

const APPLIED_MODULES = [
  { name: 'Теплосети', hint: 'Котельные, тепловые узлы, давление', icon: Flame, color: 'from-orange-50 to-red-50 border-orange-200' },
  { name: 'Шум', hint: 'Мониторинг шумового фона', icon: Volume2, color: 'from-amber-50 to-yellow-50 border-amber-200' },
  { name: 'Качество воздуха', hint: 'PM2.5, AQI, метеоданные', icon: Wind, color: 'from-emerald-50 to-green-50 border-emerald-200' },
  { name: 'Дорожная ситуация', hint: 'ANPR, пробки, ДТП', icon: Car, color: 'from-sky-50 to-blue-50 border-sky-200' },
  { name: 'ВОЛС-мониторинг', hint: 'Оптоволоконный DAS-мониторинг', icon: Cable, color: 'from-slate-50 to-stone-50 border-slate-200' },
  { name: 'Медицинская статистика', hint: 'Агрегированные показатели', icon: HeartPulse, color: 'from-rose-50 to-pink-50 border-rose-200' },
]

const EFFECTS = [
  {
    icon: Coins,
    value: '120–180 млн ₽/год',
    label: 'Снижение потерь за счёт быстрой классификации и маршрутизации критических событий.',
  },
  {
    icon: Clock,
    value: '−20–30%',
    label: 'Сокращение трудозатрат и времени подготовки управленческих решений.',
  },
  {
    icon: TrendingUp,
    value: '300–400 млн ₽/год',
    label: 'Стратегический эффект при масштабировании на муниципалитеты без повторной разработки.',
  },
]

export function LandingScreen() {
  return (
    <div className="min-h-full overflow-y-auto bg-slate-50 font-sans text-slate-900 antialiased">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="bg-gradient-to-br from-blue-900 via-blue-700 to-indigo-700 text-white shadow-xl">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-8 sm:pb-16 sm:pt-12">
          {/* Branding row */}
          <div className="mb-6 flex items-center gap-3 sm:mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur sm:h-14 sm:w-14">
              <Brain className="h-7 w-7 text-white sm:h-8 sm:w-8" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Сигма</h1>
              <p className="mt-0.5 text-sm text-blue-200 sm:text-base">
                Платформа интеллектуального управления городской средой
              </p>
            </div>
          </div>

          {/* Lead */}
          <p className="max-w-3xl text-base leading-relaxed text-blue-50 sm:text-lg">
            Прикладное отраслевое технологическое решение Центра ИИ НГУ на базе фреймворка{' '}
            <b>СИГМА</b>. Собирает события из городских информационных систем, сопоставляет их
            с цифровыми регламентами, оценивает критичность и формирует объяснимые рекомендации
            для диспетчеров, операторов и руководителей.
          </p>

          {/* Quick chips */}
          <div className="mt-6 flex flex-wrap gap-2 sm:mt-8">
            <a
              href="#services"
              className="chip rounded-full border border-white/40 bg-white/25 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/40"
            >
              Открытые сервисы
            </a>
            <a
              href="#modules"
              className="chip rounded-full border border-white/40 bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25"
            >
              Прикладные модули
            </a>
            <a
              href="#effects"
              className="chip rounded-full border border-white/40 bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25"
            >
              Эффекты внедрения
            </a>
            <a
              href="#architecture"
              className="chip rounded-full border border-white/40 bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25"
            >
              Архитектура
            </a>
          </div>
        </div>
      </header>

      {/* ── Открытые сервисы ─────────────────────────────────────────── */}
      <section id="services" className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">Открытые сервисы платформы</h2>
            <p className="mt-1 text-sm text-slate-500">
              Пробуй прямо сейчас. Все сервисы работают через единый контракт СИГМЫ.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMARY_SERVICES.map((s) => {
            const Icon = s.icon
            const CardContent = (
              <div
                className={`topic-card group relative h-full cursor-pointer rounded-2xl border bg-gradient-to-br ${s.cardColor} p-5 transition hover:shadow-md`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                    <Icon className="h-5 w-5 text-slate-700" />
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.badgeColor}`}
                  >
                    {s.badge}
                  </span>
                </div>
                <div className="text-base font-semibold leading-tight text-slate-900">
                  {s.title}
                </div>
                <p className="mt-2 text-sm leading-snug text-slate-600">{s.description}</p>
                <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                  Открыть
                  {s.external ? (
                    <ExternalLink size={11} className="opacity-70" />
                  ) : (
                    <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
                  )}
                </div>
              </div>
            )

            return s.external ? (
              <a key={s.title} href={s.href} target="_blank" rel="noreferrer" className="block h-full">
                {CardContent}
              </a>
            ) : (
              <Link key={s.title} to={s.href} className="block h-full">
                {CardContent}
              </Link>
            )
          })}
        </div>
      </section>

      {/* ── Прикладные модули ────────────────────────────────────────── */}
      <section id="modules" className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">Прикладные модули СИГМЫ</h2>
          <p className="mt-1 text-sm text-slate-500">
            Подключаются к ядру через единый событийный контракт — без правки платформы.
            В составе опытной эксплуатации в Кампусе НГУ, наукограде Кольцово и проекте «СмартСити-Новосибирск».
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APPLIED_MODULES.map((m) => {
            const Icon = m.icon
            return (
              <div
                key={m.name}
                className={`topic-card rounded-2xl border bg-gradient-to-br ${m.color} p-4 opacity-90 transition hover:opacity-100 hover:shadow-sm`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                    <Icon className="h-4 w-4 text-slate-700" />
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    в разработке
                  </span>
                </div>
                <div className="text-sm font-semibold leading-tight text-slate-800">{m.name}</div>
                <div className="mt-1 text-xs text-slate-500">{m.hint}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Эффекты внедрения ────────────────────────────────────────── */}
      <section id="effects" className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">Ожидаемые эффекты внедрения</h2>
          <p className="mt-1 text-sm text-slate-500">
            Оценка на основе расчётного сценария опытной эксплуатации при масштабировании
            на контур городского управления.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {EFFECTS.map((e) => {
            const Icon = e.icon
            return (
              <div
                key={e.value}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                  <Icon className="h-5 w-5 text-blue-700" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-slate-900">{e.value}</div>
                <p className="mt-2 text-sm leading-snug text-slate-600">{e.label}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Архитектура ──────────────────────────────────────────────── */}
      <section id="architecture" className="mx-auto max-w-5xl px-4 py-10 sm:py-12">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">Как устроена платформа</h2>
          <p className="mt-1 text-sm text-slate-500">
            Два технологических фреймворка дополняют друг друга.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                <Network className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900">Фреймворк СИГМА</div>
                <div className="text-xs text-slate-500">технологическая основа платформы</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-sm leading-snug text-slate-700">
              <li>• единый пользовательский интерфейс и API Gateway</li>
              <li>• ядро/интегратор данных и база событий</li>
              <li>• хранилище и редактор цифровых регламентов</li>
              <li>• RAG-поиск по регламентам и нотификации</li>
              <li>• объяснимость принятых решений</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                <Layers className="h-5 w-5 text-violet-700" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900">Фреймворк КАППА</div>
                <div className="text-xs text-slate-500">жизненный цикл датасетов и моделей ИИ</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-sm leading-snug text-slate-700">
              <li>• сбор и хранение данных, разметка</li>
              <li>• обучение и оценка моделей</li>
              <li>• передача проверенных моделей и артефактов в СИГМУ</li>
              <li>• формализованные интерфейсы между фреймворками</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="mt-6 border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold text-slate-700">
              <Sparkles size={13} className="mr-1 inline text-blue-600" />
              Центр ИИ НГУ · направление «Строительство и городская среда»
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Кампус НГУ · Кольцово · СмартСити-Новосибирск · 2026
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to="/regulations"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-800"
            >
              Войти в RAGRAF
              <ArrowRight size={14} />
            </Link>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <BookOpen size={14} />
              API Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
