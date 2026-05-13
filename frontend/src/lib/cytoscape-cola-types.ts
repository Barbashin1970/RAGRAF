/**
 * Локальный тип для опций cytoscape-cola layout.
 *
 * `cytoscape` своих типов для `cola` не знает (LayoutOptions union покрывает
 * только встроенные `grid`/`cose`/...), `@types/cytoscape-cola` нет.
 * Здесь — минимально необходимые поля под наши вызовы.
 *
 * Закрывает R7.2 «stylistic any» из Sigma-audit: вместо `{...} as any`
 * пишем литерал с типом ColaLayoutOptions и кастуем через
 * `as cytoscape.LayoutOptions` (это narrowing → допустимо по R6).
 */
import type cytoscape from 'cytoscape'

export interface ColaLayoutOptions {
  name: 'cola'
  animate?: boolean
  refresh?: number
  maxSimulationTime?: number
  ungrabifyWhileSimulating?: boolean
  nodeSpacing?: number | ((node: unknown) => number)
  flow?: { axis: 'x' | 'y'; minSeparation: number }
  avoidOverlap?: boolean
  handleDisconnected?: boolean
  convergenceThreshold?: number
  edgeLength?: number | ((edge: unknown) => number)
  randomize?: boolean
  infinite?: boolean
  fit?: boolean
  padding?: number
}

/**
 * Bridge: ColaLayoutOptions → cytoscape.LayoutOptions через narrowing-cast.
 * Один локализованный `as` вместо размазанных по коду `as any`.
 */
export function asCytoscapeLayout(opts: ColaLayoutOptions): cytoscape.LayoutOptions {
  return opts as unknown as cytoscape.LayoutOptions
}
