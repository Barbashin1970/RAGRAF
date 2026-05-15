/**
 * Хранение пользовательской раскладки графа (Cytoscape node positions) в
 * localStorage по доменам. Аналитик может перетащить узлы как ему удобно —
 * positions сохраняются автоматически на drag-end, применяются при следующем
 * открытии того же домена.
 *
 * Schema: ragraf:graph-positions:<domain_key> → JSON `{ [nodeId]: {x, y} }`.
 * Версия v1 в ключе — на случай если поменяем формат и нужно будет инвалидировать.
 */

const STORAGE_PREFIX = 'ragraf:graph-positions:v1:'

export interface NodePos {
  x: number
  y: number
}

export type PositionMap = Record<string, NodePos>

function storageKey(domain: string | null): string {
  return `${STORAGE_PREFIX}${domain ?? '__all__'}`
}

export function loadPositions(domain: string | null): PositionMap {
  try {
    const raw = localStorage.getItem(storageKey(domain))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Валидируем shape: {[id]: {x: number, y: number}}
    const out: PositionMap = {}
    for (const [id, pos] of Object.entries(parsed)) {
      if (
        pos &&
        typeof pos === 'object' &&
        'x' in pos &&
        'y' in pos &&
        typeof (pos as NodePos).x === 'number' &&
        typeof (pos as NodePos).y === 'number'
      ) {
        out[id] = { x: (pos as NodePos).x, y: (pos as NodePos).y }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function savePositions(domain: string | null, positions: PositionMap): void {
  try {
    if (Object.keys(positions).length === 0) {
      localStorage.removeItem(storageKey(domain))
      return
    }
    localStorage.setItem(storageKey(domain), JSON.stringify(positions))
  } catch {
    // localStorage full / disabled — silent fail, graph всё равно работает с
    // дефолтным cola-layout каждый раз.
  }
}

export function clearPositions(domain: string | null): void {
  try {
    localStorage.removeItem(storageKey(domain))
  } catch {
    /* noop */
  }
}

export function countPositions(domain: string | null): number {
  return Object.keys(loadPositions(domain)).length
}
