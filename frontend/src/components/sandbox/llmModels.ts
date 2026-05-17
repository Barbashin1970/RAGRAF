/**
 * Каталог LLM-моделей для выпадашки в правой панели Студии.
 *
 * Раньше был хардкод 2 Ollama-тегов (qwen2.5:7b / 3b). После перехода на
 * провайдер-агностичный backend (Cerebras / Groq / OpenAI / Ollama) каталог
 * строится из `available_models` в ответе `/api/sandbox/llm-info` —
 * выбор провайдера задаётся на сервере через ENV, фронт просто отрисовывает.
 *
 * Legacy `MODEL_CATALOG` и `modelByKind` остались для Ollama-режима
 * и fallback'а когда llm-info ещё не пришла.
 */

export type ModelKind = 'precise' | 'fast'

export interface LLMModelProfile {
  kind: ModelKind
  /** Реальный tag модели — то, что уйдёт в `model` поле chat-запроса. */
  ollama_tag: string
  label: string
  hint: string
  /** RAM-нагрузка в гигабайтах (только для Ollama, для cloud = 0). */
  ram_gb: number
  /** Примерная скорость генерации (т/с) — для UI-подсказки. */
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

// ── Provider-aware каталог из llm-info ─────────────────────────────────

type ProviderKey = 'ollama' | 'cerebras' | 'groq' | 'openrouter' | 'openai' | 'mock'

/**
 * Подсказки для cloud-моделей. Подгоняем kind (precise/fast) под существующий
 * UI: «первая» = precise (дороже/медленнее, но качественнее), «вторая» = fast.
 */
const PROVIDER_HINTS: Record<string, { label: string; hint: string; tokens_per_sec: number; use_when: string }> = {
  // Cerebras
  'qwen-3-32b': { label: 'Qwen3 32B (Cerebras)', hint: '32B-instruct на Cerebras Wafer. Отличный русский, 1800+ т/с.', tokens_per_sec: 1800, use_when: 'Любой сценарий — почти мгновенный ответ.' },
  'llama-3.3-70b': { label: 'Llama 3.3 70B (Cerebras)', hint: 'Большая модель, лучшая reasoning. Чуть медленнее Qwen3 32B на Cerebras.', tokens_per_sec: 1500, use_when: 'Сложные follow-up, сравнение регламентов.' },
  'llama3.1-8b': { label: 'Llama 3.1 8B (Cerebras)', hint: 'Лёгкая модель, максимум скорости.', tokens_per_sec: 2200, use_when: 'Приветствия, короткие ответы.' },
  // Groq
  'llama-3.3-70b-versatile': { label: 'Llama 3.3 70B (Groq)', hint: 'Universal Llama, ~250 т/с на Groq LPU.', tokens_per_sec: 250, use_when: 'Универсальная — сложные и простые ответы.' },
  'llama-3.1-8b-instant': { label: 'Llama 3.1 8B Instant (Groq)', hint: '~750 т/с, 14К запросов/день. Идеально для follow-up.', tokens_per_sec: 750, use_when: 'Быстрая итерация, follow-up.' },
  'qwen-qwq-32b': { label: 'Qwen QwQ 32B (Groq)', hint: 'Reasoning-модель с CoT (думает «вслух» перед ответом).', tokens_per_sec: 400, use_when: 'Задачи на reasoning, где важна цепочка рассуждений.' },
  // OpenRouter (free-tier маркеры :free)
  'qwen/qwen-2.5-72b-instruct:free': { label: 'Qwen2.5 72B (free)', hint: 'Большая Qwen через OpenRouter free-tier.', tokens_per_sec: 30, use_when: 'Лучшее качество русского из бесплатных.' },
  'meta-llama/llama-3.3-70b-instruct:free': { label: 'Llama 3.3 70B (free)', hint: '70B Llama через OpenRouter, 20 RPM / 50 RPD без баланса.', tokens_per_sec: 30, use_when: 'Когда нужен Llama-style ответ.' },
  'deepseek/deepseek-r1:free': { label: 'DeepSeek R1 (free)', hint: 'Reasoning-модель с CoT.', tokens_per_sec: 25, use_when: 'Reasoning, многошаговые задачи.' },
  // OpenAI
  'gpt-4o-mini': { label: 'GPT-4o Mini', hint: 'Самый дешёвый GPT-4o.', tokens_per_sec: 80, use_when: 'Универсальная.' },
  'gpt-4o': { label: 'GPT-4o', hint: 'Полная GPT-4o.', tokens_per_sec: 50, use_when: 'Лучшее качество, ничего не жалко.' },
}

/**
 * Построить каталог моделей для провайдера. Берёт список из llm-info и
 * добавляет UI-подсказки из PROVIDER_HINTS. Если модели в подсказках нет —
 * рендерим минимальный профиль с tag-ом в качестве label.
 */
export function buildModelCatalog(
  provider: ProviderKey | undefined,
  available: readonly string[] | undefined,
  fallbackModel: string | undefined,
): LLMModelProfile[] {
  // Ollama — оставляем легаси MODEL_CATALOG (precise/fast q4_K_M).
  if (!provider || provider === 'ollama') return MODEL_CATALOG

  const list = available && available.length > 0 ? [...available] : (fallbackModel ? [fallbackModel] : [])
  if (list.length === 0) return MODEL_CATALOG

  return list.map((tag, idx): LLMModelProfile => {
    const hint = PROVIDER_HINTS[tag]
    return {
      kind: idx === 0 ? 'precise' : 'fast',
      ollama_tag: tag,
      label: hint?.label ?? tag,
      hint: hint?.hint ?? `Модель провайдера ${provider}`,
      ram_gb: 0,
      tokens_per_sec: hint?.tokens_per_sec ?? 50,
      use_when: hint?.use_when ?? 'Универсальная.',
    }
  })
}

/**
 * Разрешить выбранный `kind` (precise/fast) в реальный tag для текущего
 * провайдера. Если каталог содержит только одну модель — обе кнопки указывают
 * на неё (для cloud-провайдеров с одним preset'ом это нормально).
 */
export function resolveModelTag(
  kind: ModelKind,
  llmInfo: { provider?: ProviderKey; available_models?: readonly string[]; llm_model?: string } | undefined,
): string {
  const catalog = buildModelCatalog(llmInfo?.provider, llmInfo?.available_models, llmInfo?.llm_model)
  const found = catalog.find((m) => m.kind === kind)
  return (found ?? catalog[0] ?? modelByKind(kind)).ollama_tag
}
