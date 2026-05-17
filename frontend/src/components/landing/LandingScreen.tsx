import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  Cable,
  Car,
  ChevronRight,
  Clock,
  Coins,
  Database,
  ExternalLink,
  FileText,
  Flame,
  Github,
  GraduationCap,
  HeartPulse,
  Layers,
  ListTree,
  Menu,
  MessageSquare,
  Network,
  PlayCircle,
  Radar,
  Sparkles,
  TrendingUp,
  Volume2,
  Wind,
  X,
  Zap,
} from 'lucide-react'

/**
 * Главная RAGRAF — single-page landing в стиле Vercel / Linear / Stripe.
 *
 * Ключевые UX-приёмы (выбраны под современный паттерн 2026):
 *   • Sticky прозрачная шапка → opaque + бордер при скролле. Всегда видна.
 *   • Anchor-only CTA в hero. Уход на внутренние страницы — только из
 *     финального CTA-блока и из подвала.
 *   • Smooth scroll к якорям (см. html { scroll-behavior:smooth } в styles.css).
 *   • Mobile hamburger меню — sticky-nav остаётся доступной на узких экранах.
 *
 * Σ — греческая «сигма», знак суммы; используется как логотип вместо иконки
 * Brain. Соответствует названию платформы.
 *
 * Контент адаптирован из «для Сапфир — версия 1.docx.pdf».
 */

const NAV_SECTIONS: Array<{ href: string; label: string }> = [
  { href: '#overview', label: 'Платформа' },
  { href: '#how-it-works', label: 'Сценарий' },
  { href: '#modules', label: 'Модули' },
  { href: '#architecture', label: 'Архитектура' },
  { href: '#effects', label: 'Эффекты' },
]

const MODULES = [
  { name: 'Теплосети', hint: 'Котельные, тепловые узлы, давление', icon: Flame, color: 'from-orange-50 to-red-50 border-orange-200' },
  { name: 'Шум', hint: 'Мониторинг шумового фона', icon: Volume2, color: 'from-amber-50 to-yellow-50 border-amber-200' },
  { name: 'Качество воздуха', hint: 'PM2.5, AQI, метеоданные', icon: Wind, color: 'from-emerald-50 to-green-50 border-emerald-200' },
  { name: 'Дорожная ситуация', hint: 'ANPR, пробки, ДТП', icon: Car, color: 'from-sky-50 to-blue-50 border-sky-200' },
  { name: 'ВОЛС-мониторинг', hint: 'Оптоволоконный DAS-мониторинг', icon: Cable, color: 'from-slate-50 to-stone-50 border-slate-200' },
  { name: 'Медицинская статистика', hint: 'Агрегированные показатели', icon: HeartPulse, color: 'from-rose-50 to-pink-50 border-rose-200' },
]

const PIPELINE_STEPS = [
  { icon: Radar, title: 'Событие', text: 'Датчик, отраслевая ИС, ВОЛС-сегмент или видеодетектор.' },
  { icon: Network, title: 'Нормализация', text: 'Единый контракт, обогащение контекстом.' },
  { icon: FileText, title: 'Регламент', text: 'SHACL + блок-схема: пороги, критичность, выбор ветки.' },
  { icon: MessageSquare, title: 'Рекомендация', text: 'Объяснимый список действий с цитатами.' },
  { icon: Bell, title: 'Уведомление', text: 'Дашборд, push, SMS. Решение — за человеком.' },
]

const EFFECTS = [
  { icon: Coins, value: '120–180 млн ₽/год', label: 'Снижение потерь от быстрой классификации и маршрутизации событий.' },
  { icon: Clock, value: '−20–30%', label: 'Сокращение трудозатрат и времени подготовки решений.' },
  { icon: TrendingUp, value: '300–400 млн ₽/год', label: 'Стратегический эффект при масштабировании.' },
]

const DEPLOYMENTS = [
  { label: 'Кампус НГУ', icon: Building2 },
  { label: 'Наукоград Кольцово', icon: Sparkles },
  { label: '«СмартСити-Новосибирск»', icon: Zap },
  { label: 'Другие города РФ', icon: ArrowRight },
]

/** Греческая сигма (знак суммы) — логотип платформы. */
function SigmaGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ fontWeight: 700, lineHeight: 1, fontFamily: '"Inter", system-ui, sans-serif' }}
    >
      Σ
    </span>
  )
}

