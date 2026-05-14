# RAGRAF Backlog

Идеи и фичи в очереди. Реализуем когда станет ясно что нужно, не пытаемся завершить весь список.

---

## 🏛️ Архитектурная программа: Author / Execute split

**Идея.** В RAGRAF два разных типа ИИ с разными ролями: **ИИ-аналитик** (LLM+RAGU, работает редко, разбирает документы) и **ИИ-исполнитель** (детерминированные Rule DSL Flow + параметры, работает на каждое событие, без LLM). UI должен это явно отражать — иначе руководитель видит «непредсказуемая AI-игрушка» вместо «enterprise-tool с понятной экономикой».

**Прецеденты в индустрии:** Camunda (Modeler/Cockpit/Tasklist), Node-RED (Designer/Runtime/Dashboard), Power Automate, Siemens TIA Portal. Везде — раздельные интерфейсы для **дизайна** и **исполнения**.

### Phase 1 · Переименование + субшапка (быстро, ~30 мин)
*Complexity: низкая*

- «Песочница» → «Студия аналитика» в навигации (`App.tsx`, текущая `/sandbox` route)
- В шапке Песочницы — короткое позиционирование: «здесь ИИ помогает аналитику разобрать документы и собрать структурированные регламенты. Сами регламенты живут и исполняются в разделе „Регламенты"»
- Добавить заглушку-таб «Исполнение» (disabled, tooltip «coming soon — симулятор событий, привязка датчиков, webhooks»)

**Цель:** через 5 секунд глядя на UI пользователь понимает что есть **студия** (Author) и **исполнение** (Execute).

### Phase 1.5 · Design System (необходимая основа для Phase 2)
*Complexity: средняя*

Сейчас каждый экран в своём стиле — разные шапки, разные цвета кнопок, разные отступы. Перед тем как делать левый sidebar (Phase 2), фиксируем единый визуальный язык.

