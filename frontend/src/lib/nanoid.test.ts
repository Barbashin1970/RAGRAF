import { describe, expect, it } from 'vitest'
import { nanoid } from './nanoid'

describe('nanoid', () => {
  it('по умолчанию длина 8', () => {
    expect(nanoid()).toHaveLength(8)
  })

  it('возвращает запрошенную длину', () => {
    expect(nanoid(12)).toHaveLength(12)
    expect(nanoid(3)).toHaveLength(3)
  })

  it('генерирует разные id', () => {
    const ids = new Set(Array.from({ length: 100 }, () => nanoid(10)))
    // допускаем редкие коллизии в небольших длинах, но в 10 символах из 62 — не должно быть
    expect(ids.size).toBeGreaterThan(95)
  })

  it('только из URL-safe символов', () => {
    const id = nanoid(40)
    expect(id).toMatch(/^[a-zA-Z0-9]+$/)
  })
})
