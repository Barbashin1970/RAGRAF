/**
 * Каталог LLM-моделей, доступных для переключения в правой панели Студии.
 *
 * Backend по умолчанию использует `settings.ragu_llm_model` (точная 7b).
 * Пользователь может переключиться на «быструю» 3b для коротких сценариев
 * (приветствие, краткие ответы, извлечение параметров из небольшого текста) —
 * примерно в 2-3 раза быстрее на M2 Air при половинном RAM-расходе.
 */

export type ModelKind = 'precise' | 'fast'

export interface LLMModelProfile {
  kind: ModelKind
  /** Реальный tag в Ollama — должен совпадать с `ollama pull <name>`. */
  ollama_tag: string
  label: string
  hint: string
  /** RAM-нагрузка в гигабайтах (округлённо) — для UI-подсказки. */
  ram_gb: number
  /** Примерная скорость генерации на M2 Air — для UI-подсказки. */
  tokens_per_sec: number
  /** Когда стоит выбирать. */
  use_when: string
}

export const MODEL_CATALOG: LLMModelProfile[] = [
  {
    kind: 'precise',
    ollama_tag: 'qwen2.5:7b-instruct-q4_K_M',
    label: 'Точная (qwen2.5:7b)',
    hint: 'Полное качество reasoning и русского. Дольше отвечает.',
    ram_gb: 4.4,
    tokens_per_sec: 6,
    use_when: 'Сводки длинных документов, сравнение регламентов, сложные follow-up\'ы.',
  },
  {
    kind: 'fast',
    ollama_tag: 'qwen2.5:3b-instruct-q4_K_M',
    label: 'Быстрая (qwen2.5:3b)',
    hint: '~2-3× быстрее при половине RAM. Та же семья — промпты не нужно переписывать.',
    ram_gb: 2.0,
    tokens_per_sec: 13,
    use_when: 'Приветствия, краткие ответы, извлечение параметров из короткого текста, быстрая итерация.',
  },
]

export const DEFAULT_MODEL_KIND: ModelKind = 'precise'

export function modelByKind(kind: ModelKind): LLMModelProfile {
  return MODEL_CATALOG.find((m) => m.kind === kind) ?? MODEL_CATALOG[0]
}

const STORAGE_KEY = 'ragraf:sandbox:model-kind:v1'

export function loadModelKind(): ModelKind {
  if (typeof window === 'undefined') return DEFAULT_MODEL_KIND
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'precise' || v === 'fast') return v
  } catch {
    // localStorage недоступен — берём дефолт
  }
  return DEFAULT_MODEL_KIND
}

export function saveModelKind(kind: ModelKind): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, kind)
  } catch {
    // ignore
  }
}
