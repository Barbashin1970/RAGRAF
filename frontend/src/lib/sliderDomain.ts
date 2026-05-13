/**
 * Чистая логика расчёта диапазонов для слайдеров параметра (reference + deviation).
 *
 * Главное правило: визуальный диапазон reference-слайдера **не должен зависеть
 * от текущего deviation**. Иначе возникает feedback-loop, при котором изменение
 * deviation сдвигает шарик reference — баг, который ловил пользователь на
 * параметре `5 ± 11` (без SHACL maxInclusive).
 *
 * Поэтому:
 *   - SHACL `minInclusive`/`maxInclusive` авторитетны, когда заданы.
 *   - Без SHACL: padding вокруг ref берётся как функция ТОЛЬКО от ref:
 *     `max(|ref| * 2, 10)`. Это даёт «дышащий запас» в обе стороны, но без
 *     дрейфа при правке deviation.
 *   - `devMax` = `(max - min) / 2` — половина диапазона. Если фактический dev
 *     выходит за это (`devOverflow`), thumb упирается в правый край, и
 *     показывается подсказка — а reference остаётся на месте.
 *   - `step` тоже стабилен (зависит только от span).
 *
 * Флаг `devTooWide` — мягкая семантическая подсказка: deviation ≥ |ref|.
 * Иногда это валидно (PM2.5: 10 ± 10), но часто — опечатка.
 */

export interface SliderDomain {
  /** Левая граница reference-слайдера. */
  min: number
  /** Правая граница reference-слайдера. */
  max: number
  /** Шаг для range-input. */
  step: number
  /** Верхняя граница deviation-слайдера (нижняя всегда 0). */
  devMax: number
  /** Текущий dev физически не помещается в half-range — thumb уйдёт в правый край. */
  devOverflow: boolean
  /** Деформация: |dev| ≥ |ref|. Подсветим, но не запретим. */
  devTooWide: boolean
}

const NICE_STEPS = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]

function pickStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const target = span / 100
  return NICE_STEPS.find((s) => s >= target) ?? Math.max(Math.round(target), 1)
}

export interface SliderDomainInput {
  referenceValue?: number | null
  deviationAllowed?: number | null
  minInclusive?: number | null
  maxInclusive?: number | null
}

export function deriveSliderRange(p: SliderDomainInput): SliderDomain {
  const ref = Number.isFinite(p.referenceValue as number) ? (p.referenceValue as number) : 0
  const dev = Math.abs(Number.isFinite(p.deviationAllowed as number) ? (p.deviationAllowed as number) : 0)
  const lo = p.minInclusive
  const hi = p.maxInclusive

  // Padding вокруг ref зависит только от ref. Это критично: иначе range «дышит» при
  // изменении dev → reference-thumb визуально съезжает.
  const padding = Math.max(Math.abs(ref) * 2, 10)

  let min = lo !== null && lo !== undefined && Number.isFinite(lo) ? lo : ref - padding
  let max = hi !== null && hi !== undefined && Number.isFinite(hi) ? hi : ref + padding

  // Защита от перевёрнутых / вырожденных bound'ов из плохих данных.
  if (!(max > min)) {
    min = ref - 10
    max = ref + 10
  }

  const span = max - min
  const step = pickStep(span)

  // devMax — половина диапазона: при центральном ref значения ref ± devMax укладываются.
  // Не зависит от текущего dev → нет dev → max → devMax → dev цикла.
  const devMax = Math.max(span / 2, 1)

  return {
    min,
    max,
    step,
    devMax,
    devOverflow: dev > devMax,
    devTooWide: ref !== 0 && dev > Math.abs(ref),
  }
}

/**
 * Доля диапазона слева от value, в процентах [0..100]. Используется для CSS-fill.
 * Безопасна к value за пределами [min, max] — клампится.
 */
export function fillPercent(value: number, min: number, max: number): number {
  const span = max - min
  if (span <= 0) return 0
  const raw = ((value - min) / span) * 100
  return Math.max(0, Math.min(100, raw))
}
