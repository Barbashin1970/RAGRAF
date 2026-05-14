# RAGRAF Design System

Конвенции визуального оформления и UI-примитивы. Цель — узнаваемый
enterprise-tool feel (Camunda Cockpit / Linear / Notion influences), а не
«AI-игрушка».

## 1. Архитектурные слои и цвета

Каждый экран принадлежит **одному из трёх слоёв** архитектуры (см. BACKLOG →
Author/Execute split). Слой определяет акцентный цвет:

| Слой | Что это | Tone | Hex | Использование |
|---|---|---|---|---|
| **Author Layer** | ИИ-помощник аналитика | `author` | `#6B46C1` (violet) | Студия аналитика (`/sandbox`) — чат, extractor, поиск |
| **Model Layer** | Структурированные данные | `primary` | `#2C7A7B` (teal) | Регламенты, Граф связей — `/regulations`, `/graph` |
| **Execute Layer** | Runtime, без ИИ | `execute` | `#3182CE` (blue) | Исполнение (будущее) — симулятор, датчики, webhooks |

**Domain-цвета** на карточках регламентов (heating=orange, housing=blue,
safety=rose, environment=emerald) — **семантические**, оставляем как есть.

**Status-цвета** (помимо тонов слоёв):

| Tone | Когда | Где |
|---|---|---|
| `success` (emerald) | положительное / активное | «RAGU подключён», «v1.2 published», «in service» |
| `warning` (amber) | внимание / draft | «mock-режим», «draft», «требует подтверждения» |
| `danger` (rose) | критично / blocked | «archived», «conflict», «error» |
| `info` (sky) | справочное | подсказки, гиперссылки на доки |
| `neutral` (stone) | мета-инфо | id, count, тип |

## 2. UI-примитивы

Все импортируются из `@/components/ui`:

```tsx
import { Badge, Button, EmptyState, PageHeader, PageShell, PageBody, Section, Tabs } from '@/components/ui'
```

### `<PageShell>` + `<PageBody>`

Корневой контейнер любого основного экрана. PageShell задаёт высоту, фон,
overflow. PageBody — scroll-зона с опциональным padding'ом и center-ограничением.

```tsx
<PageShell>
  <PageHeader ... />
  <PageBody>
    <Section title="..."> ... </Section>
  </PageBody>
</PageShell>
```

### `<PageHeader>`

Единая шапка страницы. Иконка + title + бейджи + description + actions-slot
справа. `tone` определяет цвет рамки иконки.

```tsx
<PageHeader
  icon={Beaker}
  tone="author"
  title="Студия аналитика"
  description="ИИ-помощник для разбора документов..."
  badges={
    <>
      <Badge tone="success" dot>RAGU подключён</Badge>
      <Badge tone="author" uppercase>Author Layer</Badge>
    </>
  }
  actions={<Button variant="secondary" icon={<Lightbulb size={14} />}>Бэклог</Button>}
/>
```

### `<Section>`

Bordered-карточка для группировки контента. Заголовочная полоска появляется
если передан `title`. Под заголовком — `description`, справа от заголовка —
`actions`.

```tsx
<Section title="Параметры" actions={<Button size="sm">Добавить</Button>}>
  ...
</Section>
```

`flush={true}` — без padding'а внутри (для таблиц). `elevated={true}` — с тенью.

### `<Button>`

Шесть вариантов: `primary | secondary | ghost | danger | author | execute`.
Размеры: `sm | md`.

```tsx
<Button variant="primary" icon={<Save size={14} />}>Сохранить</Button>
<Button variant="secondary">Отмена</Button>
<Button variant="danger" loading={del.isPending} icon={<Trash2 size={14} />}>Удалить</Button>
<Button variant="author" icon={<Wand2 size={14} />}>Извлечь</Button>
```

Выбор варианта по семантике:
- **primary** — главное действие на странице (одно на форму): Сохранить, Создать
- **secondary** — отмена, вторичные действия
- **ghost** — плотный тулбар, action-кнопки в editor'ах
- **danger** — Удалить, Сбросить, любое необратимое
- **author** — ИИ-действие в Студии: Найти, Извлечь, Спросить
- **execute** — runtime-действие в Исполнении: Симулировать, Подключить (будущее)

### `<Badge>`

Inline-бейдж для статусов / тегов / мета-инфо. Тона перечислены в §1.

```tsx
<Badge tone="success" dot>активен</Badge>
<Badge tone="warning">draft</Badge>
<Badge tone="neutral">3 параметра</Badge>
<Badge tone="author" uppercase>Author Layer</Badge>
```

### `<Tabs>`

Горизонтальные табы для секций с режимами. `tone` синхронизируется со слоем
экрана: внутри Студии активный таб — violet, внутри Регламентов — teal.

```tsx
<Tabs
  tabs={[
    { id: 'search', label: 'Диалог с RAGU', icon: MessageSquare },
    { id: 'extract', label: 'Извлечь параметры', icon: Wand2 },
  ]}
  active={tab}
  onChange={setTab}
  tone="author"
/>
```

### `<EmptyState>`

Унифицированное «нет данных». Иконка + title + description + action.

```tsx
<EmptyState
  icon={Inbox}
  title="Регламентов пока нет"
  description="Создай первый регламент из шаблона домена."
  action={<Button variant="primary" icon={<Plus size={14} />}>Новый регламент</Button>}
/>
```

`bare={true}` — без рамки (когда уже внутри Section).

## 3. Конвенции

- **Никаких прямых `bg-violet-*` / `bg-stone-*` в продуктовом коде.** Только
  через ui-примитивы или семантические токены Tailwind (`bg-primary`,
  `bg-surface`).
- **Одна primary-кнопка на форму.** Если хочется две — одна primary, остальные
  secondary.
- **Иконки lucide-react, размер `size={14}` для md, `size={12}` для sm.**
  Не смешивать с emoji в одном action.
- **Заголовки на русском, code/id на английском.** «Регламенты» / `pressure-diameter`.
- **Спейсинг — кратно 4px (Tailwind units по умолчанию).** Никаких px-нестандартов.
- **Текст:**
  - `text-2xl font-semibold` — H1 страницы (в PageHeader)
  - `text-sm font-semibold` — H2 в Section (через `title` prop)
  - `text-sm` — основной body
  - `text-xs text-stone-500` — description, мета-инфо
  - `text-[10px]` — overlines, code-аннотации

## 4. Migration status

| Экран | Статус | Заметка |
|---|---|---|
| SandboxScreen | ✅ migrated | Reference |
| RegulationList | ⏳ pending | Phase 1.5 |
| RegulationEditorScreen | ⏳ pending | Phase 1.5 |
| FlowEditorScreen | ⏳ pending | Phase 1.5 |
| ConstraintEditorScreen | ⏳ pending | Phase 1.5 |
| GraphView | ⏳ pending | Phase 1.5 |
| SandboxBacklog | ⏳ pending | Phase 1.5 |
| CreateRegulationDialog | ⏳ pending | Phase 1.5 |
