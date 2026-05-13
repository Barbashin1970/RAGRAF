# SKILL.md — RAGRAF Skills Catalog

Этот файл — живой каталог навыков и референсов, который используется при разработке проекта **RAGRAF**. Каждый навык описывает: что это, где брать референс, как применить здесь. Полная спецификация продукта — в [regulation-viz-skill.md](regulation-viz-skill.md). API контракт upstream — в разделе **Upstream API** ниже.

---

## Fixtures (калибровочные данные из Rules-Management.pdf)

В `backend/data/fixtures/` лежат реальные данные из PDF корня проекта. Они используются как:
- образец схемы реального upstream-контента,
- локальный fallback (по умолчанию `USE_FIXTURES=true` в `.env.example`),
- стартовая нагрузка для UI: при открытии `/regulations/pressure-diameter/flow` редактор покажет преднастроенный Rule DSL.

Реестр: см. [`backend/data/fixtures/INDEX.md`](backend/data/fixtures/INDEX.md). Регулируется `app/services/fixtures.py` (просто словарь `REGISTRY`).

**Реальная схема Turtle:** параметры — плоские scalar-свойства `:Regulation`-инстанса (`:pressure 20.5 ; :pressureDeviation 1.5`), а не отдельные `:Parameter` сущности. Парсер в `turtle_bridge.parse_regulation_turtle()` это учитывает: пары `<param> + <param>Deviation` → `Parameter(referenceValue, deviationAllowed)`, плюс bounds из SHACL-shape подмешиваются через аргумент `shapes_turtle`.

---

## Upstream API (Regulation Management)

База: `http://109.202.1.153:8958`. Документация: `/docs`. OpenAPI: `/openapi.json`.

Реальная поверхность (FastAPI 0.1.0):

| Метод | Путь | Тело / Ответ | Назначение |
|-------|------|--------------|------------|
| `GET` | `/api/v1/regulations/{source_id}/data` | `text/plain` (Turtle) | Получить регламенты |
| `POST` | `/api/v1/regulations/{source_id}/data` | body `text/plain` | Добавить регламенты |
| `PUT` | `/api/v1/regulations/{source_id}/data` | body `text/plain` | Обновить регламенты |
| `DELETE` | `/api/v1/regulations/{source_id}/data` | — | Очистить регламенты |
| `GET` | `/api/v1/regulations/{source_id}/shapes` | `text/plain` | SHACL shapes (валидация) |
| `POST/PUT/DELETE` | `/api/v1/regulations/{source_id}/shapes` | `text/plain` | Управление shapes |
| `GET` | `/api/v1/regulations/admin/datasets/` | JSON | Список датасетов |
| `POST` | `/api/v1/regulations/admin/datasets/{app_id}` | — | Создать датасет |

Ключевая особенность: регламенты — это **сырой Turtle**, а не JSON. Парсинг → домен делается на нашей стороне через `rdflib`.

---

## Skill: Drag-and-Drop палитры узлов на canvas

**Применение в RAGRAF:** перетаскивание типов узлов (`input`, `threshold`, `compare`, ...) из `NodePalette` на канвас Rule Flow Editor.

**Технология:** React Flow использует **нативный HTML5 drag-and-drop**, не `@dnd-kit`. Это его собственный паттерн (см. `onDragOver`, `onDrop` на `ReactFlow`).

```tsx
// Palette item
<div
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData('application/reactflow-type', 'threshold')
    e.dataTransfer.effectAllowed = 'move'
  }}
>Порог</div>

// Canvas
<ReactFlow
  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
  onDrop={(e) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/reactflow-type')
    const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode({ id: nanoid(), type, position: pos, data: {} })
  }}
/>
```

**Референс для DnD списков (constraint table reordering, version history reordering):** LEYKA Kanban — `~/LEYKA/frontend/src/components/Kanban/Board.tsx`. Использует `@dnd-kit/core` + `@dnd-kit/sortable`, оптимистичные мутации с rollback (см. `moveMutation` с `onMutate` / `onError`). Этот паттерн стоит копировать для пере-упорядочивания строк в Constraint Editor — но **не** для палитры nodes (там React Flow родной).

---

## Skill: React Flow custom nodes

**Применение:** 7 типов узлов из таблицы Node Types в [regulation-viz-skill.md](regulation-viz-skill.md). Каждый — отдельный React-компонент с `Handle` и форма свойств в правой панели.

Каждый node-компонент: `({ id, data, selected }) => JSX`, регистрируется в `nodeTypes` объекте `<ReactFlow nodeTypes={...} />`. Цвета из `regulation-viz-skill.md` § Design System. Кастомные handles через `<Handle type="source|target" position={Position.Right|...} />`.

---

## Skill: Cytoscape.js graph view

**Применение:** Graph View (`/graph`) — обзорная карта регламентов и связей.

Инициализация: `cytoscape({ container, elements: { nodes, edges }, layout: { name: 'cola' }, style: [...] })`. Слой `cytoscape-cola` для force-directed layout. Цвета классов узлов — см. § Design System в спеке.

