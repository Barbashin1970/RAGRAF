/**
 * Пресеты системного промпта для чата RAGU.
 *
 * Каждый пресет несёт:
 *  - text: содержимое доп-инструкции (приклеивается к встроенному system-промпту);
 *  - effects: побочные эффекты, применяемые ОДНОВРЕМЕННО — например,
 *    автоматически снять галки с регламентов для сценария «суммаризируй PDF
 *    только по этому документу».
 *
 * Built-in пресеты компилируются в код (общие сценарии).
 * Пользовательские сохраняются в localStorage — переживают релоад страницы,
 * не делятся между устройствами.
 */

export interface PresetEffects {
  /** Снять галки со ВСЕХ регламентов в RegulationsPanel. Полезно для
   *  «отвечай только по документу», когда регламенты будут мешать. */
  disable_all_regulations?: boolean
  /** Зафиксировать temperature на этом значении (не трогаем если undefined). */
  temperature?: number
  /** Лимит длины ответа. */
  max_tokens?: number
  /** Размер контекстного окна Ollama (`num_ctx`). Шире для документов,
   *  уже для коротких задач. Степени 2 (4096, 8192, 16384) — оптимально по RAM. */
  num_ctx?: number
}

export interface SystemPromptPreset {
  id: string
  label: string
  description: string
  template: string
  effects?: PresetEffects
  /** true — встроенный, его нельзя редактировать/удалять. false — пользовательский. */
  builtin: boolean
}

export const BUILTIN_PRESETS: SystemPromptPreset[] = [
  {
    id: 'default',
    label: 'Стандарт',
    description: 'Дефолтное поведение без доп-инструкций.',
    template: '',
    effects: {
      // Дефолтные значения параметров — sync с константами DEFAULT_* в
      // SandboxScreen. Здесь дублируется чтобы переключение на «Стандарт»
      // явно сбрасывало sliders, если до этого был «Резюме документа» (16K).
      temperature: 0.1,
      max_tokens: 600,
      num_ctx: 8192,
    },
    builtin: true,
  },
  {
    id: 'summarize-doc',
    label: 'Резюме документа',
    description: 'Сжать включённые документы в 3-5 предложений, не привлекая регламенты.',
    template:
      'Сделай краткое резюме включённых документов аналитика — что в них главное, ' +
      'в 3-5 предложениях. ' +
      'НЕ обращайся к регламентам корпуса — отвечай ТОЛЬКО по содержимому документов. ' +
      'Цитируй название файла где это уместно. ' +
      'Без markdown, без списков, связным абзацем.',
    effects: {
      disable_all_regulations: true,
      temperature: 0.2,
      max_tokens: 400,
      // 8K хватает с запасом: lean-промпт без regulation-блоков ~1.5K токенов
      // + 4 doc chunks ~800 токенов + ответ 400 токенов ≈ 2.7K. 16K давал
      // 2-3 минуты prefill'а на M2 Air ради воздуха.
      num_ctx: 8192,
    },
    builtin: true,
  },
  {
    id: 'extract-params',
    label: 'Извлечь параметры',
    description: 'Найти числовые параметры с допусками в текстах документов или регламентов.',
    template:
      'Найди в текстах все числовые параметры с допусками. ' +
      'Выведи структурированным списком в формате: ' +
      '«• имя_параметра = ref ± deviation ед.изм (источник: ...)». ' +
      'Если допуска нет — пиши только значение. Не выдумывай числа: только те, что явно ' +
      'указаны в текстах. Если параметров не найдено — так и скажи.',
    effects: {
      temperature: 0.0,
      max_tokens: 600,
      // Извлечение из короткого фрагмента — большое окно не нужно,
      // лишние KV-кэш и медленный prompt-eval ради воздуха.
      num_ctx: 4096,
    },
    builtin: true,
  },
  {
    id: 'compare-regs',
    label: 'Сравнить регламенты',
    description: 'Найти расхождения параметров в нескольких регламентах одного домена.',
    template:
      'Сравни параметры в найденных регламентах: где значения совпадают, где расходятся, ' +
      'есть ли явные противоречия (например, одно ограничение строже другого). ' +
      'Цитируй id регламента и конкретное значение. ' +
      'Без markdown — связным текстом или короткой таблицей.',
    effects: {
      temperature: 0.1,
      max_tokens: 800,
      // 8K хватает на 5-6 регламентов в контексте. Раньше было 12K — лишнее
      // KV-кэш и медленный prefill на M2 Air.
      num_ctx: 8192,
    },
    builtin: true,
  },
  {
    id: 'concise',
    label: 'Краткий ответ',
    description: 'Сжатый ответ в одном-двух предложениях.',
    template:
      'Ответь ОДНИМ-ДВУМЯ предложениями. Без списков, без markdown, без преамбулы. ' +
      'Если у вопроса нет короткого ответа — кратко скажи, чего не хватает.',
    effects: {
      temperature: 0.1,
      max_tokens: 200,
      num_ctx: 4096,
    },
    builtin: true,
  },
  {
    id: 'regulation-candidates',
    label: 'Текст для регламента',
    description:
      'Найти в документе отрывки с числовыми параметрами, пригодные для оцифровки в регламент.',
    template:
      'Найди в приложенных документах ОТРЫВКИ ТЕКСТА с числовыми параметрами, ' +
      'допусками, порогами, условиями — то, что годится для оцифровки в виде ' +
      'регламента (RAGRAF Model Layer).\n\n' +
      'Для каждого отрывка выведи структуру:\n' +
      '┌ Цитата: «<дословный фрагмент 1-3 предложения из документа>»\n' +
      '├ Параметры:\n' +
      '│   • <имя> = <значение> ± <допуск> <ед.изм>\n' +
      '│   • <имя> ≥ <значение> <ед.изм>\n' +
      '├ Возможное название регламента: «...»\n' +
      '└ Источник: <название файла>, секция (если видно)\n\n' +
      'Игнорируй вступления, оглавления, общие фразы без чисел. Если в тексте ' +
      'нет таких отрывков — так и скажи, не выдумывай числа.',
    effects: {
      // Опираемся на документ, регламенты только мешают — могут заслонить
      // нужные пассажи своими описаниями.
      disable_all_regulations: true,
      temperature: 0.0,
      max_tokens: 1000,
      num_ctx: 8192,
    },
    builtin: true,
  },
]

const STORAGE_KEY = 'ragraf:sandbox:user-presets:v1'

export function loadUserPresets(): SystemPromptPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidPreset)
  } catch {
    return []
  }
}

export function saveUserPresets(presets: SystemPromptPreset[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // localStorage quota / private mode — игнорим, лучше потерять пресеты чем сломать UI.
  }
}

function isValidPreset(x: unknown): x is SystemPromptPreset {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.template === 'string' &&
    typeof o.builtin === 'boolean' &&
    !o.builtin // в storage только user-presets хранятся
  )
}

export function createUserPreset(label: string, template: string): SystemPromptPreset {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim() || 'Без названия',
    description: 'Пользовательский пресет',
    template,
    builtin: false,
  }
}
