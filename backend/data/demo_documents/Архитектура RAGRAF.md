# ARC.md — Архитектура системы RAGRAF

> **RAGRAF** · *Regulation Authoring with Graph-RAG, Author Framework*
> Рабочая станция аналитика-методолога для оцифровки нормативных актов
> в машиноисполняемые цифровые регламенты. Компонент «среды разработки»
> фреймворка СИГМА (НГУ ЦИИ).
>
> **Версия документа:** 1.0 · **Дата:** 2026-05-15
> **Статус:** active · **Запуск:** локально (single-user)

[![Backend tests](https://img.shields.io/badge/backend%20tests-82%20passing-brightgreen)]()
[![Frontend tests](https://img.shields.io/badge/frontend%20tests-44%20passing-brightgreen)]()
[![Frontend typecheck](https://img.shields.io/badge/frontend-typecheck%20clean-brightgreen)]()
[![sigma-audit](https://img.shields.io/badge/sigma--audit-0%20violations-brightgreen)]()
[![LOC](https://img.shields.io/badge/LOC-~11k-blue)]()
[![Storage](https://img.shields.io/badge/storage-DuckDB%20embedded-blue)]()

---

## 📑 Оглавление

1. [Обзор системы](#1-обзор-системы)
2. [Слоистая архитектура](#2-слоистая-архитектура)
3. [Author / Model / Execute split](#3-author--model--execute-split)
4. [Доменная модель](#4-доменная-модель)
5. [Жизненный цикл регламента](#5-жизненный-цикл-регламента)
6. [Rule DSL Flow — визуальный редактор логики](#6-rule-dsl-flow--визуальный-редактор-логики)
7. [ИИ-стек: Ollama + RAGU](#7-ии-стек-ollama--ragu)
8. [Извлечение параметров из текста](#8-извлечение-параметров-из-текста)
9. [Версионирование и история правок](#9-версионирование-и-история-правок)
10. [Хранилище данных](#10-хранилище-данных)
11. [API-контракт](#11-api-контракт)
12. [Деплой и инфраструктура](#12-деплой-и-инфраструктура)
13. [Метрики проекта](#13-метрики-проекта)
14. [Тестовая стратегия](#14-тестовая-стратегия)
15. [ADR — принятые архитектурные решения](#15-adr--принятые-архитектурные-решения)
16. [Дальнейшее развитие](#16-дальнейшее-развитие)
17. [Ссылки](#17-ссылки)

---

## 1. Обзор системы

### 1.1 High-level диаграмма

```mermaid
flowchart TB
  subgraph WS["💻 Рабочая станция аналитика (M2 16ГБ / x86_64 Linux)"]
    UI["🌐 Frontend (SPA)<br>React 18 · TypeScript · Vite<br>TanStack Query · Zustand · Tailwind<br>React Flow · Cytoscape · lucide-react"]
  end

  subgraph BE["⚙ Backend (локально, :8000)"]
    API["Python 3.12 · FastAPI 0.115<br>Pydantic 2.9 · DuckDB 1.2<br>rdflib · pyshacl · networkx · httpx<br>uvicorn --reload"]
  end

  subgraph STORE["💾 Хранилище (embedded)"]
    DUCK[("DuckDB<br>backend/data/regulations.duckdb<br>WAL durability")]
    FX["📂 Фикстуры<br>backend/data/fixtures/*.ttl<br>6 эталонных регламентов<br>(сидинг при пустой БД)"]
  end

  subgraph AI["🧠 ИИ-стек (опционально, локально)"]
    OL["🦙 Ollama :11434<br>qwen2.5:7b-instruct-q4_K_M<br>bge-m3 (мультиязычный эмбеддер)"]
    RAGU["📚 graph_ragu 0.0.2<br>KnowledgeGraph · LocalSearchEngine<br>ArtifactsExtractorLLM"]
  end

  subgraph EXT["🌍 Внешние (опционально)"]
    UP["🔗 Regulation API upstream<br>(прокси через regulation_client.py)"]
  end

  UI -->|HTTP same-origin :8000| API
  API <-->|read/write SQL| DUCK
  DUCK -.->|seed if empty| FX
  API -.->|OpenAI-совместимый API| OL
  API -.->|GraphRAG retrieval| RAGU
  RAGU -.-> OL
  API -.->|fallback| UP
```

### 1.2 Ключевые свойства

| Свойство              | Значение                                              | Обоснование                                                              |
|-----------------------|-------------------------------------------------------|--------------------------------------------------------------------------|
| **Local-first**       | Запуск одной командой на ноутбуке; нет облака         | Среда разработки СИГМА §1; pilot demo без поднятия Postgres/K8s/MinIO     |
| **Single-user**       | Один аналитик-методолог, нет concurrent writes        | DuckDB single-writer; multi-user не входит в роль 4.3.1 ТЗ СИГМА          |
| **Embedded storage**  | DuckDB файл, без сервера БД                           | OLAP-оптимизация под read-heavy редактор; миграция на Postgres документирована (см. §10.4) |
| **Optional LLM**      | Без Ollama / RAGU функциональность не блокируется     | Graceful fallback: regex для extract, TF-IDF для search, шаблонный chat   |
| **Type-safe domain**  | Pydantic 2 backend ↔ TypeScript interfaces frontend   | Единая Regulation-модель через `frontend/src/lib/api.ts`                  |
| **Sigma-clean**       | Все правки CST-проверяются `sigma-audit`              | Нулевая когнитивная сложность в hot paths; см. ADR-008                    |

### 1.3 Что система НЕ делает

- ❌ Не исполняет регламенты в runtime (Execute Layer — out of scope, реализуется ядром СИГМА).
- ❌ Не принимает события из городских подсистем (ETL — функция платформенного контура).
- ❌ Не отправляет уведомления в Telegram / email (реализуется ядром СИГМА §4.2.1).
- ❌ Не хранит дашборды диспетчера и руководителя (роли 4.3.2 / 4.3.3 ТЗ СИГМА — out of scope).
- ❌ Не работает с облачными LLM-API (только локальная Ollama; см. ADR-005).
- ❌ Не поддерживает concurrent multi-user (см. условия миграции — §10.4).

---

## 2. Слоистая архитектура

### 2.1 Backend (Python · FastAPI · DuckDB)

```mermaid
flowchart TB
  subgraph ENTRY["🚪 Точка входа"]
    MAIN["app/main.py<br>FastAPI · CORS · lifespan<br>init_db (seed if empty)<br>Mount routers"]
  end

  subgraph ROUTERS["📡 API routers · app/api/*.py · 9 модулей"]
    R1["regulations.py<br>/regulations CRUD + raw + history + diff + restore + publish + archive + delete"]
    R2["datasets.py<br>/datasets (прокси на regulation_client)"]
    R3["flow.py · versions.py<br>/flow/{id} · /flow/{id}/validate · /flow/{id}/history · /flow/{id}/restore"]
    R4["shacl.py<br>/constraints/{id} GET/PUT + /constraints/{id}/shapes import/export"]
    R5["graph.py<br>/graph/{domain?} (Cytoscape payload)"]
    R6["sandbox.py<br>/sandbox/status · /chat · /search · /extract-parameters · /create-from-params · /llm-info"]
    R7["search.py · validate.py<br>(вспомогательные эндпоинты)"]
  end

  SCHEMAS["📦 Schemas · app/schemas/domain.py (Pydantic v2)<br>Regulation · Parameter · Constraint · Recommendation<br>RuleDSL · FlowNode · FlowEdge<br>FlowVersion · CyNode · CyEdge · GraphPayload<br>SearchRequest/Response · ValidationError/Result"]

  subgraph SERVICES["🔧 Services · app/services/*.py · 11 модулей"]
    S1["regulation_store.py<br>DuckDB CRUD + history snapshots<br>+ RLock для reentrant save"]
    S2["regulation_client.py<br>Прокси на upstream API<br>(fallback на store)"]
    S3["regulation_diff.py<br>Структурный diff между snapshot-ами<br>(changed/added/removed)"]
    S4["flow_storage.py<br>RuleDSL JSON в отдельной таблице<br>+ history versions"]
    S5["sandbox.py<br>extract_parameters (regex + 3-tier naming)<br>+ semantic_search (TF-IDF fallback)<br>+ chat (LLM-grounded ответ)"]
    S6["embedding_index.py<br>In-memory bge-m3 индекс<br>+ batched rebuild (sigma-audit P8)"]
    S7["ragu_service.py<br>graph_ragu обёртка<br>(KnowledgeGraph + LocalSearchEngine)"]
    S8["turtle_bridge.py<br>Regulation ↔ Turtle ↔ SHACL<br>(rdflib + pyshacl)"]
    S9["validator.py<br>Rule DSL валидация<br>(connected components, paramRef, циклы)"]
    S10["graph_builder.py<br>Сборка Cytoscape-графа из корпуса<br>(networkx)"]
    S11["templates.py · fixtures.py<br>Шаблоны для create-from-params<br>+ seed данные из Turtle"]
  end

  subgraph LOWER["💾 Низкоуровневое"]
    DB[("DuckDB<br>regulations · parameters<br>regulation_history · flow_versions")]
    CFG["⚙ config.py · pydantic-settings<br>RAGU_ENABLED · RAGU_LLM_MODEL<br>OPENAI_BASE_URL · USE_FIXTURES"]
    ADAPT["🔌 adapters/cytoscape_adapter.py<br>Regulation → CyNode/CyEdge"]
  end

  MAIN --> ROUTERS
  ROUTERS --> SCHEMAS
  ROUTERS --> SERVICES
  SCHEMAS --> SERVICES
  SERVICES --> DB
  SERVICES --> ADAPT
  SERVICES --> CFG
```

**Правило слоёв:** стрелки зависимостей идут только **вниз**. Routers зовут services; services пишут в DuckDB через `regulation_store`. Любая бизнес-логика, которая нужна в нескольких routers, выносится в `services/` или `adapters/` — никогда напрямую из роутера в DuckDB.

### 2.2 Frontend (React 18 · TypeScript · TanStack Query · Zustand)

```mermaid
flowchart TB
  APP["🚪 src/App.tsx<br>Router (react-router-dom)<br>5 routes: /sandbox · /regulations · /regulations/:id/* · /graph · /sandbox/backlog"]

  subgraph SCREENS["📺 Screens (по доменам)"]
    SC1["SandboxScreen · студия аналитика<br>(Author Layer, violet)<br>Tabs: search · extract"]
    SC2["RegulationList · карта корпуса<br>(Model Layer, teal)"]
    SC3["RegulationEditorScreen · 3 вкладки<br>Поля / Слайдеры / Turtle"]
    SC4["FlowEditorScreen · Node-RED-style<br>палитра + canvas + PropertyPanel"]
    SC5["ConstraintEditorScreen · SHACL<br>таблица + import/export"]
    SC6["GraphView · Cytoscape<br>full-bleed canvas + sidebar деталей"]
    SC7["SandboxBacklog · roadmap UI"]
  end

  subgraph COMP["🧩 Components (по доменам)"]
    C1["regulations/ · CreateDialog · Header (shared tabs)"]
    C2["sandbox/ · SearchDemo · ChatDemo · ExtractDemo<br>· BuildRegulationPanel · LLMStatusBar · PresetGallery"]
    C3["flow/ · NodePalette · FlowCanvas · PropertyPanel<br>· nodes/BaseNode + 7 типов"]
    C4["constraints/ · ConstraintEditor + Cell helpers"]
    C5["graph/ · GraphView + node-detail aside"]
  end

  subgraph UI["🎨 UI primitives · components/ui/"]
    UI1["PageShell · PageBody · PageHeader · Section<br>Button (6 variants) · Badge (7 tones)<br>Tabs · EmptyState"]
  end

  subgraph API["🌐 API layer · src/lib/"]
    AP1["api.ts<br>typed fetch + Regulation interface<br>+ NODE_KIND_META (Flow icons)"]
    AP2["cn.ts · nanoid.ts · domains.ts<br>· rulesDsl.ts · sliderDomain.ts<br>· cytoscape-cola-types.ts"]
  end

  STORE["💾 Stores · src/store/<br>flowStore.ts (Zustand + persist)<br>· errorsByNode · globalErrors"]

  APP --> SCREENS
  SCREENS --> COMP
  SCREENS --> UI
  COMP --> UI
  COMP --> API
  COMP --> STORE
  SCREENS --> API
  API --> STORE
```

**Правило компонентов:** screens живут в `src/components/<domain>/<Screen>.tsx`, primitives — в `src/components/ui/`. Никакого прямого `bg-violet-*` / `bg-stone-*` в продуктовом коде — только через `<Button>` / `<Badge>` / семантические Tailwind-токены (см. [DESIGN_SYSTEM.md](frontend/DESIGN_SYSTEM.md)).

### 2.3 Стратегия мутаций: react-query + optimistic в Flow Editor

Большинство мутаций RAGRAF идут через стандартный `useMutation({ mutationFn, onSuccess: invalidate })` — нет облака между UI и backend, RTT 1–5 мс по localhost, perceived latency и так нулевая. Optimistic updates применяются **точечно**, только там где локальный state в react-flow или редакторе:

- **Flow Editor** ([FlowEditorScreen.tsx](frontend/src/components/flow/FlowEditorScreen.tsx)) — узлы/рёбра живут в локальном `useState`, save идёт всем DSL в `POST /flow/{id}`. Между правкой и сохранением аналитик видит результат мгновенно; refetch на success обновляет `last_saved_version_id` в HistoryPanel.
- **Regulation Form** ([RegulationEditorScreen.tsx](frontend/src/components/regulations/RegulationEditorScreen.tsx)) — draft хранится в локальной копии `Regulation`, dirty-tracking через сравнение JSON. Save отправляет весь draft; на success — invalidate `['regulation', id]` + `['regulation-history', id]` + `['datasets']`.

**Когда NOT optimistic:** для создания / удаления (DELETE регламента, POST новой версии Flow) — стандартный flow `mutate → wait → invalidate → refetch`, потому что эти операции структурно меняют список и optimistic-вставка с временным UUID не окупается на single-user-нагрузке.

---

## 3. Author / Model / Execute split

Архитектурная программа RAGRAF (см. [BACKLOG.md § Author/Execute split](docs/BACKLOG.md)) — разделение функциональности на три слоя по типу обработки и стоимости:

```mermaid
%%{init: {'theme':'neutral', 'themeVariables': {'fontSize': '15px'}, 'flowchart':{'nodeSpacing': 32, 'rankSpacing': 70, 'padding': 14, 'subGraphTitleMargin': {'top': 18, 'bottom': 18}}}}%%
flowchart TD
  subgraph AUTHOR["🟪 Author Layer · violet #6B46C1"]
    direction TB
    A1["Студия аналитика /sandbox<br>· Локальная LLM (chat с RAGU-retrieval)<br>· Семантический поиск по корпусу<br>· RAGU Studio (override 18 промптов)"]
    A2["Извлечение параметров /regulations/new-from-text<br>· Rules-based regex + словарь<br>· Predicted_domain · CRUD словаря"]
    A3["LLM-инфраструктура<br>· Ollama qwen2.5:7b<br>· bge-m3 эмбеддер<br>· graph_ragu LocalSearchEngine"]
  end

  subgraph MODEL["🟢 Model Layer · teal #2C7A7B"]
    direction TB
    M1["Регламенты /regulations<br>· Поля / Слайдеры / Turtle<br>· Flow Editor (Rule DSL · 8 типов узлов)<br>· SHACL Constraints · Граф связей"]
    M2["Библиотека датчиков /sensors<br>· Классы → подтипы → поля payload<br>· 22 подтипа · 282 поля (CRUD)"]
    M3["Хранилище<br>· DuckDB (Pydantic-домен)<br>· Turtle/SHACL/JSON export · SIGMA-bundle<br>· История версий + diff · PROV-O"]
  end

  subgraph EXECUTE["🔵 Execute Layer · blue #3182CE"]
    direction TB
    E1["Симулятор /execute<br>· POST /api/regulations/{id}/execute<br>· Пресеты · подсветка fired-пути<br>· Trace + level + recommendation"]
    E2["Sensor binding<br>· Sensor-нода в Flow Editor<br>· bindsTo автозаполнение<br>· 3 стратегии резолва readings"]
    E3["Приёмник событий СИГМЫ<br>⏳ /api/events/ingest — в бэклоге<br>⏳ Журнал срабатываний — в бэклоге<br>⏳ Webhook-actions на OUTPUT"]
  end

  AUTHOR -->|"Производит<br>(редко, дорого ~30с/инференция)"| MODEL
  MODEL -->|"Питает<br>(часто, ~10мс на матч)"| EXECUTE

  classDef author fill:#F3E8FF,stroke:#6B46C1,stroke-width:2px,color:#1f2937
  classDef model fill:#E6FFFA,stroke:#2C7A7B,stroke-width:2px,color:#1f2937
  classDef execute fill:#EBF8FF,stroke:#3182CE,stroke-width:2px,color:#1f2937
  class A1,A2,A3 author
  class M1,M2,M3 model
  class E1,E2,E3 execute
```

**Семантика разделения:**

| Аспект                  | Author Layer                              | Model Layer                              | Execute Layer                    |
|-------------------------|-------------------------------------------|------------------------------------------|----------------------------------|
| **Кто использует**      | Аналитик-методолог                        | Аналитик + (в будущем) оператор          | Runtime СИГМА / симулятор        |
| **Частота**             | Редко (создание/обновление регламента)    | Часто (просмотр/правка)                  | На каждое событие                |
| **Стоимость одной операции** | ~30 с (LLM-инференция) или ~5 мс (rules-based) | ~1–10 мс (DuckDB read/write)        | ~10 мс (детерминированный матч)  |
| **Технологии**          | Ollama · qwen2.5:7b · bge-m3 · RAGU · regex+dictionary | DuckDB · Pydantic · rdflib · React Flow  | flow_executor.py · SensorReading-resolver |
| **Цвет UI**             | violet `#6B46C1`                          | teal `#2C7A7B` (primary)                 | blue `#3182CE`                   |
| **Что в RAGRAF**        | ✅ Реализовано (LLM chat · rules-based extract) | ✅ Реализовано (регламенты + sensor library) | 🟡 Симулятор готов · приёмник СИГМЫ в бэклоге |

Подробнее — [BACKLOG.md → Phase 3 · Execute Layer](docs/BACKLOG.md).

---

## 4. Доменная модель

### 4.1 Сущности и их связи

```mermaid
erDiagram
  REGULATION ||--o{ PARAMETER : "содержит"
  REGULATION ||--o{ CONSTRAINT : "SHACL-ограничения"
  REGULATION ||--o{ RECOMMENDATION : "рекомендация по умолчанию"
  REGULATION ||--o{ REGULATION_HISTORY : "snapshot при save"
  REGULATION ||--o| RULE_DSL : "опциональный Rule Flow"
  RULE_DSL ||--o{ FLOW_NODE : "узлы"
  RULE_DSL ||--o{ FLOW_EDGE : "рёбра"
  RULE_DSL ||--o{ FLOW_VERSION : "snapshot при save"
  PARAMETER ||--o{ FLOW_NODE : "paramRef из INPUT"
  CONSTRAINT ||--o{ FLOW_NODE : "constraintRef из shacl_constraint"

  REGULATION {
    string id PK "напр. heat-inlet-breach"
    string name
    string domain "heating/housing/safety/environment"
    string date "ISO date"
    string version "напр. 1.0"
    enum status "draft/active/archived"
    string source_document "SIGMA §4.1.3 — нормативный акт"
    string source_clause "пункт документа"
    string valid_from "ISO date"
    string valid_to "ISO date"
  }
  PARAMETER {
    string id PK
    string name "camelCase, напр. inletPressure"
    enum datatype "decimal/string/date/boolean"
    float referenceValue
    float deviationAllowed
    string unit "напр. атм, °C, м/с"
    float minInclusive "SHACL-граница"
    float maxInclusive "SHACL-граница"
  }
  CONSTRAINT {
    string id PK
    string path "sh:path"
    enum severity "violation/warning/info"
    float minInclusive
    float maxInclusive
    int minCount
    string pattern "regex"
    string message
  }
  RECOMMENDATION {
    string id PK
    string text "текст рекомендации"
    int priority "1=критический, 2=важный, 3=обычный"
    array linkedParameters
  }
  FLOW_NODE {
    string id PK
    enum type "input/threshold/compare/formula/switch/output/shacl_constraint"
    string label
    object position "x, y"
    string paramRef "FK на parameter"
    float refValue
    float deviation
    string operator "outside_range/inside_range/greater/less/equal"
    string expression "для formula"
    array cases "для switch"
    string text "для output"
  }
  REGULATION_HISTORY {
    string version_id PK
    string source_id FK
    json snapshot "полный model_dump"
    timestamp created_at
    string author
    string comment
  }
  FLOW_VERSION {
    string version_id PK
    string regulation_id FK
    json dsl_snapshot
    timestamp created_at
    string diff_summary
  }
```

### 4.2 Таблицы DuckDB

| Таблица                | Назначение                                                | Ключевые поля                                                              |
|------------------------|-----------------------------------------------------------|----------------------------------------------------------------------------|
| `regulations`          | Карточка регламента (head-таблица)                        | `source_id` PK · `name` · `domain` · `version` · `status` · `recommendation` · `recommendation_priority` · **`source_document`** · **`source_clause`** · **`valid_from`** · **`valid_to`** |
| `parameters`           | Параметры регламента (1:N)                                | `(source_id, id)` PK · `name` · `datatype` · `ref_value` · `deviation` · `unit` · `min_inclusive` · `max_inclusive` · `position` |
| `regulation_history`   | Snapshot-ы при каждом save (полный JSON)                  | `version_id` PK · `source_id` FK · `snapshot` (JSON) · `created_at` · `author` · `comment` |
| `flow_versions`        | История Rule DSL Flow                                     | `version_id` PK · `regulation_id` FK · `dsl_snapshot` (JSON) · `diff_summary` |
| `sensor_subtypes`      | Подтипы датчиков (22 в seed: видеодетекторы Нетрис, Войслинк, DAS, air-варианты) | `subtype_id` PK · `class_id` (= SensorType литерал) · `label` · `description` · `position` |
| `sensor_field_schemas` | Поля payload для каждого подтипа (282 в seed)             | `(subtype_id, field_name)` PK · `datatype` · `unit` · `description` · `required` · `example_value` · `position` |
| `extraction_terms`     | Словарь rules-based извлечения параметров из текста       | `stem` PK · `parameter_name` · `domain` · `unit_hint` · `source` (seed/user) |

**Constraints** (SHACL-ограничения) хранятся не отдельной таблицей, а как Turtle-документ через upstream `regulation_client.constraints_turtle()` или локально через rdflib — это сохраняет round-trip совместимость с внешними SHACL-валидаторами. Парсинг — `parse_shapes_turtle()` в `turtle_bridge.py`.

**Static catalogs (в коде, не в БД):**

| Где                                              | Что                                                                          |
|--------------------------------------------------|------------------------------------------------------------------------------|
| `backend/app/services/sandbox.py · KNOWN_UNITS`  | 15 единиц измерения (атм, °C, м/с, мкг/м³, %, ч, мин, …)                     |
| `backend/app/services/sandbox.py · CONTEXT_NAMES_FALLBACK` | DEPRECATED fallback на случай если DuckDB-словарь недоступен в тестах. Боевой путь — `extraction_terms` таблица |
| `backend/app/services/extraction_term_store.py · SEED_TERMS` | 70+ стартовых терминов извлечения по доменам — heating/housing/safety/environment + общие. Сидятся в `extraction_terms` |
| `backend/app/services/sensor_schema_store.py · SEED_SUBTYPES + SEED_FIELDS` | 22 подтипа датчиков (видеодетекторы Нетрис/Войслинк по PDF-спецификациям 2024, DAS, CO2/PM/NO2). 282 поля payload — ORM-источник правды по person/anpr |
| `backend/data/fixtures/*.ttl`                    | 8 эталонных регламентов (heating, housing, safety, environment + nsu-parking-anpr) — seed |
| `frontend/src/lib/api.ts · NODE_KIND_META`       | 7 типов узлов Rule DSL Flow + sensor → lucide-иконки                         |
| `frontend/src/lib/api.ts · SENSOR_TYPE_META`     | 7 классов датчиков (p/t/flow/noise/detector/fiber/air) + цветовая палитра    |
| `frontend/src/lib/domains.ts`                    | Цветовое кодирование доменов на карточках регламентов                        |

### 4.3 Enum'ы

| Enum                  | Значения                                                                          | Где определён                  |
|-----------------------|-----------------------------------------------------------------------------------|--------------------------------|
| `RegulationStatus`    | `draft` · `active` · `archived`                                                   | `schemas/domain.py`            |
| `ParameterDatatype`   | `decimal` · `string` · `date` · `boolean`                                         | `schemas/domain.py`            |
| `ConstraintSeverity`  | `violation` · `warning` · `info` (UI-тоны: rose / amber / sky)                    | `schemas/domain.py`            |
| `NodeKind`            | `input` · `threshold` · `compare` · `formula` · `switch` · `output` · `shacl_constraint` | `schemas/domain.py`      |
| `RecommendationPriority` | `1` · `2` · `3` (UI: critical / important / normal)                            | `schemas/domain.py`            |
| Domain (slug)         | `heating` · `housing` · `safety` · `environment` (+ extras)                       | `regulation_client.list_domains` |

---

## 5. Жизненный цикл регламента

### 5.1 Статусы регламента

```mermaid
stateDiagram-v2
  direction LR
  [*] --> draft: создание<br>(из шаблона / из текста / импорт Turtle)
  draft --> active: «Опубликовать»<br>(POST /publish)
  active --> draft: правка → save<br>(автоматически возвращает в draft)
  active --> archived: «Архивировать»<br>(POST /archive)
  archived --> draft: восстановление<br>(через UI «Сбросить к версии»)
  draft --> [*]: «Удалить»<br>(DELETE /regulations/{id})
  archived --> [*]

  note right of draft
    Редактируется свободно
    Не виден в Execute-сценариях
  end note
  note right of active
    «Боевая» версия
    Все изменения создают
    новые snapshot-ы в history
  end note
  note right of archived
    Сохраняется для аудита
    Не применяется к новым событиям
  end note
```

### 5.2 История версий

Каждый `POST /regulations/{id}` (save) создаёт новую запись в `regulation_history` с полным JSON-snapshot регламента (Pydantic `model_dump`). Snapshot-ы образуют непрерывную цепочку от seed-версии до текущей.

```mermaid
sequenceDiagram
  autonumber
  actor A as 👤 Аналитик
  participant UI as 🌐 Frontend
  participant BE as ⚙ Backend
  participant ST as 💾 regulation_store
  participant DB as DuckDB

  A->>UI: правит draft (поле name, parameters[3].refValue, ...)
  UI->>UI: dirty=true (сравнение JSON)
  A->>UI: «Сохранить»
  UI->>BE: PUT /regulations/{id} (полный Regulation)
  BE->>ST: store.save(reg, author='anonymous', comment='UI edit')
  ST->>ST: UPSERT regulations head<br>DELETE+INSERT parameters<br>INSERT regulation_history
  ST->>DB: BEGIN TRANSACTION
  DB-->>ST: ok
  ST-->>BE: version_id (uuid4)
  BE-->>UI: 200 + {version: version_id}
  UI->>UI: invalidate ['regulation', id]<br>+ ['regulation-history', id]<br>+ ['datasets']
  UI-->>A: ✓ «Сохранено · версия abc12345»

  Note over ST,DB: regulation_history теперь содержит<br>N+1 snapshot-ов, doff_summary<br>считается между соседними
```

**Diff между версиями** ([regulation_diff.py](backend/app/services/regulation_diff.py)) — структурное сравнение двух snapshot-ов с группировкой изменений по типам:

| Тип изменения | Семантика                                        | UI-индикатор          |
|---------------|--------------------------------------------------|-----------------------|
| `changed`     | Поле существовало, значение изменилось           | `~ before → after` (синяя плашка) |
| `added`       | Новый параметр / constraint / recommendation     | `+ value` (emerald)   |
| `removed`     | Существующий элемент удалён                      | `− value` (rose)      |
| `initial`     | Первая версия (seed) — не с чем сравнивать       | Бейдж «seed» (emerald) |

История + diff отображаются в `HistoryPanel` (правая колонка `RegulationEditorScreen`), любую версию можно восстановить кнопкой «Восстановить».

---

## 6. Rule DSL Flow — визуальный редактор логики

### 6.1 7 типов узлов

Визуальный редактор реализован на React Flow ([FlowEditorScreen.tsx](frontend/src/components/flow/FlowEditorScreen.tsx)). Палитра слева содержит 7 типов узлов, сгруппированных по семантике (Вход / Логика / Выход / Ограничения).

```mermaid
flowchart LR
  subgraph INPUT["🟢 Вход"]
    N1["🟢 input<br>paramRef → имя параметра"]
  end

  subgraph LOGIC["🟦 Логика"]
    N2["🟦 threshold<br>refValue ± deviation unit"]
    N3["🟧 compare<br>operator: outside/inside/...<br>2 входа: value + range"]
    N4["🟪 formula<br>expression: 'p1 + p2 * 0.5'"]
    N5["🟧 switch<br>cases: list of (label, value)"]
  end

  subgraph OUT["🔴 Выход"]
    N6["🔴 output<br>text + priority"]
  end

  subgraph CONSTR["⬜ Ограничения"]
    N7["⬜ shacl_constraint<br>constraintRef → SHACL ID"]
  end

  N1 -->|edge| N2
  N2 -->|edge| N3
  N3 -->|true edge| N6
  N3 -.->|false edge| N5
  N4 -->|edge| N6

  style N1 fill:#D1FAE5,stroke:#10B981
  style N2 fill:#DBEAFE,stroke:#3B82F6
  style N3 fill:#FEF3C7,stroke:#F59E0B
  style N4 fill:#EDE9FE,stroke:#8B5CF6
  style N5 fill:#FED7AA,stroke:#F97316
  style N6 fill:#FEE2E2,stroke:#EF4444
  style N7 fill:#F5F5F4,stroke:#78716C
```

Визуальный паттерн — **Node-RED-style icon-pill** ([styles.css → .rf-node](frontend/src/styles.css)): цветная icon-секция слева (lucide-иконка типа узла) + светлый body с тип-меткой uppercase-капителью. Полное имя и детали — в правой `<PropertyPanel>` (сворачиваемой как в Node-RED).

### 6.2 Валидация Rule DSL

Перед сохранением Flow проходит проверки в [validator.py](backend/app/services/validator.py):

| Код ошибки           | Что проверяет                                                   |
|----------------------|-----------------------------------------------------------------|
| `unknown_param_ref`  | `input.paramRef` указывает на несуществующий параметр регламента |
| `unknown_constraint` | `shacl_constraint.constraintRef` указывает на отсутствующий SHACL |
| `disconnected_node`  | Узел не имеет ни входящих, ни исходящих рёбер                   |
| `cycle_detected`     | Граф содержит цикл (NetworkX `simple_cycles`)                   |
| `compare_missing_input` | У compare-узла отсутствует один из обязательных входов (`value` / `range`) |

Результат валидации возвращается через `POST /flow/{id}/validate`, ошибки попадают в `useFlowStore.errorsByNode` (Zustand) и подсвечиваются красной рамкой на canvas + tooltip с сообщением.

### 6.3 Трансляция Flow ↔ DSL

```mermaid
flowchart LR
  REACT["🎨 React Flow state<br>nodes: Node[]<br>edges: Edge[]<br>+ UI metadata (position, selected)"]
  DSL["📜 RuleDSL<br>rule_id · regulation_id<br>nodes: FlowNode[]<br>edges: FlowEdge[]"]
  JSON["💾 JSON snapshot<br>в flow_versions.dsl_snapshot"]

  REACT -->|flowToDsl<br>(rulesDsl.ts)| DSL
  DSL -->|dslToFlow<br>(rulesDsl.ts)| REACT
  DSL -.->|model_dump| JSON
  JSON -.->|model_validate| DSL
```

Помощники `flowToDsl` / `dslToFlow` живут в [frontend/src/lib/rulesDsl.ts](frontend/src/lib/rulesDsl.ts) и покрыты юнит-тестами (9 кейсов в `rulesDsl.test.ts`).

---

## 7. ИИ-стек: Ollama + RAGU

### 7.1 Локальная инференция (без облака)

```mermaid
flowchart LR
  subgraph LOCAL["💻 Локальная машина"]
    UI["🌐 Frontend<br>SandboxScreen → ChatDemo"]
    BE["⚙ Backend · /sandbox/chat"]
    EI["🔢 EmbeddingIndex<br>in-memory cache<br>signature-based rebuild"]
    RG["📚 RAGU LocalSearchEngine<br>(graph_ragu 0.0.2)"]
    OL["🦙 Ollama :11434<br>OpenAI-compatible API"]
  end

  UI -->|вопрос пользователя| BE
  BE -->|embed query| OL
  OL -->|qvec (1024-dim)| BE
  BE -->|cosine sim search| EI
  EI -->|top-k regulations| BE
  BE -->|chat completion<br>с retrieved-источниками| OL
  OL -->|ответ qwen2.5:7b| BE
  BE -.->|опционально| RG
  RG -.-> OL
  BE -->|сгенерированный ответ + sources| UI

  style OL fill:#FEF3C7,stroke:#F59E0B
  style RG fill:#EDE9FE,stroke:#8B5CF6
```

### 7.2 Модели и характеристики

| Компонент           | Модель                              | Размер  | Скорость на M2 Air      | Назначение                          |
|---------------------|-------------------------------------|---------|-------------------------|--------------------------------------|
| **Точная LLM** (default) | `qwen2.5:7b-instruct-q4_K_M`   | ~4.4 ГБ | ~6 tok/s, prefill ~50 tok/s | Сводки длинных документов, сравнение регламентов, follow-up'ы |
| **Быстрая LLM** (опц.)  | `qwen2.5:3b-instruct-q4_K_M`    | ~1.9 ГБ | ~13 tok/s               | Приветствия, краткие ответы, извлечение параметров, быстрая итерация |
| **Embedder**        | `bge-m3`                            | ~1.2 ГБ | ~150 tok/s, batched     | Семантический индекс, retrieval     |
| **Runtime**         | Ollama 0.23+                        | ~80 МБ  | Native Metal на Apple Silicon | OpenAI-совместимый HTTP API   |

Обе LLM — из одной семьи (qwen2.5-instruct), поэтому промпт-поведение совместимо: переключение в UI не требует переписывания системных промптов. 7b как дефолт даёт качество, 3b — скорость для коротких сценариев.

**Переключение моделей в UI** ([SandboxScreen](frontend/src/components/sandbox/SandboxScreen.tsx), секция «Модель LLM» в правой панели):
- Выбор персистится в `localStorage` ключом `ragraf:sandbox:model-kind:v1`
- Каждый `ChatRequest` несёт поле `model` — backend подставляет в OpenAI client; `None` = дефолт из `settings.ragu_llm_model`
- Если выбранная модель не установлена в Ollama, UI показывает плашку с командой `ollama pull <tag>` — обнаружение через `available_models` из `/api/sandbox/llm-info`
- Пресеты сценариев тоже могут устанавливать модель: «Краткий ответ» / «Извлечь параметры» → fast (3b); «Резюме документа» / «Сравнить регламенты» → precise (7b)

**Управление RAM**: каждая LLM-модель загружается в память Ollama при первом обращении (cold-start 10-30 сек на M2 Air), потом держится в RAM до истечения `keep_alive` (дефолт 5 мин после последнего запроса). RAGRAF даёт пользователю явный toggle:

- `POST /api/sandbox/llm/load` — Ollama `keep_alive: -1` → модель в RAM бессрочно (готова отвечать без задержек)
- `POST /api/sandbox/llm/unload` — Ollama `keep_alive: 0` → выгрузка немедленно (освободить 2-5 ГБ под другие задачи)
- Кнопка-индикатор «прогреть / в RAM» в подвале правой панели Студии, рядом со строкой `LLM:` — состояние читается из `loaded_models` в llm-info

**Где Ollama хранит модели** (см. также [README §LLM-модели](README.md#llm-модели-и-ollama)):
- macOS: `~/.ollama/models/{blobs,manifests}/`
- Linux: `/usr/share/ollama/.ollama/models/` или `~/.ollama/models/`
- Windows: `C:\Users\<user>\.ollama\models\`
- Сменить путь: `export OLLAMA_MODELS=/custom/path` перед `ollama serve`

### 7.2.1 Почему наш стэк отличается от рекомендованного в RAGU

RAGU в своей [документации](external/RAGU/README.md) и [docs/ru/ragu_components.md](external/RAGU/docs/ru/ragu_components.md) рекомендует другой набор моделей. Сравнение:

| Слой | RAGU рекомендует | RAGRAF использует | Обоснование выбора |
|---|---|---|---|
| **LLM (генерация)** | `mistralai/mistral-medium-3` (cloud) или `gpt-4o-mini` (cloud) | `qwen2.5:7b-instruct-q4_K_M` (Ollama, локально) | Mistral и GPT — закрытые cloud-API: требуют интернет, ключи, биллинг, данные уходят на чужой сервер. Для НГУ/ТЭЦ-кейса с конфиденциальными регламентами — неприемлемо. Локальная Ollama даёт сравнимое качество ответов на наших коротких русскоязычных Q&A. |
| **Embedder** | `emb-qwen/qwen3-embedding-8b` (4096-d) или `text-embedding-3-large` (3072-d, cloud) | `bge-m3` (1024-d, Ollama) | Qwen3-embedding-8b не имеет нативной Ollama-сборки (нужен vLLM/transformers — heavy на macOS). bge-m3 поддерживает русский, multi-lingual, всего 1.2 ГБ, отлично индексирует короткие тексты регламентов. На 6 регламентах разница в качестве retrieval'а незаметна. |
| **NER / Extraction** | **`RaguTeam/RAGU-lm`** (Qwen-3-0.6B, fine-tuned на NEREL, через vLLM) — даёт F1=0.6 по сущностям против 0.32 у Qwen-2.5-14B-Instruct | Не используется — наш `sandbox.chat` строит retrieval напрямую через bge-m3, без artifact extraction'а | RAGU-lm — лучший выбор для **строительства графа знаний** из больших корпусов. У нас 6 регламентов, граф собирается из Turtle/DuckDB напрямую (subj-predicate-obj от руки), LLM-extraction не нужен. **При росте корпуса до 50+ регламентов и при необходимости автоматически вытаскивать сущности из загруженных PDF/DOCX** — стоит интегрировать `RaguLmArtifactExtractor` (см. [RAGU_SURFACE.md](docs/RAGU_SURFACE.md) Tier 3). vLLM на macOS работает плохо (нет Metal-поддержки), потребует Linux-машину или Docker. |
| **Runtime** | vLLM (для local моделей) или cloud REST | Ollama 0.23+ | Ollama проще: brew install, фоновый сервис, native Metal на M-серии, готовые GGUF-биндинги. vLLM требует отдельной конфигурации, GPU/CUDA на Linux. На M2 Air alternative нет. |

**Краткий итог**: RAGU оптимизирован под cloud-LLM (Mistral/GPT) или vLLM-сценарий с большими корпусами и автоматическим extraction'ом. RAGRAF — локально-first для M-серии Mac, малый корпус (6-50 регламентов), извлечение сущностей делается через RAGU-промпты (без RAGU-lm). При переходе к большим объёмам и необходимости NER из произвольных документов — апгрейд через RAGU-lm/vLLM на Linux-машине (backlog).

См. также [RAGU_SURFACE.md](docs/RAGU_SURFACE.md) — там разобран весь публичный API RAGU и какие куски мы используем / могли бы использовать.

### 7.3 EmbeddingIndex и batched rebuild

`EmbeddingIndex` ([embedding_index.py](backend/app/services/embedding_index.py)) — in-memory кэш с сигнатурой ревалидации:

- **Сигнатура** = sha256 от `(reg.id, reg.name, recommendations[].text)` всех регламентов;
- При первом обращении (или при изменении корпуса) — пересборка через **батч-эндпоинт** Ollama (`POST /v1/embeddings` с `input=[t1, t2, ...]`);
- 1 HTTP round-trip вместо N — экономия ~10 секунд на 6 регламентах (sigma-audit P8, см. ADR-007).

```python
# Один батч-вызов вместо цикла
resp = await client.embeddings.create(
    model=settings.ragu_embed_model,
    input=texts,  # список из всех непустых текстов регламентов
)
self._vectors = {rid: list(d.embedding) for rid, d in zip(ids, resp.data)}
```

### 7.4 Graceful fallback

Когда Ollama недоступна / `RAGU_ENABLED=false`:

| Функция           | Полноценный режим              | Fallback                                       |
|-------------------|--------------------------------|------------------------------------------------|
| Q&A в Sandbox     | qwen2.5 с retrieved-источниками | Шаблонный ответ со списком найденных регламентов |
| Семантический поиск | bge-m3 cosine similarity      | TF-IDF по name + recommendation                |
| Извлечение параметров | LLM-extract (опционально)  | Чистый regex + 3-tier naming                   |
| Статус-индикатор  | «🟢 RAGU подключён»             | «🟡 mock-режим»                                 |

Функциональность UI не блокируется ни на одном из путей.

### 7.5 Провайдер-агностичный backend (Ollama / Cerebras / Groq / OpenAI)

Начиная с мая 2026 backend перестал быть Ollama-only. Выбор провайдера —
одна переменная `LLM_PROVIDER`, фронт автоматически подтягивает каталог
моделей из `/api/sandbox/llm-info`.

```mermaid
flowchart LR
  ENV["LLM_PROVIDER<br>(env)"] --> CHAT
  ENV --> MODELINFO

  subgraph SVC["sandbox.chat()"]
    CHAT["AsyncOpenAI(<br>base_url, api_key)"]
    OPT{"provider ==<br>'ollama'?"}
    CHAT --> OPT
    OPT -->|да| WITHOPT["extra_body={'options':<br>{num_ctx, temperature, ...}}"]
    OPT -->|нет| BARE["temperature= / max_tokens=<br>(стандартный OpenAI)"]
  end

  MODELINFO["/api/sandbox/llm-info"] --> CATALOG{"provider"}
  CATALOG -->|ollama| TAGS["GET /api/tags<br>(локальный список)"]
  CATALOG -->|cloud| MODELS["GET /v1/models<br>(httpx + Bearer)"]
  CATALOG --> FALLBACK["preset из llmModels.ts"]

  style ENV fill:#FEF3C7,stroke:#F59E0B
  style WITHOPT fill:#DBEAFE,stroke:#3B82F6
  style BARE fill:#DCFCE7,stroke:#16A34A
```

| Провайдер   | base_url                          | Поддерживаемые модели (presets)                                              |
|-------------|-----------------------------------|------------------------------------------------------------------------------|
| `ollama`    | `http://localhost:11434/v1`       | `qwen2.5:7b-instruct-q4_K_M`, `qwen2.5:3b-instruct-q4_K_M`                   |
| `cerebras`  | `https://api.cerebras.ai/v1`      | `qwen-3-235b-a22b-instruct-2507`, `gpt-oss-120b`, `zai-glm-4.7`, `llama3.1-8b` |
| `groq`      | `https://api.groq.com/openai/v1`  | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `qwen-qwq-32b`            |
| `openrouter`| `https://openrouter.ai/api/v1`    | `qwen/qwen-2.5-72b-instruct:free`, `meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-r1:free` |
| `openai`    | `https://api.openai.com/v1`       | `gpt-4o-mini`, `gpt-4o`                                                      |
| `mock`      | —                                 | детерминированные ответы по ключевым словам (для тестов)                     |

**Ollama-specific options** (`num_ctx`, `top_k`, `mirostat`) проходят
только при `provider == 'ollama'`. Для cloud-провайдеров `extra_body`
не выставляется — иначе Cerebras/Groq возвращают 400.

**Подбор модели в UI** ([llmModels.ts](frontend/src/components/sandbox/llmModels.ts))
теперь идентифицирует каждую модель по её tag-у (не по слотам `precise/fast`).
Это исправляет баг, когда несколько cloud-моделей шарили один kind и
подсвечивались синхронно — см. коммит 2026-05-17.

### 7.6 Гибридный режим: cloud chat + local embeddings

На 2026-05 ни один бесплатный cloud-провайдер не отдаёт embedding-API
совместимый с `bge-m3` (1024-d, мультиязычный). Решение — раздельные
endpoint'ы:

```dotenv
# Chat → cloud
LLM_PROVIDER=cerebras
OPENAI_BASE_URL=https://api.cerebras.ai/v1
OPENAI_API_KEY=csk-…

# Embeddings → local
EMBEDDINGS_ENABLED=true
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_API_KEY=ollama
RAGU_EMBED_MODEL=bge-m3
```

`Settings.effective_embedding_base_url` падает с `EMBEDDING_BASE_URL`
на `OPENAI_BASE_URL` если override не задан — обратная совместимость
с pure-Ollama setup'ом.

Если embedding-stack недоступен (Railway без Ollama-instance) —
`EMBEDDINGS_ENABLED=false` выключает retrieval, и Студия отрисует
баннер «загрузка документов недоступна» + отключит upload-кнопки.
Chat при этом продолжает работать.

---

## 8. Извлечение параметров из текста

`POST /sandbox/extract-parameters` — pipeline извлечения числовых параметров (`число ± отклонение единица`) из произвольного текста нормативного акта.

```mermaid
flowchart TB
  TEXT["📄 Сырой текст<br>'давление 4 ± 0.5 атм'"]
  REGEX["🔍 Pattern match<br>(число) ± (отклонение) (известная_единица)<br>15 единиц: атм · °C · мкг/м³ · % · ч · мин · …"]
  NAMING["🏷 3-tier поиск имени"]
  RESULT["📋 ExtractedParam[]<br>id · suggested_name · value · deviation · unit<br>source_text · confidence (0..1)"]

  TEXT --> REGEX
  REGEX -->|для каждого матча| NAMING
  NAMING --> RESULT

  subgraph NAMING_TIERS["3 уровня поиска имени"]
    direction TB
    T1["1️⃣ Окно 80 символов слева<br>(proximity)<br>'... давление 4 атм' → pressure"]
    T2["2️⃣ Целое предложение<br>(если 1 не нашёл)<br>для длинных конструкций"]
    T3["3️⃣ Предыдущее предложение<br>(если 2 не нашёл)<br>'Уведомления: ... 6 ± 2 часа'"]
    FALLBACK["⚠ Fallback: параметр_N<br>(не «param_N» — явно сигналит<br>аналитику задать имя вручную)"]
    T1 -->|нет стема| T2
    T2 -->|нет стема| T3
    T3 -->|нет стема| FALLBACK
  end

  NAMING -.->|использует| NAMING_TIERS
```

**Confidence-эвристика:**

| Ситуация                                | Confidence |
|-----------------------------------------|------------|
| Стем найден в окне 80 символов          | 0.85       |
| Стем найден на уровне предложения/абзаца | 0.85      |
| Стем не найден → русский плейсхолдер    | 0.40       |
| Есть симметричное deviation (`± N`)     | +0.10 (макс 1.0) |

Frontend в `ParamGroupCard` подсвечивает плейсхолдер `параметр_N` amber-обводкой и просит аналитика переименовать вручную перед сборкой регламента.

**Словарь стемов** (`CONTEXT_NAMES` в `sandbox.py`) — 30+ entries по 4 категориям: физические параметры (температура → temperature, давление → pressure, скорость ветра → windSpeed, …), оповещения (уведомление → notificationLeadTime, до прогноза → forecastLeadTime, …), регламенты режима (очистка → cleaningInterval, штабель → stockpileTemperature, …).

---

## 9. Версионирование и история правок

Каждый ресурс с историей хранит snapshot-ы в отдельной таблице с автоматическим diff между соседними версиями:

```mermaid
flowchart LR
  subgraph REG["Regulation history"]
    R1["v1: seed<br>created_at: 2026-01-15"]
    R2["v2: name change<br>diff: 'name' changed"]
    R3["v3: +parameter pressure<br>diff: 1 added"]
    R4["v4: status active<br>diff: 'status' changed"]
    R1 --> R2 --> R3 --> R4
  end

  subgraph FLOW["Flow versions"]
    F1["v1: empty"]
    F2["v2: +input + threshold<br>diff: 2 nodes added"]
    F3["v3: +output<br>diff: 1 node added"]
    F1 --> F2 --> F3
  end

  REG -.->|связан через<br>regulation_id| FLOW
```

**Что хранится:**

- **`regulation_history`** — полный JSON Regulation (Pydantic `model_dump`), позволяет восстановить любую версию структурно (`POST /regulations/{id}/restore/{version_id}`).
- **`flow_versions`** — JSON Rule DSL, аналогично восстановление через `POST /flow/{id}/restore/{version_id}`.

**Diff-summary** считается lazy при запросе `GET /regulations/{id}/history`:

```python
def compute_diff(prev: dict, curr: dict) -> DiffResult:
    changes = []
    for field in _scalar_fields():
        if prev.get(field) != curr.get(field):
            changes.append({"op": "changed", "path": field, "before": prev[field], "after": curr[field]})
    # + параметры (по id), constraints, recommendations
    return DiffResult(changes=changes, counts={"changed": ..., "added": ..., "removed": ...})
```

Алгоритм покрыт 5 unit-тестами в `test_regulation_diff.py` (changed/added/removed/initial/empty).

---

## 10. Хранилище данных

### 10.1 DuckDB как authoritative store

| Свойство                | DuckDB в RAGRAF                                                |
|-------------------------|----------------------------------------------------------------|
| **Тип**                 | Embedded OLAP, single-file (`backend/data/regulations.duckdb`) |
| **Версия**              | ≥1.2.0 (требование `requirements.txt`)                         |
| **Durability**          | WAL по умолчанию, replay при следующем старте                  |
| **Schema migration**    | Идемпотентный `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` через PRAGMA introspection |
| **Concurrent writers**  | 1 (single-process, RLock в `regulation_store`)                 |
| **Concurrent readers**  | Несколько (внутри одного процесса через `_LOCK`)               |
| **Размер на 100 регламентов** | ~150 МБ (с историей и snapshot-ами)                       |
| **Тестовый профиль**    | In-memory `duckdb.connect(':memory:')` per-test через `isolated_data_dir` fixture |

### 10.2 Сидинг из фикстур

При первом старте (или после удаления `.duckdb` файла) backend через `lifespan` вызывает `regulation_store.init_db()` → `_seed_from_fixtures_if_empty()`:

```mermaid
sequenceDiagram
  participant BE as ⚙ Backend (lifespan)
  participant ST as regulation_store
  participant FX as fixtures (Turtle)
  participant TB as turtle_bridge
  participant DB as DuckDB

  BE->>ST: init_db()
  ST->>DB: CREATE TABLE IF NOT EXISTS ...
  ST->>DB: ALTER TABLE ADD COLUMN IF NOT EXISTS (idempotent)
  ST->>DB: SELECT COUNT(*) FROM regulations
  alt таблица пуста
    ST->>FX: list_fixtures() → 6 файлов *.ttl
    loop по каждой фикстуре
      ST->>TB: parse_regulation_turtle(ttl)
      TB-->>ST: Regulation (Pydantic)
      ST->>DB: INSERT regulations + parameters
      ST->>DB: INSERT regulation_history (initial)
    end
  end
  ST-->>BE: ok
```

Фикстуры в `backend/data/fixtures/`:

| Файл                              | Домен          | Параметров |
|-----------------------------------|----------------|-----------|
| `pressure-diameter.ttl`           | heating        | 2         |
| `heat-inlet-breach.ttl`           | heating        | 5         |
| `roof-snow-fencing.ttl`           | housing        | 5         |
| `dormitory-flood.ttl`             | housing        | 5         |
| `thermal-incident-server.ttl`     | safety         | 5         |
| `air-quality-smog-trap.ttl`       | environment    | 5         |

### 10.3 Capacity и производительность

| Корпус                     | Размер `.duckdb` | API `list_all()` | API `get(reg)` | rebuild embedding-index |
|----------------------------|------------------|------------------|----------------|-------------------------|
| 6 фикстур (текущее)        | ~5 МБ            | 5–10 мс          | 1–3 мс         | ~30 сек (1 батч)        |
| 100 регламентов / 20 версий | ~150 МБ         | 50–100 мс        | 5–10 мс        | ~2 мин                  |
| 1000 регл. / 20 версий     | ~1.5 ГБ          | 200–500 мс       | 20–50 мс       | ~15 мин                 |
| **10000 регл. (предел)**   | **~15 ГБ**       | **0.5–2 с** ⚠   | **100–300 мс** ⚠ | **~2 ч** ⚠           |

При достижении 10к регламентов API-времена превышают целевые (раздел 4.4 ТЗ RAGRAF) — это триггер миграции на Postgres.

### 10.4 Миграция DuckDB → Postgres

Условия миграции и план шагов — подробно в [TZ_RAGRAF.md Приложение А](docs/TZ_RAGRAF.md). Кратко — миграция запускается при:

- **≥3 одновременных пользователей** (DuckDB single-writer)
- **Деплой в продакшен** с требованиями репликации / HA
- **Multi-tenant** с row-level security
- **CDC** для стрима изменений в Kafka / индекс
- Корпус **>10 000 регламентов**

SQLite в плане миграции **отсутствует** — DuckDB строго лучше для аналитических нагрузок RAGRAF (см. ADR-006).

---

## 11. API-контракт

### 11.1 9 routers · 30+ эндпоинтов

| Группа         | Эндпоинты                                                                          |
|----------------|------------------------------------------------------------------------------------|
| **Datasets**   | `GET /datasets` (список регламентов с метриками)                                   |
| **Regulations**| `GET/POST/PUT/DELETE /regulations/{id}` · `GET /regulations/{id}/raw` (Turtle) · `GET /regulations/{id}/history` · `GET /regulations/{id}/diff/{version_id}` · `POST /regulations/{id}/restore/{version_id}` · `POST /regulations/{id}/publish` · `POST /regulations/{id}/archive` |
| **Flow**       | `GET/POST /flow/{id}` · `POST /flow/{id}/validate` · `GET /flow/{id}/history` · `POST /flow/{id}/restore/{version_id}` |
| **Constraints**| `GET/PUT /constraints/{id}` · `POST /constraints/{id}/import` (SHACL Turtle) · `GET /constraints/{id}/shapes` (export) |
| **Graph**      | `GET /graph?domain={domain}` (Cytoscape payload)                                   |
| **Sandbox**    | `GET /sandbox/status` · `GET /sandbox/llm-info` · `POST /sandbox/chat` · `POST /sandbox/search` · `POST /sandbox/extract-parameters` · `POST /sandbox/create-from-params` |
| **Search · Validate · Versions** | Вспомогательные (валидация Turtle, поиск)                        |

### 11.2 Type-safety: Pydantic ↔ TypeScript

```
1. Pydantic v2 schemas (backend/app/schemas/domain.py)
   ↓
2. FastAPI auto-generates OpenAPI 3.1 (http://localhost:8000/docs)
   ↓
3. Frontend TypeScript interfaces (frontend/src/lib/api.ts)
   - вручную поддерживаются параллельно (≤30 типов)
   - НЕ автогенерация openapi-typescript — слишком много шума
     от union'ов и lazy-loaded типов RAGU
   ↓
4. React-компоненты через типы Regulation / Parameter / FlowNode
   получают компайл-тайм проверки
```

ADR-009: явная TypeScript-модель vs автогенерация — выбран явный вариант, потому что корпус из 30 типов читается лучше чем 1500-строчный `types.gen.ts`.

### 11.3 Swagger / OpenAPI

FastAPI по дефолту монтирует три эндпоинта:

| Путь            | Что отдаёт                                              |
|-----------------|---------------------------------------------------------|
| `/docs`         | Swagger UI с группировкой по тегам и «Try it out»       |
| `/redoc`        | Альтернативный ReDoc-рендер той же спеки                |
| `/openapi.json` | Сырая OpenAPI 3.1 спецификация                          |

Доступны локально при запущенном `uvicorn` (по умолчанию http://localhost:8000/docs).

---

## 12. Деплой и инфраструктура

### 12.1 Текущий режим — локальный single-user

```mermaid
flowchart TB
  subgraph DEV["💻 Локальная машина (Apple M2 / Linux x86_64)"]
    LAUNCHER["🚀 launch.sh<br>self-healing launcher<br>(SIGTERM→SIGKILL escalation<br>+ signal traps INT/TERM/HUP/EXIT)"]

    subgraph PROCESSES["Параллельные процессы"]
      BE["⚙ uvicorn app.main:app<br>--port 8000 --reload"]
      FE["🌐 vite dev<br>--port 5173<br>--strictPort"]
      OL["🦙 ollama serve<br>(если установлен)"]
    end

    DB[("💾 backend/data/regulations.duckdb")]
    LOGS["📋 logs/ (backend.log, frontend.log)"]
  end

  LAUNCHER --> BE
  LAUNCHER --> FE
  LAUNCHER -.->|опционально| OL
  BE <--> DB
  BE -.-> OL
  BE -.-> LOGS
  FE -.-> LOGS
```

### 12.2 Запуск

```bash
# Опционально: установить и запустить Ollama (один раз)
brew install ollama
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull bge-m3
ollama serve  # в отдельном терминале

# Backend (с автоматической миграцией DuckDB)
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend
cd frontend && npm install && npm run dev
```

`launch.sh` ([в корне репозитория](launch.sh)) делает это всё одной командой с self-healing-логикой: при ctrl-C каскадно завершает обе подсистемы, при сбое одной — оставляет другую работать.

### 12.3 Production Railway-deploy (реализовано 2026-05-17)

Боевая сборка: <https://ragraf.up.railway.app/>. Один Docker-образ, один
платный Volume, никаких GPU-нод и cloud-эмбеддеров.

```mermaid
flowchart TB
  subgraph RAILWAY["☁ Railway (single container + Volume)"]
    direction TB
    IMG["🐳 Multi-stage Dockerfile<br>node:20-alpine → python:3.12-slim"]
    APP["⚙ uvicorn app.main:app<br>--host 0.0.0.0 --port $PORT"]
    SPA["📦 StaticFiles /assets<br>SPA catch-all → index.html<br>(StaticDir=/srv/frontend_dist)"]
    VOL[("💾 Volume /data<br>regulations.duckdb · flows/ ·<br>versions/ · ragu_store/")]
    SEED["🌱 start.sh<br>seed /data из /srv/_seed_data<br>при пустом БД"]
  end

  USER["👤 Пользователь"] --> APP
  APP --> SPA
  APP <--> VOL
  SEED --> VOL
  APP -.->|chat| CEREBRAS["☁ Cerebras /v1<br>(или Groq/OpenAI)"]

  style CEREBRAS fill:#FEF3C7,stroke:#F59E0B
  style VOL fill:#DBEAFE,stroke:#3B82F6
```

**Ключевые артефакты:**
- [`Dockerfile`](Dockerfile) — две стадии: vite build → python runtime;
  на финале: `useradd ragraf:1000`, `EXPOSE 8080`, `ENV STATIC_DIR=/srv/frontend_dist DATA_DIR=/data`.
- [`start.sh`](start.sh) — privilege drop через `runuser` (на Railway volume = root:root),
  copy seed-data в `/data` если БД нет, `exec uvicorn` с `--proxy-headers`.
- [`railway.json`](railway.json) — `healthcheckPath=/api/health`, `healthcheckTimeout=90`,
  restartPolicy `ON_FAILURE` × 3.
- [`.dockerignore`](.dockerignore) / [`.railwayignore`](.railwayignore) —
  исключают `.venv`, `node_modules`, `*.pdf`, backup-копии, `.env`.

**Подводные камни (вылечены при первых деплоях):**
- `openai` пакет был только в локальном `.venv`, в `requirements.txt` отсутствовал —
  cloud-провайдер падал с `ModuleNotFoundError` на проде. Исправлено добавлением
  `openai==2.36.0` в [`backend/requirements.txt`](backend/requirements.txt).
- `fixtures.py` использует `Path(__file__).parents[2]/data/fixtures` — в Docker-image
  это путь `/srv/backend/data/fixtures`, и его пришлось копировать **отдельно** от
  `/srv/_seed_data` (последний — для volume seeding'а, первый — для flow-схем).
- Railway Volume пустой при первом монтировании → start.sh обязательно seed'ит
  его из baked-in `/srv/_seed_data` перед запуском uvicorn.

Полная инструкция со всеми переменными — [DEPLOY.md](docs/DEPLOY.md).

### 12.4 Будущий многоинстансный режим (опционально, см. §10.4)

При срабатывании триггеров масштаба (> 10 одновременных аналитиков или
требование HA) — переход с DuckDB на Postgres:

```mermaid
flowchart TB
  subgraph PROD["☁ Multi-instance (после миграции)"]
    LB["🌐 Load balancer / Nginx"]
    BE_PROD["⚙ FastAPI (gunicorn + uvicorn workers)<br>несколько Railway-replicas"]
    PG[("🐘 PostgreSQL<br>с реплицируемым standby")]
    OL_PROD["🦙 Cerebras / Groq / OpenAI<br>(уже cloud)"]
  end

  LB --> BE_PROD
  BE_PROD <--> PG
  BE_PROD -.-> OL_PROD
```

Шаги миграции DuckDB → Postgres — Приложение А [TZ_RAGRAF.md](docs/TZ_RAGRAF.md), оценка 2–4 рабочих дня.

---

## 13. Метрики проекта

| Метрика                            | Значение                |
|------------------------------------|-------------------------|
| **Backend LOC** (`app/`)           | ~4 283                  |
| **Frontend LOC** (`src/`)          | ~7 113                  |
| **Backend файлов** (`*.py`)        | 30                      |
| **Frontend файлов** (`*.ts/*.tsx`) | 38                      |
| **API эндпоинтов**                 | 30+                     |
| **Доменных моделей** (Pydantic)    | 15                      |
| **Backend сервисов**               | 11                      |
| **Frontend screens**               | 7                       |
| **UI-примитивов**                  | 7 (`PageShell`, `PageHeader`, `Section`, `Button`, `Badge`, `Tabs`, `EmptyState`) |
| **Backend тестов**                 | **82 (все зелёные)**    |
| **Frontend тестов**                | **44 (все зелёные)**    |
| **Sigma-audit нарушений**          | **0** (Python codebase) |
| **TypeScript strict**              | 0 ошибок                |
| **Языков i18n**                    | 1 (русский UI)          |
| **LLM-инфраструктура**             | Локальная (Ollama)      |
| **Облачные зависимости**           | 0                       |

---

## 14. Тестовая стратегия

### 14.1 Пирамида

```mermaid
flowchart TB
  M["🧪 Manual smoke<br>после каждого релиза<br>(5 эталонных текстов из EXTRACT_PRESETS)"]
  E["🎮 E2E (план)<br>Playwright против локального dev-server"]
  I["🌐 API integration · 82 теста<br>pytest + FastAPI TestClient + in-memory DuckDB<br>~9 сек"]
  U["🧪 Unit фронта · 44 теста<br>vitest + lib/ + store/<br>~0.6 сек"]

  M --> E
  E --> I
  I --> U
```

### 14.2 Покрытие по доменам

| Файл                                       | Тестов | Что покрывает                                                     |
|--------------------------------------------|--------|-------------------------------------------------------------------|
| `test_sandbox.py`                          | 19     | extract (regex + 3-tier naming) · semantic search · chat · create-from-params |
| `test_create_regulation.py`                | 12     | POST /regulations + шаблоны доменов                              |
| `test_regulation_diff.py`                  | 5      | Структурный diff между snapshot-ами                              |
| `test_regulation_store.py`                 | 8      | DuckDB CRUD + history + schema migration                         |
| `test_delete_regulation.py`                | 4      | Каскадное удаление + защита от seed-fixture                      |
| `test_turtle_bridge.py`                    | 10     | Regulation ↔ Turtle round-trip + SHACL parse/serialize           |
| `test_validator.py`                        | 8      | Rule DSL validation (unknown refs, cycles, disconnected)         |
| `test_api_endpoints.py`                    | 16     | Smoke по 9 routers                                                |

### 14.3 Frontend unit-тесты

| Файл                          | Тестов | Что покрывает                                       |
|-------------------------------|--------|-----------------------------------------------------|
| `lib/rulesDsl.test.ts`        | 9      | flowToDsl / dslToFlow round-trip                    |
| `lib/sliderDomain.test.ts`    | 26     | deriveSliderRange + fillPercent + edge cases        |
| `lib/nanoid.test.ts`          | 4      | Длина + алфавит + коллизии (1000 итераций)          |
| `lib/domains.test.ts`         | 5      | getDomainVisual + fallback                          |

### 14.4 Sigma-audit (Python static analysis)

Каждый коммит в backend проверяется через `sigma-audit audit backend/` (методология Гончарова / Нечесова / Свириденко, Sobolev Institute of Mathematics, IEEE 2024) — 26 детекторов на полиномиальную сложность и Sigma-clean конструкции. **Текущий статус: 0 violations** на 40 файлах.

Закрытые правки:
- **L74 P8** (`await_in_loop`) — embedding pipeline переведён на batched single call (1 round-trip вместо N).
- **L107 P5** (`manual_list_append`) — заменено на list comprehension.

---

## 15. ADR — принятые архитектурные решения

> Решения с обоснованием. Если приходит соблазн «передумать» — сначала прочитай среду, почему сейчас именно так.

| ADR | Решение                                                       | Почему                                                                                                |
|-----|---------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| 001 | UUID-фрагмент в качестве version_id                           | Не предсказуем, легко генерится `uuid.uuid4().hex[:8]`, читаем для UI                                  |
| 002 | DuckDB как authoritative store (не SQLite, не Postgres)       | Single-user OLAP-нагрузка, embedded, миллисекундный отклик, PostgreSQL-совместимый SQL для миграции   |
| 003 | Single-process, single-writer (RLock на reentrant save)       | Lifespan-сидинг может вызывать save рекурсивно — `Lock` создаст deadlock, нужен `RLock`              |
| 004 | Локальная LLM через Ollama (без облака)                       | M2 16ГБ покрывает корпус до 1000 регл.; 0 руб операционных; защита от утечки нормативных данных       |
| 005 | Author / Model / Execute split с цветовыми токенами           | Camunda/Node-RED-паттерн; явно отделяет «дорогую LLM-зону» от «дешёвой структурной»                   |
| 006 | DuckDB → Postgres минуя SQLite                                | SQLite OLTP-оптимизирован, проиграет на агрегатах графа в 5–20 раз; нет JSONB; serialize lock         |
| 007 | Batched embedding rebuild (1 HTTP вместо N)                   | sigma-audit P8; Ollama батчит на сервере, экономит RTT × N для корпуса >5 регламентов                 |
| 008 | sigma-audit gate перед каждым коммитом backend                | Methodology IEEE 2024 + ГОСТ Р 56939-2024 §5.10; нулевые риски квадратичной сложности в hot path     |
| 009 | Явная TypeScript-модель (не openapi-typescript codegen)       | 30 типов поддерживать руками легче чем читать 1500-строчный auto-generated файл с lazy-имитированиями RAGU |
| 010 | Pydantic v2 + DuckDB-snapshot в history (не отдельные таблицы версий полей) | Проще откатывать целиком; меньше joins; structured diff считается at query time через regulation_diff |
| 011 | React Flow для редактора flow (не свой canvas)                | 6 КБ gzip, поддержка handles из коробки, активная community                                           |
| 012 | Cytoscape с cola-layout для графа корпуса                     | Force-directed для onthology-графов читается лучше чем dagre; cola поддерживает constraints           |
| 013 | Node-RED-style icon-pill блоки на canvas                      | Знакомый паттерн для пользователей Node-RED/n8n/Camunda Modeler; снижает порог входа                  |
| 014 | Collapsible PropertyPanel (сворачиваемая правая колонка)      | Node-RED-style inspector — full screen для canvas, развёртывается при клике на узел                   |
| 015 | sandbox.py extract: 3-tier поиск имени параметра              | Окно 80 символов даёт `param_N` для длинных предложений с ключевым словом в начале → fallback на sentence/paragraph |
| 016 | Russian-friendly fallback (`параметр_N` вместо `param_N`)     | Явно сигналит аналитику «надо переименовать» — английский литерал воспринимался как корректное имя   |
| 017 | source_document / source_clause / valid_from / valid_to       | SIGMA §4.1.3 — каждое правило связано с источником и периодом действия для аудита                     |
| 018 | Idempotent schema migration через PRAGMA introspection        | DuckDB `ALTER TABLE ADD COLUMN IF NOT EXISTS` не поддерживается во всех версиях — введён через `PRAGMA table_info` |
| 019 | Регламент как Pydantic `Regulation` (не RDF-нативный)         | Pydantic типы → TypeScript типы → React UI без round-trip через rdflib; Turtle — только export        |
| 020 | rdflib + pyshacl для Turtle/SHACL round-trip                  | Стандарт W3C; поддержка SHACL Constraints из коробки; pyshacl-валидатор бесплатно                     |
| 021 | Графический diff в HistoryPanel (rose / emerald / blue)       | added / removed / changed — мгновенно читается без сравнения JSON руками                              |
| 022 | sigma-audit gate в CI (не только лок)                         | Защита от регрессии когнитивной сложности при автоматизированных правках через LLM-агентов            |

---

## 16. Дальнейшее развитие

### 16.1 Backlog (приоритизирован)

| Phase | Что                                                                      | Сложность   |
|-------|--------------------------------------------------------------------------|-------------|
| **2** | Левый sidebar с 3 разделами (Студия / Регламенты / Исполнение)           | M (~2–3 ч)  |
| **3** | Execute Layer · симулятор события + sensor binding на INPUT + API actions на OUTPUT | L+ (неделя+) |
| **4** | Enterprise polish · status bar · Cmd-K · user menu · RBAC                | M           |
| **SIGMA-1** | ETL-модуль UI (каталог источников событий)                          | L           |
| **SIGMA-2** | Notification configurator (Telegram / email каналы)                 | M           |
| **SIGMA-3** | Карточка события / event card (для пилота с СИГМА)                  | M           |
| **SIGMA-4** | Контроль полноты оцифровки (дашборд пробелов в нормативной базе)    | M           |
| **SIGMA-5** | Тесты на знание регламентов (авто-генерация QA через LLM)           | L           |
| **SIGMA-6** | Шаблоны управленческих документов (Jinja-генерация приказа/акта)    | M           |
| **SIGMA-7** | Сценарии моделирования (виртуальное событие → все активные регламенты) | M        |
| **SIGMA-8** | Контекст решения для аудита (snapshot применённых правил)           | S           |

### 16.2 Технический долг

- ⚠ Нет E2E-тестов (Playwright). Мануальный smoke по 5 EXTRACT_PRESETS после каждого релиза.
- ⚠ Vite-bundle ~1 МБ (React Flow + Cytoscape + RAGU types) — code-splitting не настроен. Целевое: lazy-loaded routes для `/sandbox`, `/graph`, `/regulations/:id/flow`.
- ⚠ DuckDB foreign keys не enforced (без `PRAGMA foreign_keys=ON`) — компенсируется атомарными транзакциями в `regulation_store.save`.
- ⚠ Frontend TypeScript-модель Regulation поддерживается руками — при росте >50 типов нужно перейти на openapi-typescript.

---

## 16.3 Интеграция с СИГМОЙ — экспорт регламентов

Главный output RAGRAF для производственного использования — **bundle регламента в SIGMA-совместимом формате**. Это закрывает контур «среда разработки → платформенный контур» из ТЗ СИГМА §1.

**Положение в архитектуре**: RAGRAF (локальный, M-серия Mac) → ZIP-bundle → большая СИГМА (Apache Jena, Linux-сервер).

### 16.3.1 Что соответствует формату СИГМЫ

Из [Rules-Management.pdf](docs/Rules-Management.pdf) известно что СИГМА ожидает на вход пару Turtle-файлов:

| Файл | Содержание | Источник в RAGRAF |
|---|---|---|
| `<id>.data.ttl` | OWL-инстанс регламента: декларация `:Regulation` + properties + значения | `regulation_to_turtle()` в `services/turtle_bridge.py` |
| `<id>.shapes.ttl` | SHACL-форма валидации: `sh:NodeShape`, `sh:targetClass :Regulation`, обязательные поля + типы данных | `regulation_to_shacl_shapes()` в `services/turtle_bridge.py` |

При загрузке в СИГМУ происходит автоматическая валидация data.ttl против shapes.ttl ([ТЗ §4.1.3](docs/TZ_RAGRAF.md)).

### 16.3.2 SIGMA-compliance поля

ТЗ §4.1.3 требует: «каждое правило должно быть связано с источником (нормативный акт + пункт), периодом действия и историей изменений».

RAGRAF хранит эти поля в DuckDB ([Regulation schema](backend/app/schemas/domain.py)):

| RAGRAF поле | Turtle property | DuckDB колонка |
|---|---|---|
| `source_document` | `:sourceDocument` (xsd:string) | `regulations.source_document` |
| `source_clause` | `:sourceClause` (xsd:string) | `regulations.source_clause` |
| `valid_from` | `:validFrom` (xsd:date) | `regulations.valid_from` |
| `valid_to` | `:validTo` (xsd:date) | `regulations.valid_to` |

В SHACL форме они помечены `sh:minCount 0` (soft required) — чтобы старые регламенты без заполненных полей не падали при экспорте; когда поле заполнено, валидация типа отработает.

### 16.3.3 Реализация

[services/sigma_export.py](backend/app/services/sigma_export.py) — сборщик bundle:

```python
build_regulation_bundle(source_id) -> bytes  # один регламент → ZIP
build_corpus_bundle(domain=None) -> (bytes, manifest)  # batch
```

Внутри: вытащить `Regulation` из DuckDB → `regulation_to_turtle()` → `regulation_to_shacl_shapes()` → запаковать в ZIP с `manifest.json` (метадата для трассировки, не парсится СИГМОЙ).

API endpoints в [api/regulations.py](backend/app/api/regulations.py):
- `GET /api/regulations/{id}/export-bundle` — один регламент
- `GET /api/sigma-export/corpus?domain=heating` — batch (отдельный prefix чтобы не конфликтнуть с `{source_id}` маршрутами)

UI: кнопка «Экспорт в СИГМУ» в шапке Regulation Editor и в toolbar `/regulations`. Прямая GET-навигация — браузер качает ZIP без отдельного state'а.

### 16.3.4 Что НЕ экспортируется

| Не отдаём в СИГМУ | Почему |
|---|---|
| `flow.json` (Rule DSL) | Проприетарный node-based формат RAGRAF. СИГМА исполняет регламенты через SHACL + recommendation. Flow — RAGRAF-only для визуального редактирования. |
| `regulation_history` snapshots | RAGRAF audit-trail. СИГМА ведёт свою историю. Версионирование в `manifest.json` остаётся для round-trip обратно. |
| Документы аналитика (PDF/DOCX) | Сырые источники, не часть онтологии. |
| RAGU prompt overrides | Локальная конфигурация LLM-стека. |

### 16.3.5 Документ-основание (PROV-O attachment, реализовано 2026-05-17)

Сценарий: аналитик оцифровывает бумажный приказ в цифровой регламент. Чтобы потом можно было сверить откуда взялись конкретные значения параметров (20.5 атм, 5.0 см), храним:

- `source_url` — внешняя ссылка (Yandex Disk / intranet)
- `source_excerpt` — цитата-фрагмент
- `source_file_path` — относительный путь в `<DATA_DIR>/source_documents/{id}/`
- `source_checksum` — `sha256:<hex>`
- `source_mime_type`

**Стратегия — вариант B** (см. README §«Документ-основание»): URL + цитата + локальный кэш файла. Лимит 25 МБ. Файл хранится в `data/source_documents/{source_id}/<filename>` (один регламент = одна папка, чистка через `shutil.rmtree` при удалении регламента).

**Сериализация в bundle** ([turtle_bridge.py](backend/app/services/turtle_bridge.py) `regulation_to_turtle`): через W3C PROV-O — `prov:wasDerivedFrom` от инстанса регламента → именованный узел `:Source_<instance>` с метаданными. Apache Jena парсит `prov:` нативно. Локальный файл попадает в ZIP как `<source_id>/source.<ext>` ([sigma_export.py](backend/app/services/sigma_export.py) `_add_source_file`), путь дублируется в `manifest.json['source_attachment']['file']`.

**Round-trip.** При импорте bundle обратно `import_bundle` извлекает `source.<ext>` из ZIP, кладёт его в `<DATA_DIR>/source_documents/{id}/` через `source_documents.save_upload()` (пересчитывая checksum). PROV-O в data.ttl парсится `parse_regulation_turtle()` — URL/excerpt/checksum попадают в Regulation. Тест [test_source_document_round_trip](backend/tests/test_sigma_export.py) подтверждает: после export→delete→import файл на диске и хеш проходит verify.

**Безопасность.** `source_documents.resolve_path()` проверяет что путь не вышел за DATA_DIR (защита от подсунутого `../../etc/passwd` в БД). При загрузке имя файла санитизируется до basename.

**REST:** `POST /source-upload` · `GET /source-document` · `DELETE /source-document` · `GET /source-verify` ([backend/app/api/regulations.py](backend/app/api/regulations.py)). UI — секция «Документ-основание» в `RegulationEditorScreen.FormView` + badge «📎 источник прикреплён» в `RegulationList`.

### 16.3.6 Round-trip обратно в RAGRAF (реализовано 2026-05-17)

СИГМА ещё в разработке, поэтому правка регламентов остаётся в RAGRAF. Реализован полный круг RAGRAF → СИГМА → RAGRAF.

**Endpoint:** `POST /api/sigma-import/bundle` ([backend/app/api/regulations.py](backend/app/api/regulations.py)) — multipart ZIP.

**Поток импорта** ([backend/app/services/sigma_export.py](backend/app/services/sigma_export.py) `import_bundle()`):

1. ZIP распаковывается через `_parse_bundle_zip()`: каждая папка верхнего уровня → один регламент. `corpus_manifest.json` на корне игнорируется (informational).
2. `source_id` берётся из `manifest.json` → fallback на имя папки в ZIP.
3. `data.ttl` парсится `parse_regulation_turtle()` (уже был) с подмешиванием `shapes.ttl` для определения SHACL bounds параметров.
4. Регламент сохраняется в DuckDB через `regulation_store.save(reg, author="sigma-import", comment="Импорт SIGMA-bundle")` — попадает в `regulation_history` как обычная правка.
5. `shapes.ttl` пушится в upstream `client.update_shapes()`. Если upstream недоступен — мягко пропускается (`shapes_error` в отчёте), регламент уже в store.
6. Возвращается отчёт `{imported, skipped, failed}` с разбивкой по `source_id`.

**Гарантия валидации.** В [regulation_client.py](backend/app/services/regulation_client.py) `get_shapes()` теперь имеет 4-шаговый fallback: фикстура → upstream → фикстура (без флага) → **derived из `regulation_to_shacl_shapes(reg)`**. Любой регламент в store отдаёт непустой `RegulationShape` — bundle всегда валидируется СИГМОЙ. Закрывает требование ТЗ СИГМА §4.1.3 + [Rules-Management.pdf](docs/Rules-Management.pdf): «каждое правило должно иметь форму валидации».

**UI-вход:**

- `/regulations` — кнопка **«Импорт из СИГМЫ»** в toolbar (рядом с «Экспорт в СИГМУ»). Принимает single/corpus ZIP. На успех показывается inline-баннер с списком имён регламентов.
- `/regulations/{id}/constraints` — кнопка **«Импорт SHACL»** теперь принимает и `.ttl`, и `.zip`. Из ZIP'а ([shacl.py](backend/app/api/shacl.py) `_extract_shapes_from_zip`) вытащит только `shapes.ttl` (первый встретившийся). Для полного импорта bundle с регламентом — используем `/sigma-import/bundle`.

**Тесты** ([backend/tests/test_sigma_export.py](backend/tests/test_sigma_export.py), 6 кейсов):
- round-trip export → delete → import восстанавливает регламент и его параметры
- corpus bundle (несколько регламентов) импортируется корректно
- ZIP без `data.ttl` мягко скипается
- bundle включает реальные пользовательские SHACL (mock upstream)
- **каждый seed-регламент имеет непустую `RegulationShape`** — guarantee из §16.3 не регрессирует

---

## 16.4 Execute Layer (runtime, частично готов)

**Реализовано** (май 2026):

- **Flow Executor** (`backend/app/services/flow_executor.py`) — интерпретатор Rule DSL flow с тремя стратегиями привязки sensor-показаний: по `sensor_id`, по `param_id`, по `sensor_type`. Возвращает `level + recommendation + fired_nodes + fired_edges + trace`.
- **Endpoint** `POST /api/regulations/{sid}/execute` — принимает `{readings, dsl?}`, возвращает `ExecutionResult`. Тот же контракт можно вызывать из СИГМЫ как «movement → вердикт».
- **Sensor-нода в Flow Editor** — оранжевый круг, тип физического датчика (`SensorType`), привязка к input через `bindsTo` (автозаполняется при рисовании ребра).
- **ExecutePanel** в Flow Editor — пресеты «Норма / Внимание / Критика», подсветка сработавшего пути на канвасе.
- **Экран `/execute`** — список регламентов с CTA «Симулировать», status-grid «что работает / что в работе».
- **Библиотека датчиков** (`/sensors`) — DuckDB-backed дерево классов → подтипов → полей payload. CRUD из UI.
- **Словарь rules-based извлечения** (`/regulations/new-from-text` → «Словарь») — DuckDB-backed CRUD по терминам. Predicted_domain по голосованию.

**Не реализовано (бэклог)**:

- `POST /api/events/ingest` — приёмник реальных событий от СИГМЫ.
- Журнал срабатываний в DuckDB + UI-timeline.
- Webhook-actions на OUTPUT-ноде.
- `POST /api/etl/match-event` — поиск подходящего регламента по полям payload.

См. секцию «📡 Приёмник событий СИГМЫ» в [BACKLOG.md](docs/BACKLOG.md).

## 16.5 Sensor library — схемы JSON-событий датчиков (класс → подтип → поля)

> **Терминология.** Несмотря на исторические имена таблиц `sensor_subtypes` /
> `sensor_field_schemas`, фактическое содержимое — **контракты JSON-событий**,
> которые внешние датчики и видеодетекторы шлют в RAGRAF, а не описание самих
> устройств. В UI это отражено: nav-метка осталась короткой («Датчики» — для
> узнаваемости), но заголовок экрана `/sensors` — «Схемы событий датчиков»,
> подсказка явно говорит «это контракты JSON-событий, не сами устройства».
> Backend-имена `sensor_*` оставлены как есть — переименование таблиц/полей не
> даёт продуктовой ценности, корректно с точки зрения domain-modeling
> (sensor-as-event-source).

**Хранилище**: `sensor_subtypes` + `sensor_field_schemas` (см. §4.2). Сидится из `SEED_SUBTYPES` и `SEED_FIELDS` в `extraction_term_store.py` при первом старте.

**Подтипы**:
- **Видеодетекторы Нетрис** (10): `vd-face`, `vd-person` (76 ORM-атрибутов), `vd-fall`, `vd-anpr` (16 ORM-полей из `EventNumberPlate`), `vd-smoke`, `vd-fire`, `vd-weapon`, `vd-motion`, `vd-boost`, `vd-aggressive` — по PDF #13 «Выходные данные Детекторов событий Нетрис» (2024).
- **Видеодетекторы Войслинк** (6): `vd-vehicle-brand`, `vd-accident`, `vd-stop-in-lane`, `vd-dropped-cargo`, `vd-pedestrian`, `vd-driver-violation` — по PDF #14 (2024).
- **DAS**: `fiber-vibration`, `fiber-temperature` — distributed acoustic / temperature sensing.
- **Air**: `air-co2`, `air-pm`, `air-no2`.
- **Generic per class** (1 на каждый из 7 классов) — для обратной совместимости с flows без выбранного подтипа.

**Источник правды по полям**:
- ORM-файлы `event-data-examples/videodetectors/*.py` (для `vd-person` и `vd-anpr`).
- PDF-спецификации для остальных детекторов.

**Frontend**:
- `/sensors` — tree-CRUD по классам/подтипам/полям.
- В PropertyPanel sensor-ноды: селектор класса + селектор подтипа + JSON-превью payload (читается из реестра).

## 16.6 Rules-based извлечение параметров с domain prediction

**Что**: `POST /api/sandbox/extract-parameters` принимает произвольный текст регламента, возвращает кандидатов в параметры (`value ± deviation unit`) + `predicted_domain`.

**Как работает**:
- Regex `_PARAM_PATTERN` ловит `число [± deviation] единица` из `KNOWN_UNITS`.
- Для каждого матча: ищем стем в словаре `extraction_terms` (DuckDB) в окне 80 символов слева → предложение → предыдущее предложение.
- Каждый сматчившийся термин голосует за свой `domain` тэг. `predicted_domain = argmax(votes)`.

**Словарь — редактируемый**:
- 70+ стартовых терминов в `SEED_TERMS` (`extraction_term_store.py`) по 4 доменам.
- UI «Словарь» в `/regulations/new-from-text` позволяет CRUD'ить термины. Все правки (включая seed) сохраняются в DuckDB; при правке seed-термина `source` автоматом меняется на `user`.
- «Дообучение» = `PUT /api/extraction-terms/{stem}` — добавление нераспознанных слов. Применяется на следующем extract без рестарта.

**Без LLM**: чисто rules-based regex + словарь. Экран перенесён из `/sandbox` (где жил рядом с LLM-чатом) в `/regulations/new-from-text` именно поэтому — это инструмент Model Layer, не Author Layer.

## 17. Ссылки

| Документ                                          | Содержание                                                  |
|---------------------------------------------------|-------------------------------------------------------------|
| [README.md](README.md)                            | Запуск, проверка зависимостей, типовые сценарии             |
| [TZ_RAGRAF.md](docs/TZ_RAGRAF.md)                      | Техническое задание по ГОСТ-19 (623 строки)                 |
| [BACKLOG.md](docs/BACKLOG.md)                          | Дорожная карта · Author/Execute split · SIGMA-compliance    |
| [DESIGN_SYSTEM.md](frontend/DESIGN_SYSTEM.md)     | UI-конвенции, примитивы, цветовые токены                    |
| Swagger UI (live)                                 | http://localhost:8000/docs (при запущенном backend)         |
| OpenAPI JSON (live)                               | http://localhost:8000/openapi.json                          |

---

> *Документ создан 2026-05-15. Поддерживается параллельно с кодом.*
> *При значимых изменениях архитектуры — обновлять одновременно с PR.*
