/**
 * Локальный stub для cytoscape-cola — он не публикует @types на DefinitelyTyped.
 */
declare module 'cytoscape-cola' {
  import type { Ext } from 'cytoscape'
  const cola: Ext
  export default cola
}

// Build-version, проставляемая в vite.config.ts через define. Используется
// для авто-сброса localStorage при деплое новой версии (см. main.tsx).
declare const __BUILD_VERSION__: string
