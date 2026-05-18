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
  /** Какую модель использовать: 'precise' (qwen2.5:7b) или 'fast' (qwen2.5:3b).
   *  Для коротких/быстрых сценариев лучше 'fast' — 2-3× быстрее на M2 Air. */
  model?: 'precise' | 'fast'
}

export interface SystemPromptPreset {
  id: string
  label: string
  description: string
  /** Системный промпт — клеится к base-инструкции (стиль / тон / антигаллюц). */
  template: string
  /**
   * Заготовленный текст вопроса пользователя — подставляется в инпут при клике
   * на пресет (только если поле пустое). Раньше пользователь должен был сам
   * формулировать «дай резюме» после клика на пресет «Резюме документа» —
   * это сбивало с толку. Теперь preset = system-инструкция + готовая команда
   * в одном клике, юзер может отправить как есть или дополнить.
   */
  userQuery?: string
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
      // Возвращаем точную модель — после fast-пресетов вроде «Краткий ответ».
      model: 'precise',
    },
    builtin: true,
  },
  {
    id: 'summarize-doc',
    label: 'Резюме документа',
    description: 'Сжать включённые документы в 3-5 предложений, не привлекая регламенты.',
    template:
      'РЕЖИМ: резюме документа. Стиль ответа — связный абзац 3-5 предложений, ' +
      'без markdown, без списков. Опирайся ТОЛЬКО на содержимое включённых ' +
      'документов аналитика (блок «=== ДОКУМЕНТЫ АНАЛИТИКА ===» в системе). ' +
      'Не обращайся к регламентам корпуса. ' +
      'Цитируй название файла где это уместно. Если документ пустой или нет ' +
      'осмысленного контента — так и скажи, не выдумывай.',
    userQuery: 'Сделай резюме включённых документов: что в них главное, какие основные разделы и выводы.',
    effects: {
      disable_all_regulations: true,
      temperature: 0.2,
      max_tokens: 400,
      num_ctx: 8192,
    },
    builtin: true,
  },
  {
    id: 'extract-params',
    label: 'Извлечь параметры',
    description: 'Найти числовые параметры с допусками в текстах документов или регламентов.',
    template:
      'РЕЖИМ: извлечение параметров. Формат ответа — список:\n' +
      '«• имя_параметра = ref ± deviation ед.изм (источник: ...)».\n' +
      'Если допуска нет — пиши только значение. Не выдумывай числа: только те, ' +
      'что явно указаны в текстах. Если параметров не найдено — так и скажи.',
    userQuery: 'Найди все числовые параметры с допусками в подключённых документах и регламентах.',
    effects: {
      temperature: 0.0,
      max_tokens: 600,
      num_ctx: 4096,
      model: 'fast',
    },
    builtin: true,
  },
  {
    id: 'compare-regs',
    label: 'Сравнить регламенты',
    description: 'Найти расхождения параметров в нескольких регламентах одного домена.',
    template:
      'РЕЖИМ: сравнение регламентов. Покажи где значения совпадают, где расходятся, ' +
      'есть ли явные противоречия (одно ограничение строже другого). ' +
      'Цитируй id регламента и конкретное значение. ' +
      'Без markdown — связным текстом или короткой таблицей.',
    userQuery: 'Сравни параметры включённых регламентов: совпадения, расхождения, противоречия.',
    effects: {
      temperature: 0.1,
      max_tokens: 800,
      num_ctx: 8192,
    },
    builtin: true,
  },
  {
    id: 'concise',
    label: 'Краткий ответ',
    description: 'Сжатый стиль ответа — одно-два предложения. Подходит к любому вопросу.',
    template:
      'СТИЛЬ: отвечай ОДНИМ-ДВУМЯ предложениями. Без списков, без markdown, без ' +
      'преамбулы. Если у вопроса нет короткого ответа — кратко скажи, чего не хватает.',
    // userQuery нет — этот пресет меняет только стиль будущих ответов;
    // конкретный вопрос придумывает пользователь.
    effects: {
      temperature: 0.1,
      max_tokens: 200,
      num_ctx: 4096,
      model: 'fast',
    },
    builtin: true,
  },
  {
    id: 'regulation-candidates',
    label: 'Текст для регламента',
    description:
      'Найти в документе отрывки с числовыми параметрами, пригодные для оцифровки в регламент.',
    template:
      'РЕЖИМ: поиск отрывков-кандидатов в регламент. Опирайся ТОЛЬКО на включённые ' +
      'документы аналитика. Найди фрагменты текста с числовыми параметрами, ' +
      'допусками, порогами, условиями.\n\n' +
      'Для каждого отрывка выведи структуру:\n' +
      '┌ Цитата: «<дословный фрагмент 1-3 предложения из документа>»\n' +
      '├ Параметры:\n' +
      '│   • <имя> = <значение> ± <допуск> <ед.изм>\n' +
      '│   • <имя> ≥ <значение> <ед.изм>\n' +
      '├ Возможное название регламента: «...»\n' +
      '└ Источник: <название файла>, секция (если видно)\n\n' +
      'Игнорируй вступления, оглавления, общие фразы без чисел. Если в тексте ' +
      'нет таких отрывков — так и скажи, не выдумывай числа.',
    userQuery: 'Найди в моих документах фрагменты с числовыми параметрами, которые можно оцифровать в регламент.',
    effects: {
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
