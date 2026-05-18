import { create } from 'zustand'
import type { ValidationError } from '@/lib/api'

type FlowState = {
  errorsByNode: Record<string, ValidationError[]>
  globalErrors: ValidationError[]
  /** Все ошибки в порядке прихода — для списка в UI и счётчиков. */
  allErrors: ValidationError[]
  /** Маркер «валидация запускалась» — нужен чтобы отличать состояния
   *  «не проверяли» (allErrors=[]) и «проверили, всё чисто» (validated=true). */
  validated: boolean
  selectedNodeId: string | null
  setSelected: (id: string | null) => void
  setErrors: (errors: ValidationError[]) => void
  clearErrors: () => void
}

export const useFlowStore = create<FlowState>((set) => ({
  errorsByNode: {},
  globalErrors: [],
  allErrors: [],
  validated: false,
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
    set({ errorsByNode: byNode, globalErrors: global, allErrors: errors, validated: true })
  },
  clearErrors: () => set({ errorsByNode: {}, globalErrors: [], allErrors: [], validated: false }),
}))