Для интеграции в React: `useRef` для контейнера, инициализация в `useEffect`, обновление `cy.json({ elements })` при изменении данных, `cy.on('tap', 'node', ...)` для side-panel.

---

## Skill: SHACL Bridge (Python)

**Применение:** конвертация наших `Constraint` объектов в SHACL Shapes и обратно. Экспорт `.ttl` файлов, импорт SHACL-документов.

Стек: `rdflib==7.x` (graph, namespaces, serialization) + `pyshacl==0.x` (валидация). Маппинг см. § SHACL Bridge в спеке. Namespaces: `SH = http://www.w3.org/ns/shacl#`, `REG = http://regulations.local/ontology#`.

**Особенность:** наш SHACL пишется в upstream через `POST/PUT /api/v1/regulations/{source_id}/shapes` — сырой Turtle text/plain. То есть наш экспорт — это и есть upstream-формат, никаких трансформаций по дороге не нужно.

---

## Skill: RAGU GraphRAG integration

**Применение:** фоновый сервис для (1) построения графа знаний из текстов регламентов, (2) семантического поиска, (3) извлечения сущностей и связей.

Установка: `pip install graph_ragu`. Импорты:

```python
from ragu import KnowledgeGraph, BuilderArguments, Settings
from ragu.models.llm import LLMOpenAI
from ragu.models.embedder import EmbedderOpenAI
from ragu.graph.graph_index import Entity, Relation
from ragu.search_engine import LocalSearchEngine, GlobalSearchEngine, NaiveSearchEngine
```

`Settings.language = "russian"`. Storage folder — изолируем для проекта (`./ragu_regulations_graph`).

Домен: subclass `Entity` → `RegulationEntity` (с `regulation_id`, `parameter_name`, `threshold`); `Relation` → `ConstraintRelation` (с `condition_type`, `severity`).

Для трансформации в Cytoscape JSON — отдельный adapter (см. [regulation-viz-skill.md](regulation-viz-skill.md) § RAGU Integration).

---

## Skill: FastAPI layout

**Референс:** `~/LEYKA/backend/app/`. Структура:

```
backend/app/
├── api/         # routers по доменам
├── services/    # бизнес-логика, ходят в upstream / в graph
├── schemas/     # pydantic request/response
├── domain/      # внутренние типы (Regulation, RuleDSL, ...)
└── main.py
```

Стек: `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `httpx` (для upstream), `rdflib`, `pyshacl`, `networkx`, `graph_ragu`.

Запуск: `uvicorn app.main:app --reload --port 8000`.

---

## Skill: React + Vite + Tailwind scaffold

**Референс:** `~/LEYKA/frontend/`. Стек (см. `package.json`):

```
react@18, react-flow@11, cytoscape@3, cytoscape-cola
@tanstack/react-query, zustand, tailwindcss@4
lucide-react, @dnd-kit/* (опционально для constraint table)
react-router-dom
```

Структура — см. § Frontend Stack → Project structure в спеке.

Запуск: `npm run dev` (Vite на `:5173`).

---

## Skill: Rule DSL ↔ React Flow serialization

**Применение:** `lib/rulesDsl.ts` на фронте — конвертация между Rule DSL JSON и `{ nodes, edges }` React Flow.

```ts
// DSL → React Flow
export function dslToFlow(dsl: RuleDSL): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: dsl.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      data: { ...n },
    })),
    edges: dsl.edges.map(e => ({
      id: `${e.source}__${e.target}`,
      source: e.source,
      target: e.target,
      data: { condition: e.condition },
    })),
  }
}
```

Layout: если у DSL nodes нет `position`, прогоняем через `dagre` или ELK (`elkjs`) при первой загрузке.

---

## Skill: Optimistic mutations с react-query

**Референс:** LEYKA `Board.tsx` — `moveMutation`. Паттерн:

```ts
useMutation({
  mutationFn: () => api.flow.save(id, dsl),
  onMutate: async (newDsl) => {
    await qc.cancelQueries({ queryKey })
    const prev = qc.getQueryData(queryKey)
    qc.setQueryData(queryKey, newDsl)
    return { prev }
  },
  onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(queryKey, ctx.prev),
  onSettled: () => qc.invalidateQueries({ queryKey }),
})
```

Применяем для: сохранения flow, переключения статуса regulation, реордеринга constraint.

---

## Skill: Versioning / immutable snapshots

**Применение:** при каждом `PUT /flow` создаём `FlowVersion` snapshot. Хранение — JSON-файлы на FS (на старте), потом PostgreSQL (`flow_versions` table).

Старт: `backend/data/versions/{regulation_id}/{version_id}.json`. Версия — UUID + ISO timestamp + автор + diff_summary (можно сгенерировать diff между предыдущей и текущей DSL: добавлены/удалены/изменены nodes/edges).

---

## Implementation Order (cross-link)

См. § Implementation Order в [regulation-viz-skill.md](regulation-viz-skill.md). По мере прохождения шагов — добавляй сюда новые навыки (например: «Skill: Dagre auto-layout для DSL без позиций», «Skill: SHACL conflict report при импорте»).
