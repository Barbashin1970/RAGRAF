import { create } from 'zustand'
import type { ValidationError } from '@/lib/api'

type FlowState = {
  errorsByNode: Record<string, ValidationError[]>
  globalErrors: ValidationError[]
  selectedNodeId: string | null
  setSelected: (id: string | null) => void
  setErrors: (errors: ValidationError[]) => void
  clearErrors: () => void
}

export const useFlowStore = create<FlowState>((set) => ({
  errorsByNode: {},
  globalErrors: [],
  selectedNodeId: null,
  setSelected: (id) => set({ selectedNodeId: id }),
  setErrors: (errors) => {
    const byNode: Record<string, ValidationError[]> = {}
    const global: ValidationError[] = []
    for (const e of errors) {
      if (e.nodeId) {
        if (!byNode[e.nodeId]) byNode[e.nodeId] = []
        byNode[e.nodeId].push(e)
      } else {
        global.push(e)
      }
    }
    set({ errorsByNode: byNode, globalErrors: global })
  },
  clearErrors: () => set({ errorsByNode: {}, globalErrors: [] }),
}))
