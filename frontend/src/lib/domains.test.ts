import { describe, expect, it } from 'vitest'
import { DOMAIN_VISUALS, FALLBACK_VISUAL, getDomainVisual } from './domains'

describe('domains', () => {
  it('каждый из 4 базовых доменов имеет визуал', () => {
    for (const id of ['heating', 'housing', 'safety', 'environment']) {
      expect(DOMAIN_VISUALS[id]).toBeDefined()
      expect(DOMAIN_VISUALS[id].icon).toBeDefined()
      expect(DOMAIN_VISUALS[id].accent).toMatch(/^bg-/)
    }
  })

  it('getDomainVisual возвращает фолбэк для null', () => {
    expect(getDomainVisual(null)).toBe(FALLBACK_VISUAL)
    expect(getDomainVisual(undefined)).toBe(FALLBACK_VISUAL)
  })

  it('getDomainVisual возвращает фолбэк для неизвестного домена', () => {
    expect(getDomainVisual('moon-colony')).toBe(FALLBACK_VISUAL)
  })

  it('getDomainVisual возвращает домен-специфичный визуал', () => {
    const v = getDomainVisual('heating')
    expect(v.icon).toBe(DOMAIN_VISUALS.heating.icon)
    expect(v.accent).toContain('orange')
  })

  it('у всех доменов 6 обязательных цветовых полей', () => {
    for (const [id, v] of Object.entries(DOMAIN_VISUALS)) {
      const keys = ['iconBg', 'iconFg', 'accent', 'chipBg', 'chipFg', 'cardBorder', 'sectionBg']
      for (const k of keys) {
        expect((v as any)[k], `${id}.${k}`).toBeDefined()
      }
    }
  })
})