**Идея цветовой роли (соответствует Author/Execute split):**
- Author Layer (Студия аналитика) → `accent.purple` (#6B46C1, violet) — «здесь работает ИИ»
- Model Layer (Регламенты) → `primary` (#2C7A7B, teal) — «структурированные данные»
- Execute Layer (Исполнение, в будущем) → `accent.blue` (#3182CE, blue) — «runtime, поток сигналов»
- Domain-цвета на карточках регламентов остаются (heating=orange, housing=blue, safety=rose, environment=emerald) — у них семантика

**Что делаем:**

1. **Tokens — уже есть в `tailwind.config.js` (Nexus-палитра)**, но используются хаотично. Фиксируем дисциплину: никаких прямых `bg-violet-*` / `bg-stone-*` в продуктовом коде, только через семантические токены или ui-примитивы.

2. **Базовые примитивы в `src/components/ui/`:**
   - `<PageShell>` — внешний контейнер (bg, padding, scroll)
   - `<PageHeader>` — иконка + title + бейджи + хлебные крошки + actions-slot справа
   - `<Section>` — bordered-card area с опциональным заголовком
   - `<Button>` — варианты `primary | secondary | ghost | danger`, размеры `sm | md`
   - `<Badge>` — тона `info | success | warning | danger | neutral | author | execute`
   - `<Tabs>` — горизонтальные табы
   - `<EmptyState>` — для «нет данных»
   - `<KeyValue>` — inspector-row (`label : value`)
   - `<Toolbar>` — bordered bar для action-кнопок (используется в editor'ах)

3. **Reference screen:** SandboxScreen — рефакторим первым, показывает все паттерны.

4. **Документ** `frontend/DESIGN_SYSTEM.md` — конвенции, примеры, do/don't.

5. **Migration queue (последующие сессии, по одному экрану в раз):**
   - RegulationList (приоритет: самая видимая страница)
   - RegulationEditorScreen + RegulationHeader
   - FlowEditorScreen
   - ConstraintEditorScreen
   - GraphView
   - SandboxBacklog

**Принципы:**
- Не ломаем функциональность — только визуал
- Каждый экран мигрируется атомарно, в одном коммите
- После миграции — обновляем DESIGN_SYSTEM.md если паттерн уточнился

### Phase 2 · Левый sidebar с тремя разделами (средне, ~2-3 ч)
*Complexity: средняя*

Переделать навигацию из плоских табов в шапке на левый sidebar (как Camunda Cockpit / Node-RED / TIA):

```
RAGRAF
├─ 🧠 СТУДИЯ АНАЛИТИКА           (Author Layer, "ИИ-помощник")
│  ├─ Диалог с базой           ← /sandbox?tab=search (chat)
│  ├─ Извлечь из документа     ← /sandbox?tab=extract
│  ├─ Поиск по корпусу         ← (будущее, отделить от чата)
│  └─ Сравнение регламентов    ← (бэклог: #4 compare)
│
├─ 📚 РЕГЛАМЕНТЫ                 (Model Layer, "Структура")
│  ├─ Список / по доменам      ← /regulations
│  ├─ Карта связей             ← /graph
│  └─ <Регламент>              ← редактор с табами Поля/Поток/Ограничения
│
└─ ⚙️ ИСПОЛНЕНИЕ                  (Execute Layer, "Runtime") — заглушка с roadmap
   ├─ Симулятор события        ← coming-soon (Phase 3 ниже)
   ├─ Привязка датчиков        ← coming-soon
   ├─ Действия / Webhooks      ← coming-soon
   ├─ Журнал срабатываний      ← coming-soon
   └─ Мониторинг порогов       ← coming-soon
```

Шапка остаётся для проекта/пользователя/глобального поиска (Cmd-K в будущем). Чек-боксы из доменов / фильтры — в самом разделе «Регламенты».

### Phase 3 · Execute Layer (большая работа, неделя+)
*Complexity: высокая*

См. отдельный пункт ниже «Event-driven execution» — это и есть Phase 3, но детально расписанный по компонентам.

**Заимствуем из Node-RED:**
- Палитра датчиков слева (как drag-and-drop nodes в Node-RED Designer): MQTT, HTTP webhook, OPC-UA, Modbus
- При drag на INPUT-узел регламента — авто-сопоставление по типу (давление → датчики типа `pressure`)
- Цветовая кодировка: input=зелёный (есть сейчас), processing=жёлтый, output=красный, sensor binding=голубой
- Status badge на узлах: ✓ connected / ⚠ no signal / ⛔ error

**Заимствуем из Camunda Cockpit:**
- **Process instance view** — каждое сработавшее правило = «инстанс», с историей шагов
- **Incidents list** — список текущих отклонений, отсортированный по `level`
- **Heatmap** на Flow — какие узлы срабатывают чаще, где задержки
- **Audit log** — кто, когда, какой регламент, какие данные, какое решение

### Phase 4 · Enterprise polish (после Phase 3)
*Complexity: средняя*

- Status bar внизу (БД, время отклика, режим mock/real, текущий пользователь) — есть частично в LLMStatusBar, поднять на уровень приложения
- User menu (профиль, роль, выйти) — нет
- Глобальный поиск Cmd-K (как Linear, Notion) — нет
- Role-based UI: «Аналитик» видит только Студию, «Оператор» только Исполнение, «Методист» всё — нет

---

## RAGU-песочница: следующие демо

### #3 · Knowledge Graph всех регламентов
*Complexity: средняя*

Cytoscape-карта где регламенты связаны общими параметрами / action-типами / доменами. Например `temperature` упоминается в 4 регламентах разных доменов — это **cross-domain entity**. RAGU `GlobalSearchEngine` (community detection) находит такие кластеры.

**RAGU features:** `GlobalSearchEngine`, community detection, graph traversal.

**Mock без RAGU:** статический `graph_builder` на parameter-name overlap.

### #4 · Сравнение двух регламентов
*Complexity: средняя*

Выбираешь два — RAGU подсвечивает «эти параметры общие», «эти противоречат», «эта рекомендация в первом перекрывает действия из второго». Полезно при унификации регламентов из разных источников (Sigma + ТСЖ + кампусные).

**RAGU features:** embedding similarity, `LocalSearchEngine` cross-query, semantic overlap.

### #5 · Авто-классификация домена нового регламента
*Complexity: низкая*

При создании регламента (или импорте из текста) RAGU предсказывает домен — `heating` / `housing` / `safety` / `environment` / другой — по embeddings и сравнению с центроидами существующих регламентов. Помогает в Scenario B (flow-first сборка).

**RAGU features:** `embedder`, cosine similarity к центроидам.

### #6 · Q&A над одним регламентом
*Complexity: средняя*

Открываешь регламент → панель «Спроси у RAGU». «Какие параметры наиболее критичные?», «На что ссылается этот регламент?», «Что делать если pressure упал на 2 атм?». `LocalSearchEngine` по KG этого регламента (узлы = параметры + рекомендации).

**RAGU features:** `LocalSearchEngine`, `QueryPlanEngine`, subgraph extraction.

---

## Основной функционал

### Versioning #2 · Diff для flow-версий
Уже есть для regulation (см. `regulation_diff.py`); для flow-snapshots `FlowVersion.diff_summary` объявлен в спеке но не считается. Нужна аналогичная функция `compute_flow_diff(old, new)` с подсчётом added/removed nodes, изменённых edges, переименований.

### Versioning #3 · Side-by-side diff viewer
Сейчас unified diff (before → after). Можно сделать визуальный side-by-side: два регламента (или две версии) рядом, изменения подсвечены. Идёт хорошо парой с #4 RAGU «Сравнение двух регламентов».

### Approval workflow · review-статус
Сейчас 3 статуса (`draft` / `active` / `archived`). Добавить `review` между draft и active, с системой комментариев и approval'ов (по аналогии с PR-ревью). Status уже в схеме DuckDB, легко расширить.

### Импорт регламента из YAML / JSON
По аналогии с upload SHACL. Загружаешь Pydantic-совместимый JSON или YAML — backend парсит, создаёт регламент. Полезно для миграции с других систем.

### Code-splitting (Vite warning > 500 kB chunk)
React Flow + Cytoscape + rest тянут ~1.05 MB JS-чанк. Сделать lazy-loaded routes: `/sandbox`, `/graph`, `/regulations/:id/flow` — каждый в свой chunk через React.lazy.

### Scenario B (flow-first сборка регламента)
Пользователь сначала собирает Rule DSL flow (input + threshold + compare + output узлы), потом backend выводит из него `Regulation` (parameters extracted from inputs/thresholds, recommendation from output). Альтернативный entry-point в дополнение к текущему «POST /regulations с шаблоном».

### «Сбросить к исходнику» для регламента
Кнопка в Regulation Editor: удалить все правки этого регламента из DuckDB store и пере-засеять из фикстуры. Сейчас можно только удалив весь файл `regulations.duckdb`.

### Регуляторное расширение
Из существующих NSK_OpenData_Bot YAML-файлов есть черновики на `traffic`, `industrial`, `power` домены. Можно конвертировать в наш формат и расширить покрытие.

### Event-driven execution (Sigma-style) + датчики на INPUT + API на OUTPUT
*Complexity: средняя–высокая*

Описано в Rules-Management.pdf, раздел «Исполнение регламента»: Sigma принимает sensor-события через ETL, делает SPARQL-запрос к онтологии, возвращает обогащённое событие с `level` критичности и `recommendation`.

У нас вся структура для этого УЖЕ есть (Regulation + Parameter + Rule DSL Flow + Recommendation), но не хватает runtime-слоя. Без SPARQL — через DuckDB SQL + Python-thresholding (нам так проще и быстрее, ~10мс vs RDF/SPARQL).

**Что добавить:**

1. **Sensor binding на узлах INPUT** во Flow Editor. Сейчас INPUT-нода только мапит на `paramRef` (имя параметра). Добавить поле `sensor_binding`:
   ```
   {
     "kind": "ollama" | "mqtt" | "http_poll" | "webhook",
     "endpoint": "http://...",
     "topic": "sensors/teploset/edge-1/pressure",
     "polling_interval_sec": 5
   }
   ```
   В property-panel правого сайдбара — селект `kind` + URL/topic.

2. **Action на узлах OUTPUT.** Сейчас output только возвращает текст рекомендации. Добавить `api_action`:
   ```
   {
     "method": "POST",
     "url": "https://operator.local/notify",
     "headers": { "Authorization": "Bearer ..." },
     "body_template": {
       "level": "{{level}}",
       "recommendation": "{{recommendation}}",
       "edge_id": "{{context.edge_id}}"
     }
   }
   ```
   Jinja-like templating с контекстом события.

3. **Engine `/api/sandbox/match-event`** (без LLM):
   - Вход: `{ type, value, reference?, context? }`
   - Lookup регламент(ов) с этим параметром через DuckDB
   - Применить threshold-логику (`level = 1 if |Δ| ≤ dev else 2 if |Δ| ≤ 2*dev else 3`)
   - Вернуть enriched event с регламентом, level, рекомендацией
   - Опционально: если у output-ноды задан `api_action`, выполнить webhook (sandbox-режим: только preview, в проде — реально вызывать)

4. **UI: вкладка «Симулятор события»** в Песочнице — форма с input'ами type/value/reference, превью enriched event с подсветкой какие узлы Flow сработали, dry-run webhook'а.

5. **Production mode (бэклог-уровень-2): live-stream listener** — backend держит постоянное соединение по MQTT/SSE к ETL Sigmы, обрабатывает поток событий, эскалирует через webhooks.

**Архитектурная ценность:** показывает «Sigma делает то же самое, но через SPARQL и RDF-store; у нас типизированные Pydantic-регламенты + DuckDB → ровно та же семантика без онтологического оверхеда». Это **наш ключевой архитектурный аргумент** против полного RDF-стека.

**Tradeoff:** webhook'и из chat-режима — security risk если не контролировать URL'ы. В sandbox-режиме делать только dry-run + явный allowlist на проде.

---

### Локальная LLM-интеграция для RAGU (Ollama / llama-server)
*Complexity: средняя*

Сейчас `RAGU_ENABLED=true` всё ещё требует облачного OpenAI-ключа или совместимого прокси. На M2 16GB можно крутить локально через Ollama без облака:

**Стек:**
- LLM: `qwen2.5:7b-instruct-q4_K_M` (~4.4 GB, ~20 tok/s на M2, хорошо знает русский)
- Embedder: `bge-m3` (~1.2 GB, мультиязычный)
- Runtime: Ollama (нативный Metal-бэкенд, OpenAI-совместимый API на `localhost:11434/v1`)

**Что нужно сделать:**
1. `docs/LOCAL_LLM.md` со step-by-step (`brew install ollama` → `ollama pull qwen2.5:7b-instruct-q4_K_M` → `ollama pull bge-m3` → правки в `.env`)
2. `.env.example` — закомментированный ollama-блок: `OPENAI_BASE_URL=http://localhost:11434/v1`, `OPENAI_API_KEY=ollama`
3. Health-check endpoint `/api/sandbox/llm-status` — пингует настроенную LLM, в шапке Песочницы зелёный/красный индикатор «LLM достижима»
4. Связать `/api/sandbox/search` с реальным `ragu_service.search()` при `ragu_enabled=true` (сейчас всегда mock, даже при включённом флаге)

**Тайминги (оценка):**
- первичная индексация 10 регламентов: 1–2 минуты
- LocalSearch query: ~2–4 сек
- GlobalSearch query (сравнение, кросс-домены): ~10–20 сек

**Tradeoff:** 16 GB unified memory впритык; параллельно с Claude Code и десятком Chrome-табов может уйти в swap. Перед индексацией стоит закрывать тяжёлое.

---

## Документация / DX

- Юнит-тесты на `templates.py` (сейчас покрыто только через `test_create_regulation.py`).
- E2E тест на полный цикл создания: POST → GET → PUT → publish → archive → restore.
- Storybook-альбом UI компонентов (RegulationHeader, CreateDialog, SliderRow, ...).
