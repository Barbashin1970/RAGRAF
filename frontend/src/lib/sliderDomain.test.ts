import { describe, expect, it } from 'vitest'
import { deriveSliderRange, fillPercent } from './sliderDomain'

describe('deriveSliderRange — стабильность диапазона', () => {
  it('SHACL bounds авторитетны', () => {
    const r = deriveSliderRange({
      referenceValue: 5,
      deviationAllowed: 11,
      minInclusive: 0,
      maxInclusive: 60,
    })
    expect(r.min).toBe(0)
    expect(r.max).toBe(60)
  })

  it('баг из скриншота: range и devMax НЕ должны меняться при правке deviation', () => {
    // Параметр 5 ± 0 без SHACL maxInclusive (только minInclusive=0) — как у sandbox-created.
    const r0 = deriveSliderRange({ referenceValue: 5, deviationAllowed: 0, minInclusive: 0 })
    const r5 = deriveSliderRange({ referenceValue: 5, deviationAllowed: 5, minInclusive: 0 })
    const r11 = deriveSliderRange({ referenceValue: 5, deviationAllowed: 11, minInclusive: 0 })

    expect(r0.min).toBe(r5.min)
    expect(r0.max).toBe(r5.max)
    expect(r0.devMax).toBe(r5.devMax)
    expect(r0.step).toBe(r5.step)

    expect(r0.min).toBe(r11.min)
    expect(r0.max).toBe(r11.max)
    expect(r0.devMax).toBe(r11.devMax)
    expect(r0.step).toBe(r11.step)
  })

  it('range и devMax не зависят от dev и без SHACL bounds', () => {
    const a = deriveSliderRange({ referenceValue: 70, deviationAllowed: 1 })
    const b = deriveSliderRange({ referenceValue: 70, deviationAllowed: 50 })
    const c = deriveSliderRange({ referenceValue: 70, deviationAllowed: 500 })
    expect(a.min).toBe(b.min)
    expect(a.max).toBe(b.max)
    expect(a.devMax).toBe(b.devMax)
    expect(c.min).toBe(a.min)
    expect(c.max).toBe(a.max)
  })

  it('reference-thumb остаётся на той же относительной позиции при изменении dev', () => {
    const before = deriveSliderRange({ referenceValue: 5, deviationAllowed: 0, minInclusive: 0 })
    const after = deriveSliderRange({ referenceValue: 5, deviationAllowed: 11, minInclusive: 0 })
    expect(fillPercent(5, before.min, before.max)).toBeCloseTo(fillPercent(5, after.min, after.max))
  })
})

describe('deriveSliderRange — флаги переполнения', () => {
  it('devOverflow=true когда dev выходит за half-range', () => {
    const r = deriveSliderRange({
      referenceValue: 5,
      deviationAllowed: 11,
      minInclusive: 0,
      maxInclusive: 10,
    })
    // span = 10 → devMax = 5 → dev=11 > 5
    expect(r.devMax).toBe(5)
    expect(r.devOverflow).toBe(true)
  })

  it('devOverflow=false когда dev влезает в half-range', () => {
    const r = deriveSliderRange({
      referenceValue: 5,
      deviationAllowed: 4,
      minInclusive: 0,
      maxInclusive: 10,
    })
    expect(r.devOverflow).toBe(false)
  })

  it('devTooWide=true когда |dev| > |ref|', () => {
    const r = deriveSliderRange({ referenceValue: 5, deviationAllowed: 7 })
    expect(r.devTooWide).toBe(true)
  })

  it('devTooWide=false для типичного 14% толеранса (70 ± 10)', () => {
    const r = deriveSliderRange({ referenceValue: 70, deviationAllowed: 10 })
    expect(r.devTooWide).toBe(false)
  })

  it('devTooWide=false для ref=0 (не делим на ноль семантически)', () => {
    const r = deriveSliderRange({ referenceValue: 0, deviationAllowed: 5 })
    expect(r.devTooWide).toBe(false)
  })

  it('devTooWide=true для отрицательных параметров с большим dev', () => {
    const r = deriveSliderRange({ referenceValue: -10, deviationAllowed: 15 })
    expect(r.devTooWide).toBe(true)
  })
})

describe('deriveSliderRange — крайние случаи', () => {
  it('null/undefined ref трактуется как 0', () => {
    const r = deriveSliderRange({ referenceValue: null, deviationAllowed: 1 })
    expect(r.min).toBeLessThan(0)
    expect(r.max).toBeGreaterThan(0)
  })

  it('NaN ref безопасно деградирует к 0', () => {
    const r = deriveSliderRange({ referenceValue: NaN, deviationAllowed: 1 })
    expect(Number.isFinite(r.min)).toBe(true)
    expect(Number.isFinite(r.max)).toBe(true)
    expect(r.max).toBeGreaterThan(r.min)
  })

  it('перевёрнутый SHACL bounds → fallback вокруг ref', () => {
    const r = deriveSliderRange({
      referenceValue: 5,
      deviationAllowed: 1,
      minInclusive: 100,
      maxInclusive: 0,
    })
    expect(r.min).toBeLessThan(r.max)
    expect(r.min).toBe(-5)
    expect(r.max).toBe(15)
  })

  it('равные SHACL bounds → fallback вокруг ref', () => {
    const r = deriveSliderRange({
      referenceValue: 5,
      deviationAllowed: 1,
      minInclusive: 5,
      maxInclusive: 5,
    })
    expect(r.max).toBeGreaterThan(r.min)
  })

  it('крупные значения дают разумный шаг (1000 → step ~10–25)', () => {
    const r = deriveSliderRange({ referenceValue: 1000, deviationAllowed: 50 })
    expect(r.step).toBeGreaterThanOrEqual(10)
    expect(r.step).toBeLessThanOrEqual(50)
  })

  it('крошечные значения дают мелкий шаг (0.5 → step ≤ 0.1)', () => {
    const r = deriveSliderRange({ referenceValue: 0.5, deviationAllowed: 0.1, minInclusive: 0, maxInclusive: 1 })
    expect(r.step).toBeLessThanOrEqual(0.1)
  })

  it('отрицательный ref + SHACL обрабатывается корректно', () => {
    const r = deriveSliderRange({
      referenceValue: -10,
      deviationAllowed: 2,
      minInclusive: -100,
      maxInclusive: 0,
    })
    expect(r.min).toBe(-100)
    expect(r.max).toBe(0)
    expect(r.devMax).toBe(50)
  })

  it('null deviation трактуется как 0', () => {
    const r = deriveSliderRange({ referenceValue: 5, deviationAllowed: null })
    expect(r.devOverflow).toBe(false)
    expect(r.devTooWide).toBe(false)
  })
})

describe('fillPercent', () => {
  it('value в центре диапазона = 50%', () => {
    expect(fillPercent(5, 0, 10)).toBe(50)
  })

  it('value на границах = 0% / 100%', () => {
    expect(fillPercent(0, 0, 10)).toBe(0)
    expect(fillPercent(10, 0, 10)).toBe(100)
  })

  it('value вне диапазона клампится', () => {
    expect(fillPercent(-5, 0, 10)).toBe(0)
    expect(fillPercent(15, 0, 10)).toBe(100)
  })

  it('вырожденный диапазон → 0', () => {
    expect(fillPercent(5, 5, 5)).toBe(0)
    expect(fillPercent(5, 10, 0)).toBe(0)
  })
})
