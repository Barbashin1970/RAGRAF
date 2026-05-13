/**
 * Локальный stub для cytoscape-cola — он не публикует @types на DefinitelyTyped.
 */
declare module 'cytoscape-cola' {
  import type { Ext } from 'cytoscape'
  const cola: Ext
  export default cola
}
