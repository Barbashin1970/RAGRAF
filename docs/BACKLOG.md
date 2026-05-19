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

### Phase 1.5 · Design System ✅ DONE
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

## 🇷🇺 SIGMA-compliance (ТЗ НГУ ЦИИ 2026)

**Контекст.** Свериваем RAGRAF с уточнённым ТЗ фреймворка СИГМА (НГУ ЦИИ 2026, ИИ-01-01-01-1/1-ЛУ). Для роли «разработчики и аналитики» (раздел 4.3.1) мы покрываем ≈70-75%: уже есть редактор регламентов как блок-схем (СИГМА табл. 7.2 «июнь»), LLM-извлечение знаний (4.1.5), ИИ-ассистент (4.2.4 #1), семантическая база RDF/OWL/SHACL (4.1.3), история правок с diff. Не хватает следующего:

### Done (декабрь 2025)
- ✅ Нормативное основание (`source_document`, `source_clause`) — §4.1.3 «связь правила с источником».
- ✅ Период действия (`valid_from`, `valid_to`) — §4.1.3 «применение правил действовавших на момент события».
- ✅ Бейдж критичности на карточке регламента — §4.2.2 #1.
- ✅ Терминологическое выравнивание «цифровой регламент» — словарь СИГМЫ стр. 3.

### ETL-модуль UI (§4.1.1, §4.1.2 — табл. 7.2 «январь»)
*Complexity: высокая · идёт в паре с нашим Phase 3 «Event-driven execution».*

Каталог источников событий: тип события, JSON-схема валидации, маршрутизация в ядро. UI-аналог Node-RED-сайдбара с adapter-палитрой. Без этого нельзя закрыть требование §4.3.1 «убедиться что для любых данных приходящих из внешних источников в базе знаний существует регламент».

### Notification configurator (§4.2.1 #4)
*Complexity: средняя.*

UI «кого, по какому каналу (Telegram/email), при какой критичности». Таблица правил уведомлений на регламент. СИГМА табл. 7.2 «уведомления — июль».

### Карточка события / event card (§4.3.2)
*Complexity: средняя · требует Phase 3 runtime.*

Нарушенные параметры, основание (ссылка на нормативный документ + пункт — у нас уже есть в схеме), предлагаемые шаги, статус обработки, фиксация решения оператора. Дополняется автоматическим назначением `level` по `recommendation.priority`.

### Контроль полноты оцифровки (§4.3.1)
*Complexity: средняя · требует ETL.*

«Дашборд аналитика»: список типов входящих событий, для которых нет регламента, с CTA «оцифровать». Связан с ETL-модулем.

### Тесты на знание регламентов (§4.2.4 #3 — табл. 7.2 «август»)
*Complexity: высокая.*

Авто-генерация QA-вопросов по регламенту через LLM + KG, прохождение операторами, фиксация результата. Хорошая нагрузка на RAGU `LocalSearchEngine` по подграфу регламента.

### Шаблоны управленческих документов (§4.2.2 #5)
*Complexity: средняя.*

Jinja-генерация приказа / акта / уведомления из регламента + параметров события. Расширение OUTPUT-ноды Flow с `text` → `document_template`.

### Сценарии моделирования (§4.2.3 — табл. 7.2 «сентябрь»)
*Complexity: средняя.*

«Прокатать» виртуальное событие через все активные регламенты, посмотреть какие сработали и в каком порядке. Half-step к Phase 3 — не требует runtime, можно реализовать чисто в backend как pure function.

### Расширение объяснимости: контекст решения (§4.2.2 #3)
*Complexity: низкая · требует Phase 3 runtime.*

При срабатывании регламента фиксировать «контекст решения» — какая версия регламента действовала, какие параметры события, какие правила применились. У нас уже есть `version_id` + `valid_from/to` (только что добавили) — осталось склеить в snapshot при матчинге события.

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
*Complexity: средняя–высокая · частично сделано (май 2026)*

> **Что сделано:** `sensor`-нода во Flow Editor (визуально кружок, привязка
> к input через `bindsTo`), [flow_executor.py](../backend/app/services/flow_executor.py)
> с интерпретатором флоу, endpoint `POST /api/regulations/{sid}/execute`,
> панель «Запуск» в UI с пресетами/подсветкой сработавшего пути.
> Это закрывает пункт 3 списка ниже (engine `match-event`) и большую
> часть пункта 4 (UI-симулятор). Подробнее в разделе **«📡 Приёмник
> событий СИГМЫ»** — там описан следующий шаг.

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

## 📡 Приёмник событий СИГМЫ (event ingestion)

**Контекст.** СИГМА развёрнута на серверах вне НГУ. ETL/edge-устройства
шлют события POST'ом в формате `{description, timestamp, payload}` —
формальный контракт в [event-data-examples/schema.json](event-data-examples/schema.json),
живые сэмплы — в [event-data-examples/sensors/](event-data-examples/sensors/)
по типам датчиков (`pressure/`, `temperature/`, `flow/`, `noise/`,
`video-detector/`). Эмулятор-источник на Triton — в [sigma_event_generator/](event-data-examples/sigma_event_generator/).

Сейчас (май 2026) RAGRAF не принимает события напрямую — это в очередь.
Реализация ждёт сборки ядра СИГМЫ и понимания задачи от заказчика по
фактическому endpoint'у/авторизации.

### Endpoint `POST /api/events/ingest`
*Complexity: средняя*

Принимает SIGMA-event, маппит `payload.<field>` в `SensorReading[]`
([flow_executor.py](../backend/app/services/flow_executor.py)) по
эвристике: `pressure→p`, `temperature→t`, `flow→flow`, и т.д. Решает
какие регламенты применять — варианты:

1. **По `payload.source_id`** (UUID источника из СИГМЫ → один или
   несколько регламентов в реестре)
2. **По домену события** (`description` или `payload.event` → SPARQL/LLM-классификация → domain → регламенты домена)
3. **По всем активным регламентам** (брутфорс — для прототипа)

Возвращает `{matched: [{regulation_id, level, recommendation}], skipped: [...]}`.

### UI: журнал событий
*Complexity: средняя · требует ingest endpoint'а*

Вкладка «События» в навигации — timeline с фильтрами по уровню /
домену / временному окну. На каждое событие — popover с payload, какие
регламенты сработали, какой level. Аналитик видит «что прилетало и что
сработало». Аналог Camunda Cockpit «Process instances».

Хранение в DuckDB: таблица `events` (event_id, received_at, description,
payload JSON, matched_regulations JSON, levels JSON).

### Реестр источников
*Complexity: низкая · требует ingest endpoint'а*

Таблица «источник UUID → список регламентов / типов датчиков». В СИГМЕ
это `sources/<uuid>/events/` — каждый UUID знает свою конфигурацию.
У нас то же самое: UI «Источники» где аналитик прописывает «датчик
такой-то шлёт давление с edge_id=12, маппи в регламент pressure-diameter».

### Граф связей × Библиотека датчиков × ETL match-event
*Complexity: средняя*

Сейчас граф (`/api/graph`, [graph_builder.py](../backend/app/services/graph_builder.py)) показывает только `Regulation → Parameter / Constraint / Recommendation`. Каждый регламент — изолированный остров. Это документация структуры, а не runtime-инструмент.

**Гэп**: когда в СИГМУ прилетает событие (например `{"event":"digging","x":3946,"confidence":0.88}`), ETL должен ответить «какой регламент применить». Сейчас связь от полей payload до регламента нигде не материализована — она разбросана по четырём хранилищам:
- `sensor_field_schemas` знает «у `fiber` есть поля `event`, `x`, `confidence`»
- `flow.json` знает «регламент R слушает `fiber`-датчик» (FlowNode `type=sensor`)
- `flow.json` знает «sensor.bindsTo→input.paramRef цепочку»
- `regulations.parameters` знает «у регламента есть параметр X»

**Что делать**:

1. Расширить `graph_builder` двумя новыми типами вершин и тремя рёбрами:
   - `SensorClass` (p / t / flow / detector / fiber / noise / air)
   - `SensorField` (event, pressure, concentration, …)
   - `SensorClass --has_field--> SensorField`
   - `Regulation --listens_to--> SensorClass` — собрать через `flow_storage.load_flow(reg.id)`, найти FlowNode типа sensor
   - `Parameter --fed_by--> SensorClass` — протянуть через `sensor.bindsTo → input.paramRef`

2. UI: toggle «показать датчики» в шапке GraphView. Без него — старая картина. С ним — поверх рисуются sensor-узлы и связи; SensorField'ы свёрнуты по умолчанию (раскрываются кликом по SensorClass).

3. Рантайм-эндпоинт `POST /api/etl/match-event` body=`{description, payload}` → `[{regulation_id, matched_fields, score}]`. Алгоритм:
   - По ключам payload (`event`, `concentration`, …) найти подходящие `SensorField`
   - От них поднять на `SensorClass`
   - Найти регламенты с FlowNode `sensor.sensorType == X`
   - Вернуть отсортированный список по совпадению полей + required

**Польза**:
- Методист видит «что в системе связано»: один регламент слушает два датчика, два регламента слушают один датчик, у этого класса датчиков нет ни одного регламента (gap).
- Оператор при разборе «почему событие не сработало» сразу видит на графе: подходящих регламентов нет.
- ETL/СИГМА получает HTTP-точку для рутинга событий без знания внутренней структуры RAGRAF.

**Tradeoff**: граф быстро разрастётся (7 SensorClass + ~50 SensorField + cross-edges). Без двух мер станет нечитаемым — нужен collapse/expand по умолчанию и toggle-слой. По сути это означает, что **граф нельзя строить «всё в куче»** — нужно ввести зум-уровни (a-la Camunda Cockpit).

### «Зеркальный» режим вместо СИГМЫ
*Complexity: низкая*

Выставить тот же endpoint что у СИГМЫ (`/api/v1/sources/<uuid>/events/`)
чтобы [sigma_event_generator/](event-data-examples/sigma_event_generator/)
мог слать в RAGRAF без правок. Удобно для разработки/демо.

### Auth-слой
*Complexity: средняя*

Bearer-token или API-key per source. Без авторизации публичный endpoint
не выставляем. Минимум — `X-RAGRAF-Source-Key` в headers + проверка
по таблице `sources`.

### Привязка datatypes к payload-полям
*Complexity: низкая*

Сейчас в `SensorReading` тип определяется по `sensor_type` ('p'/'t'/…).
Нужен маппинг «название поля payload» → `sensor_type`:
`pressure → p`, `temperature → t`, `flow → flow`, `level (dB) → noise`,
`event=digging → detector`. Хранить как таблицу `payload_field_aliases`
или захардкодить в коде — обсудим когда дойдёт до реализации.

### Интеграция с PostgreSQL видеодетекторов
*Complexity: средняя*

ORM-схемы продакшна — в [event-data-examples/videodetectors/](event-data-examples/videodetectors/):
`EventPerson` (76+ атрибутов человека) и `EventNumberPlate`/ANPR
(номер, марка, цвет, направление). СИГМА уже индексирует туда поток,
**свой генератор писать не нужно** — RAGRAF просто читает строки и
мапит в SIGMA-event формат:

```python
# Псевдокод адаптера
row = session.query(EventPerson).filter(updated_at > since).limit(100)
for r in row:
    yield {
      "description": f"Человек на {r.camera_name or r.camera_id}",
      "timestamp": datetime.fromtimestamp(r.timestamp).isoformat(),
      "payload": {
        "event_type": "person",
        "camera_id": r.camera_id,
        "track_id": r.track_id,
        "confidence": r.confidence,
        "bbox": r.bbox,
        "attributes": _top_n_attributes(r),  # порог 0.5 + argmax по группам
      }
    }
```

**Decision needed:**
- Полл-модель (RAGRAF опрашивает БД каждые N сек) или push (триггер в Postgres → callback)?
- Прямой коннект к их Postgres или они выставят REST-обёртку?
- Где живёт `_top_n_attributes`-логика (сжатие 76 float'ов в top-категории)?

См. сэмпл маппинга в [event-data-examples/sensors/video-detector/](event-data-examples/sensors/video-detector/)
— `person-detection.json` / `vehicle-anpr.json` иллюстрируют целевую форму.

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

## 🧠 NER-обогащение через Natasha (русский NER без обучения)

**Идея.** Дополнить rules-based извлечение параметров (numeric + unit) лёгким русским NER-слоем, который ловит `DATE / TIME / LAW / ORG / MONEY` — те классы, что наш regex-парсер игнорирует. Цель — автоматическая привязка регламента к нормативной базе («согласно ГОСТ 22270-2018», «ФЗ-261», «по СНиП 41-01») и извлечение периодичности («проверка каждые 30 минут», «не менее одного раза в смену»).

**Почему Natasha, а не NEREL fine-tune.** Natasha — pip-пакет `pip install natasha`, pre-trained на русском, без GPU и без обучения. F1 ~80 на новостях, для наших технических текстов скорее всего сопоставимо или чуть ниже. Альтернатива (fine-tune `rubert-base-cased` на [NEREL](https://github.com/nerel-ds/NEREL) dataset) даёт +5 F1, но требует 2-4 GPU-часа и пайплайн обучения. Для MVP это лишнее.

**Что делаем (за полдня):**
1. `pip install natasha` в [backend/requirements.txt](../backend/requirements.txt).
2. Новый сервис `backend/app/services/ner_temporal.py` — обёртка над `natasha.NamesExtractor` + `DatesExtractor` + регулярки на LAW (`ГОСТ \d`, `ФЗ-\d`, `СНиП [\d.-]+`).
3. В [sandbox.extract_parameters](../backend/app/services/sandbox.py) — после числового извлечения, дополнительный проход NER, найденные `DATE/TIME/LAW` подцепляются как мета-атрибуты регламента:
   - `validity_period: {from, to}` если есть date-диапазон
   - `source_law_refs: [...]` массив строк
   - `periodicity: "каждые 30 минут"` свободный текст
4. UI: новая секция «Нормативные ссылки и сроки» в RegulationEditor рядом с параметрами.
5. Тесты на 5-10 примеров из `Rules-Management.pdf`: ловим минимум ГОСТ-ссылки и временные периоды.

**Если Natasha не зайдёт по качеству** — апгрейд через NEREL fine-tune `DeepPavlov/rubert-base-cased`. Это уже отдельная задача со своим GPU-бюджетом.

**Чего НЕ делаем:** Natasha не помогает с `pressure / temperature / flowRate` — это останется на словаре стемов + regex. Natasha дополняет, не заменяет.

---

## Документация / DX

- Юнит-тесты на `templates.py` (сейчас покрыто только через `test_create_regulation.py`).
- E2E тест на полный цикл создания: POST → GET → PUT → publish → archive → restore.
- Storybook-альбом UI компонентов (RegulationHeader, CreateDialog, SliderRow, ...).