export function LandingScreen() {
  // Sticky-nav: прозрачная над hero, opaque после скролла.
  //
  // Раньше слушали `window.scroll` — но landing скроллится внутри
  // <main overflow-y-auto>, а не на уровне window, поэтому событие
  // не приходило. IntersectionObserver работает независимо от того, кто
  // скроллит: следим за тонким sentinel-div'ом в самом начале страницы
  // и flip'аем state когда он уходит из viewport'а.
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0, rootMargin: '0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const closeMobile = () => setMobileOpen(false)

  return (
    <div className="bg-slate-50 font-sans text-slate-900 antialiased">
      {/* Sentinel для IntersectionObserver — определяет когда мы скроллнули
          ниже самого верха страницы. h-px = 1px невидимая полоска. */}
      <div ref={sentinelRef} aria-hidden className="h-px" />

      {/* ── Sticky nav ──────────────────────────────────────────────── */}
      <nav
        className={`sticky top-0 z-50 transition-all ${
          scrolled
            ? 'border-b border-slate-200 bg-white/80 backdrop-blur-md'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <a href="#top" className="flex items-center gap-2 font-bold tracking-tight">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                scrolled ? 'bg-blue-600 text-white' : 'bg-white/15 text-white backdrop-blur'
              }`}
            >
              <SigmaGlyph className="text-lg" />
            </span>
            <span className={scrolled ? 'text-slate-900' : 'text-white'}>Сигма</span>
            <span
              className={`hidden text-xs font-medium sm:inline ${
                scrolled ? 'text-slate-400' : 'text-blue-200'
              }`}
            >
              · RAGRAF
            </span>
          </a>

          <div className="ml-auto hidden items-center gap-1 sm:flex">
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  scrolled
                    ? 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    : 'text-blue-100 hover:bg-white/15 hover:text-white'
                }`}
              >
                {s.label}
              </a>
            ))}
          </div>

          <Link
            to="/regulations"
            className={`ml-auto hidden items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold shadow-sm transition sm:ml-2 sm:inline-flex ${
              scrolled
                ? 'bg-blue-700 text-white hover:bg-blue-800'
                : 'bg-white text-blue-700 hover:bg-blue-50'
            }`}
          >
            Открыть платформу
            <ArrowRight size={14} />
          </Link>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className={`ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg sm:hidden ${
              scrolled ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/15'
            }`}
            aria-label={mobileOpen ? 'Закрыть меню' : 'Открыть меню'}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile sheet — раскрывается под навбаром */}
        {mobileOpen && (
          <div className="border-t border-slate-200 bg-white sm:hidden">
            <div className="mx-auto max-w-6xl px-4 py-3">
              <div className="grid gap-1">
                {NAV_SECTIONS.map((s) => (
                  <a
                    key={s.href}
                    href={s.href}
                    onClick={closeMobile}
                    className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
              <Link
                to="/regulations"
                onClick={closeMobile}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Открыть платформу
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── 1. Hero ──────────────────────────────────────────────────── */}
      <header
        id="top"
        className="relative -mt-16 overflow-hidden bg-gradient-to-br from-blue-900 via-blue-700 to-indigo-700 pt-16 text-white"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.4)_0,transparent_50%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.3)_0,transparent_50%)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-24 pt-12 sm:pb-32 sm:pt-20">
          <div className="mb-5 text-xs font-semibold uppercase tracking-widest text-blue-200">
            Центр ИИ НГУ · Платформа городской среды
          </div>
          <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="block">Цифровые регламенты</span>
            <span className="block text-blue-200">для города</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-blue-50 sm:text-lg">
            Платформа интеллектуального управления городской средой на базе фреймворка{' '}
            <span className="font-semibold text-white">Σ Сигма</span>. От события — к
            объяснимой рекомендации за секунды.
          </p>

          {/* Hero CTA: ТОЛЬКО якорь вниз (single anchor, как в Stripe/Linear) +
              «прыжок в продукт» вторичной кнопкой. Без множественных уходов. */}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#overview"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50 active:scale-95"
            >
              Узнать больше
              <ArrowDown size={16} />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Как это работает
              <ChevronRight size={16} />
            </a>
          </div>
        </div>
      </header>

      {/* ── 2. Overview ──────────────────────────────────────────────── */}
      <section id="overview" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4">
          <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-16">
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-700">
                01 · Что делает платформа
              </div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                Событие → регламент → рекомендация
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Собирает данные из городских информационных систем, датчиков и
                отраслевых сервисов. Нормализует, проверяет по цифровым регламентам,
                оценивает критичность и формирует объяснимое решение для диспетчера,
                оператора или руководителя. Итоговое решение остаётся за человеком.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm leading-relaxed text-slate-700">
                <li className="flex items-start gap-2">
                  <ChevronRight size={16} className="mt-0.5 shrink-0 text-blue-600" />
                  Единая картина событий городской среды в одном интерфейсе.
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight size={16} className="mt-0.5 shrink-0 text-blue-600" />
                  Объяснимость: каждая рекомендация цитирует регламент и данные.
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight size={16} className="mt-0.5 shrink-0 text-blue-600" />
                  Интерактивный и автономный режимы работы.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Пример обработки
              </div>
              <div className="space-y-2 text-sm">
                <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-700">Событие</div>
                  <div className="text-slate-800">Давление в тепловом вводе 6.2 атм</div>
                </div>
                <div className="ml-4 flex items-center gap-2 text-slate-400">
                  <ChevronRight size={14} className="rotate-90" /> SHACL: предел 5.5 атм
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Критичность</div>
                  <div className="text-slate-800">Высокая · превышение на 13%</div>
                </div>
                <div className="ml-4 flex items-center gap-2 text-slate-400">
                  <ChevronRight size={14} className="rotate-90" /> Регламент heat-inlet-breach
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Рекомендация</div>
                  <div className="text-slate-800">Перекрыть smart-valve · уведомить дежурного оператора</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. How it works ──────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-24 border-y border-slate-200 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-700">
            02 · Сценарий работы
          </div>
          <h2 className="mb-12 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Пять шагов от датчика до решения
          </h2>

          <div className="relative">
            <div
              aria-hidden
              className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent sm:block"
            />
            <ol className="relative grid gap-6 sm:grid-cols-5 sm:gap-4">
              {PIPELINE_STEPS.map((s, idx) => {
                const Icon = s.icon
                return (
                  <li key={s.title}>
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-200 bg-white shadow-sm">
                      <Icon className="h-5 w-5 text-blue-700" />
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Шаг {idx + 1}
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">{s.title}</div>
                    <p className="mt-1 text-sm leading-snug text-slate-600">{s.text}</p>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* ── 4. Modules ───────────────────────────────────────────────── */}
      <section id="modules" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-700">
            03 · Прикладные модули
          </div>
          <h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Подключаемые отраслевые сервисы
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Модули соединяются с ядром через единый событийный контракт — без правки
            платформы. Список расширяется по мере появления данных.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => {
              const Icon = m.icon
              return (
                <div
                  key={m.name}
                  className={`rounded-2xl border bg-gradient-to-br ${m.color} p-4 transition hover:-translate-y-0.5 hover:shadow-md`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                      <Icon className="h-4 w-4 text-slate-700" />
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      в разработке
                    </span>
                  </div>
                  <div className="text-sm font-semibold leading-tight text-slate-800">{m.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{m.hint}</div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── 5. Architecture ──────────────────────────────────────────── */}
      <section id="architecture" className="scroll-mt-24 bg-gradient-to-b from-white to-slate-50 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-700">
            04 · Архитектура
          </div>
          <h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Два фреймворка дополняют друг друга
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/80 text-2xl text-blue-700 shadow-sm">
                  <SigmaGlyph />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900">Σ Сигма</div>
                  <div className="text-xs text-slate-500">технологическая основа платформы</div>
                </div>
              </div>
              <ul className="space-y-2 text-sm leading-snug text-slate-700">
                <li>• Единый пользовательский интерфейс и API Gateway.</li>
                <li>• Ядро/интегратор данных и база событий.</li>
                <li>• Хранилище и редактор цифровых регламентов.</li>
                <li>• RAG-поиск по регламентам и нотификации.</li>
                <li>• Объяснимость принятых решений.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/80 shadow-sm">
                  <Layers className="h-5 w-5 text-violet-700" />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900">Καππα</div>
                  <div className="text-xs text-slate-500">жизненный цикл датасетов и моделей ИИ</div>
                </div>
              </div>
              <ul className="space-y-2 text-sm leading-snug text-slate-700">
                <li>• Сбор, хранение и разметка данных.</li>
                <li>• Обучение и оценка моделей.</li>
                <li>• Передача проверенных моделей в Сигму.</li>
                <li>• Формализованные интерфейсы между фреймворками.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. Effects ───────────────────────────────────────────────── */}
      <section id="effects" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-700">
            05 · Эффекты внедрения
          </div>
          <h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Что даёт платформа в цифрах
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
            Оценка на основе расчётного сценария опытной эксплуатации при
            масштабировании на контур городского управления.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {EFFECTS.map((e) => {
              const Icon = e.icon
              return (
                <div
                  key={e.value}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
                    <Icon className="h-6 w-6 text-blue-700" />
                  </div>
                  <div className="text-3xl font-bold tracking-tight text-slate-900">{e.value}</div>
                  <p className="mt-2 text-sm leading-snug text-slate-600">{e.label}</p>
                </div>
              )
            })}
          </div>

          {/* Где применяется — short chip-list под цифрами */}
          <div className="mt-12 border-t border-slate-200 pt-8">
            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Пилотные внедрения
            </div>
            <div className="flex flex-wrap gap-2">
              {DEPLOYMENTS.map((d) => {
                const Icon = d.icon
                return (
                  <span
                    key={d.label}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700"
                  >
                    <Icon size={13} className="text-blue-600" />
                    {d.label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. Final CTA ─────────────────────────────────────────────── */}
      <section className="px-4 pb-20">
        <div className="mx-auto max-w-5xl rounded-3xl bg-gradient-to-br from-blue-900 via-blue-700 to-indigo-700 px-6 py-14 text-center text-white shadow-2xl sm:px-12 sm:py-16">
          <SigmaGlyph className="mx-auto block text-5xl text-blue-200" />
          <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Попробуйте прямо сейчас
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-blue-100">
            Семь готовых регламентов из практики городского хозяйства, симулятор
            исполнения, ИИ-чат над корпусом.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              to="/regulations"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50 active:scale-95"
            >
              Перейти в редактор регламентов
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/sandbox"
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              <MessageSquare size={16} />
              Студия аналитика
            </Link>
          </div>
        </div>
      </section>

      {/* ── 8. Footer (sitemap) ──────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <div className="grid gap-10 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <SigmaGlyph className="text-lg" />
                </span>
                <span className="text-base font-bold text-white">Сигма · RAGRAF</span>
              </div>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
                Платформа интеллектуального управления городской средой. Создаётся
                Центром ИИ НГУ по направлению «Строительство и городская среда».
              </p>
              <div className="mt-4 text-xs text-slate-500">
                Кампус НГУ · Кольцово · СмартСити-Новосибирск · 2026
              </div>
            </div>

            <FooterColumn title="Платформа">
              <FooterLink to="/regulations" icon={ListTree} label="Регламенты" />
              <FooterLink to="/sandbox" icon={MessageSquare} label="Студия аналитика" />
              <FooterLink to="/sensors" icon={Radar} label="Датчики" />
              <FooterLink to="/graph" icon={Activity} label="Граф связей" />
              <FooterLink to="/execute" icon={PlayCircle} label="Исполнение" badge="beta" />
            </FooterColumn>

            <FooterColumn title="Ресурсы">
              <FooterExtLink href="https://github.com/Barbashin1970/RAGRAF" icon={Github} label="GitHub проекта" />
              <FooterExtLink href="https://sigma-operator.vercel.app/operator" icon={GraduationCap} label="Тренажёр операторов" />
              <FooterExtLink href="https://nsk-opendata-bot.up.railway.app/" icon={Database} label="Открытые данные городов" />
              <FooterExtLink href="/docs" icon={BookOpen} label="API Swagger" />
            </FooterColumn>
          </div>

          <div className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500">
            © 2026 Центр искусственного интеллекта НГУ · Направление «Строительство
            и городская среда»
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {title}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}

function FooterLink({
  to,
  icon: Icon,
  label,
  badge,
}: {
  to: string
  icon: typeof Activity
  label: string
  badge?: string
}) {
  return (
    <li>
      <Link
        to={to}
        className="group inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
      >
        <Icon size={14} className="text-slate-500 transition group-hover:text-blue-400" />
        {label}
        {badge && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
            {badge}
          </span>
        )}
      </Link>
    </li>
  )
}

function FooterExtLink({ href, icon: Icon, label }: { href: string; icon: typeof Activity; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"
      >
        <Icon size={14} className="text-slate-500 transition group-hover:text-blue-400" />
        {label}
        <ExternalLink size={10} className="opacity-50" />
      </a>
    </li>
  )
}
