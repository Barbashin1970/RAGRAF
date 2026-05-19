# RAGRAF Backlog

Идеи и фичи в очереди. Реализуем когда станет ясно что нужно, не пытаемся завершить весь список.

Последняя ревизия — **2026-05-19** (после аудита против двух ТЗ СИГМА: «Платформа Сигма» 2025 и уточнённое ТЗ Фреймворка 2026).

> **Контекст продуктовых решений: vision «станция + спутник»** →
> [README.md](../README.md#ragraf) + [docs/ARC-SIGMA.md §0](ARC-SIGMA.md#0-vision-станция--спутник).
> RAGRAF — самодостаточный локальный продукт; СИГМА-ядро подкручивается под
> наши bundle-форматы, не наоборот. Любая новая фича сверяется с этой рамкой:
> делает ли она спутник либо более самодостаточным, либо лучше пакующим
> артефакты для станции.

---

## ✅ Закрыто (декабрь 2025 — май 2026)

Большой блок задач из прошлой версии backlog'а закрыт. Кратко, чтобы было видно прогресс:

### Архитектура и навигация
- ✅ **Phase 1 · Переименование** — «Песочница» → «Студия аналитика», субшапка с позиционированием Author/Execute.
- ✅ **Phase 1.5 · Design System** — токены в `tailwind.config.js`, примитивы `<PageShell>/<PageHeader>/<Section>/<Button>/<Badge>/<Tabs>/<EmptyState>` в `components/ui/`, конвенции в `frontend/DESIGN_SYSTEM.md`.
- ✅ **Phase 2 · Левый sidebar** — Студия аналитика / Регламенты / Датчики / Модули / Аудит / Граф связей / Цифровой двойник.

### SIGMA-compliance (закрыто из таблицы 2025)
- ✅ Нормативное основание (`source_document`, `source_clause`, `source_url`, `source_excerpt`, `source_file_path`, `source_checksum`, `source_mime_type`) + UI «Документ-основание» в `RegulationEditorScreen.FormView` + бейдж «📎 источник прикреплён» — §4.1.3.
- ✅ Период действия (`valid_from`, `valid_to`) — §4.1.3.
- ✅ Бейдж критичности на карточке регламента — §4.2.2 #1.
- ✅ Терминологическое выравнивание «цифровой регламент».
- ✅ **Семантическая БЗ (RDF/OWL/SHACL)** — `turtle_bridge.py` с полной сериализацией, авто-генерация SHACL-форм через `regulation_to_shacl_shapes(reg)`, raw-turtle хранилище для верзимного редактирования.
- ✅ **Editor «Поля/Поток/Ограничения»** — паттерн перенесён из NSK Studio: YAML/Tree/Sliders + Flow на React Flow + SHACL constraint editor.
- ✅ **Версионирование регламентов** — immutable snapshots в `regulation_history` + diff между версиями (`regulation_diff.py`) + restore.
- ✅ **Domain creation dialog** — пользовательские домены (`CreateDomainDialog.tsx`) с SmartCity-палитрой иконок (40 шт. в 7 группах) и tone-палитрой.

### Event-driven execution (Phase 3, частично)
- ✅ **Sensor-нода во Flow Editor** + `bindsTo` к input-узлам (фикс 047 — реконсиляция триггеров с null subtype).
- ✅ **`flow_executor.py`** — детерминированный интерпретатор Rule DSL, возвращает `ExecutionResult` с `level`, `recommendation`, `trace`.
- ✅ **POST `/api/regulations/{sid}/execute`** + UI-панель «Запуск» в `ExecuteScreen` с пресетами, подсветкой сработавшего пути, журналом.
- ✅ **Kleene 3-valued logic** (true/false/unknown) — `formula_eval.py` + `evidence_level=unknown` бейдж в audit (фикс 043).
- ✅ **Audit log с полной цепочкой** «событие → регламент → действие → результат» — `audit_log_store.py` + `incident_audit_log` таблица + `AuditLogScreen.tsx` (дашборд руководителя, фикс 048).
- ✅ **Триггеры регламента** (event-driven сцепка) — `regulation_triggers` таблица + `RegulationTrigger` модель + reverse-lookup по `sensor_subtype`.

### Прикладные модули и датчики
- ✅ **Sensor library** с типами + подтипами — `sensor_schema_store.py`, типы p/t/flow/noise/detector/fiber/air, ~40 подтипов в seed'е, поля датчиков (фикс уровень подтипов).
- ✅ **Module passport (СИГМА § 7)** — таблица `modules`, схема `Module` (api_contract/quality_rules/event_types/контакты), ModuleLibraryScreen с фильтрами по домену/статусу (фикс 046).
- ✅ **Module CRUD UI** — `ModuleEditorDialog` со всеми полями: статус жизненного цикла (черновик/пилот/промэксплуатация/снят), контракт интеграции (канал/формат/auth/URL/rate-limit), требования к качеству, типы событий, иконка/цвет, контакты, заметки. Кнопки «Создать»/«Изменить»/«Удалить».
- ✅ **11 seed-модулей** из пояснительной записки «Описание архитектуры» (14.04.2026): heating-network (ЦИИ НГУ — теплоснабжение), noise-monitoring (ШУМ-ИИ — Baykal-8/SeedLink/MiniSEED), air-quality, traffic-management, das-fiber-monitoring (Python/PyTorch/SSLAE), medical-imaging-diagnostics (МРТ/туберкулёз, U-Net/nnU-Net, DICOM/NIfTI), urban-health-impact-assessment (граф знаний + GNN + Concrete Autoencoder), nsu-adpi-gsm, nsu-video-analytics, nsu-anpr-parking, nsu-bms-engineering. Идемпотентный seed (per-id).

### Цифровые двойники процессов
- ✅ **Process store** — таблица `processes`, M:N связь регламентов в один контур (`/api/processes`), UI Twins screen с подграфом Cytoscape только для регламентов процесса.
- ✅ **WAL race fix** (фикс 051) — `process_store` шарит DuckDB-singleton с `regulation_store`, чтобы регламенты+процессы переживали редеплой.

### ИИ-стек
- ✅ **GraphRAG-интеграция (graph_ragu)** — `ragu_service.py` + `/api/ragu`, локальная Ollama (qwen2.5 / bge-m3), `LocalSearchEngine` для Q&A.
- ✅ **Студия аналитика — Chat + Extract** — `SandboxScreen` с диалогом по корпусу, извлечением параметров, классификацией домена нового регламента, импорт PDF/DOCX в `document_store`.
- ✅ **18 RAGU-промптов override через DuckDB** — `ragu_prompt_overrides` таблица, UI редактирования промптов.

### Локальная инсталляция
- ✅ **Windows-инсталлер** (фикс 049) — `installer/start-ragraf.bat` + `installer/ragraf.ps1`, проверка git/python/node, клон с GitHub, авто-update.
- ✅ **macOS-инсталлер** (фикс 050) — `installer/start-ragraf.command` + `installer/ragraf-mac.sh`, Homebrew-suggest, Gatekeeper-инструкция, `_run-server.sh` для прямого старта.
- ✅ **Документация по установке** — `installer/INSTALL-WINDOWS.md`, `installer/INSTALL-MACOS.md`.
- ✅ **Реорганизация документов** — все `.md`/`.pdf` из корня перенесены в `/docs/`, ссылки в README/демо-документах/коде обновлены.

### Граф связей
- ✅ **Cytoscape KG регламентов** — `/api/graph` + `GraphView` с cross-domain entity detection (параметры, упоминаемые в нескольких регламентах).
- ✅ **Real data fixtures** — извлечено из `Rules-Management.pdf` в `backend/data/fixtures/`, реальная Turtle-схема (плоские scalar-свойства), Postановление № 001/2023 (`pressure-diameter`).

### UX-улучшения списка регламентов (Phase 1, май 2026)
- ✅ **VS Code-style activity bar** — узкая боковая иконочная панель слева с тултипами заменила горизонтальную шапку. `frontend/src/components/layout/SideRail.tsx`.
- ✅ **Density toggle (Карточки / Компакт)** — переключатель плотности, сохраняется в `localStorage:ragraf:list-density:v1`. Compact-режим даёт ~3x больше регламентов на экран.
- ✅ **«Мои регламенты» (избранное)** — звезда слева у каждого регламента, tab-фильтр `Все · ⭐ Мои`, хранится в `localStorage:ragraf:starred-regulations:v1`. Empty-state с подсказкой.
- ✅ **Hover-reveal secondary actions** — кнопки «Поток / Ограничения / Граф / Дублировать / Удалить» появляются на ховере карточки. Primary «Редактор» всегда видна.
- ✅ **Дублирование регламента** — `POST /api/regulations/{id}/duplicate` копирует параметры/триггеры/SHACL/flow в новый source_id со `status='draft'`. UI: иконка Copy в hover-actions, после успеха автопереход в редактор копии.
- ✅ **Кликабельные домен-заголовки** — ведут на `/domains/:id` (overview-экран домена с регламентами/модулями/датчиками).
- ✅ **Domain Overview endpoint** — `GET /api/domains/{id}/overview` + `DomainDetailScreen` + связь модули↔домены (через `sensor_subtypes.module_id`).

---

## 🎯 SIGMA-интеграция (топ-10 из аудита ТЗ 2026)

Аудит RAGRAF против двух ТЗ — «Платформа Сигма» (22 листа, 2025) и «Фреймворк Сигма уточнённое» (31 лист, 2026) — показал **38% покрытия** требований. RAGRAF позиционирован как **Author Layer** (среда разработчика-аналитика), не ядро+платформа, поэтому полное покрытие не цель. Но для лёгкой интеграции с ядром СИГМА нужны точки сопряжения. Приоритеты ниже отсортированы по «насколько без этого нельзя подключить RAGRAF к runtime СИГМА».

### #1 · ETL-эндпоинт `POST /api/events/ingest` (§4.1.1, табл. 7.2 «январь»)
*Complexity: высокая. Critical для интеграции.*

Принимает SIGMA-event (`{description, timestamp, payload}` по [event-data-examples/schema.json](../event-data-examples/schema.json)), валидирует против JSON-схемы типизированных событий, маппит `payload.<field>` в `SensorReading[]`, решает какие регламенты применять, возвращает `{matched: [{regulation_id, level, recommendation, trace}], skipped: [...]}`.

**Подзадачи:**
1. Реестр JSON-схем по `sensor_type` (текущий `sensor_field_schemas` расширить до полноценной валидации).
2. Маршрутизация: «по `payload.source_id` → модули → датчики → регламенты» (использовать существующие связи `modules` → `sensor_subtypes` → `regulation_triggers`).
3. Запись инцидента в `incident_audit_log` (event-step) автоматически — частично уже сделано в `/execute`, нужно унифицировать.
4. Sandbox-mode (preview без записи) vs production-mode (живая запись и webhook'и).

**Архитектурная ценность:** RAGRAF становится не просто «студией аналитика», а полноценным узлом event-routing'а — можно подключать как fallback при недоступности ядра СИГМА.

### #2 · API Gateway с JWT + ролевой моделью (§4.1.2)
*Complexity: высокая.*

Сейчас RAGRAF single-user без auth (по замыслу TZ_RAGRAF §1.2 — локальная среда аналитика). Для интеграции с ядром СИГМА (multi-tenant, ролевая модель «разработчики/аналитики», «диспетчеры/операторы», «руководители») нужна обёртка:

1. Опциональный JWT-middleware: при `RAGRAF_AUTH_MODE=jwt` проверка токена из `Authorization: Bearer …`.
2. Ролевая модель 3 ролей из ТЗ: `analyst` (read/write регламенты, sensor library, modules), `operator` (read-only регламенты, write audit-actions), `manager` (read all + reports).
3. Intеграция с Keycloak или OAuth2-провайдером СИГМЫ (когда определится). До этого — статические токены + per-source API-key.
4. Не ломать single-user dev-experience: по умолчанию `RAGRAF_AUTH_MODE=none`.

### #3 · Webhook-медиатор и подписка на срабатывания (§4.1.2 «webhook-механизмы, очереди»)
*Complexity: средняя.*

Сейчас при `/execute` результат только возвращается на запрос. Для интеграции с СИГМА нужна push-семантика:

1. Таблица `webhook_subscriptions` — `{id, url, secret, event_filter (regulation_id|domain|level), retry_policy}`.
2. После каждого `match-event` — отправка POST на все подписанные URL, exponential backoff на ошибки, журнал доставки.
3. UI «Подписки» в Studio — настройка webhook'ов аналитиком.
4. Альтернатива: server-sent events (SSE) канал для live-fan-out — проще для UI-клиентов.

### #4 · Bi-directional sync с upstream СИГМА API
*Complexity: средняя.*

Сейчас экспорт one-way (`sigma_export.py` → ZIP-bundle). Нужен pull:

1. `regulation_client.py` → метод `pull_from_upstream(source_id) -> Regulation` (uplink к `/api/v1/regulations/{id}` СИГМЫ, Turtle на входе).
2. Конфликт-резолюшн при rare-condition «локальная редакция конфликтует с upstream» — UI диалог diff и `ours/theirs/merge`.
3. Кнопка «Синхронизировать с СИГМОЙ» в RegulationList — для каждого регламента маркер «🟢 in sync / 🟡 modified locally / 🔴 conflict».
4. Опциональная авто-синхронизация по cron (раз в сутки).

### #5 · Notification configurator (§4.2.1 #4, табл. 7.2 «июнь»)
*Complexity: средняя.*

UI «кого, по какому каналу, при какой критичности» (Telegram + email — прямо из ТЗ).

1. Таблица `notification_rules` — `{id, regulation_id|null, level_threshold, channel: telegram|email, target, body_template}`.
2. Backend-сервис `notification_service.py` — Telegram Bot API (token из env) + SMTP-клиент.
3. UI в Studio: вкладка «Уведомления» в Module passport (кому шлёт этот источник при срабатывании регламента) + глобальные правила.
4. Регистрация факта доставки в `notification_log` (для аудита, §4.2.1 #4 «регистрация факта доставки»).

### #6 · WebSocket / SSE для real-time ленты инцидентов (§4.2.1)
*Complexity: низкая. Quick-win.*

Сейчас `AuditLogScreen` поллит `/api/audit-log?limit=50` каждые 30 сек. Для дашборда диспетчера (когда придёт время) — нужен push:

1. Endpoint `GET /api/events/stream` (SSE) — broadcast при каждом новом incident_audit_log entry.
2. Frontend hook `useAuditLogStream()` — добавляет события к локальному кэшу react-query.
3. Сохранить fallback на polling если SSE недоступен.

### #7 · Модуль контроля знаний (§4.2.4 #3, табл. 7.2 «первая половина августа»)
*Complexity: средняя.*

Тестирование операторов на знание регламентов. По описанию ТЗ:

1. Auto-генерация тестов по регламенту через RAGU (`LocalSearchEngine` по подграфу регламента → LLM формирует MCQ-вопросы).
2. Таблица `knowledge_tests` (id, regulation_id, questions JSON, version) + `test_results` (user_id, test_id, score, answers, ts).
3. UI «Тренажёр»: режим тестирования + история прохождения.
4. **Уже есть прецедент**: тренажёр операторов <https://sigma-operator.vercel.app/operator> — можно интегрировать или взять как образец.

### #8 · Генератор управленческих документов (§4.2.2 #5)
*Complexity: средняя.*

Сейчас `backend/app/services/templates.py` — пустой/TODO. Нужен:

1. Шаблоны (Jinja2) приказа / распоряжения / акта / уведомления — отдельная таблица `document_templates` (название, текст, какие переменные требует).
2. Расширение OUTPUT-ноды Flow: `kind = "text" | "document"`, привязка к template_id.
3. После срабатывания регламента — `POST /api/incidents/{id}/generate-document?template=…` рендерит документ из контекста инцидента + параметров события + регламента.
4. UI «Документы инцидента» в карточке audit-entry с кнопкой «Создать приказ» (выбор шаблона → preview → правка → save в хранилище).

### #9 · Фикстуры для остальных прикладных модулей
*Complexity: низкая–средняя.*

Сейчас регламенты есть только для теплосети (`pressure-diameter`, `heat-inlet-breach`) и экологии (`air-quality-smog-trap`). По Платформа ТЗ §4.1 должно быть **6 доменов**. Не хватает:

1. **Шум** (noise) — пороги шумовых уровней по СанПиН, регламент «превышение ночью», источник `noise-monitoring` (Baykal-8).
2. **Дорожная ситуация** (traffic) — у нас есть `nsu-anpr-parking` + `traffic-management` модуль, нужны регламенты «несанкционированный въезд», «затор», «инцидент».
3. **DAS / оптоволокно** — есть `das-fiber-monitoring` модуль с `step_human/digging_human/noise_event` событиями, нужны регламенты-обработчики (например, «попытка вскрытия охраняемой зоны»).
4. **Медицина** — есть 2 модуля (МРТ-диагностика + оценка городской среды), нужно по 1–2 типовых регламента на каждый.

Источник: NSK_OpenData_Bot YAML на `traffic` / `industrial` / `power` домены уже есть в `~/NSK_OpenData_Bot/config/rules/`.

### #10 · Event-to-Regulation matching dashboard (§4.3.1)
*Complexity: средняя.*

«Контроль полноты оцифровки» из ТЗ: список типов входящих событий, для которых нет регламента, с CTA «оцифровать». Зависит от #1 ETL.

1. Backend-сервис `coverage_analyzer.py` — пробегает события из `incident_audit_log` за период, группирует по `event_type` + `source_module`, флагит те, для которых не нашлось регламента.
2. Отдельный экран «Покрытие» в Studio — таблица «тип события / частота / есть регламент?», кнопка «Оцифровать» открывает CreateRegulationDialog с префиллом домена.
3. Метрика для технико-экономических показателей (ТЗ §6): «доля типов событий, покрытых регламентами».

---

## 🗺️ Платформа руководителя (§4.2.4 Платформа ТЗ)

Это компетенция отдельного компонента «Платформа Сигма» (не RAGRAF), но RAGRAF может покрыть часть — текущий `AuditLogScreen` уже close к «единой ленте инцидентов с фильтрами». Что добавить если решим расширить:

### Сводный дашборд по доменам
Карточки доменов с метриками: «N инцидентов за 24ч / M критичных / K в работе». Drill-down → лента инцидентов этого домена.

### Отчёты по критичности и времени устранения
Сравнение служб по доле обработанных в нормативный срок (§6 техн.-эконом. показатели ТЗ).

### Прогноз аварийности
Сценарии «с вмешательством / без» (§4.2.3). Требует подключения внешних моделей машинного обучения — за пределами текущего скоупа RAGRAF. Возможная интеграция: тонкий клиент для модуля `heating-network` (ЦИИ НГУ, FastAPI/PyTorch/TorchGeometric).

---

## 🔌 Связь Модули ↔ Домены ↔ Регламенты (новый сценарий)

**Что есть.** Модули и регламенты независимо хранят строковый `domain` slug. Sensor_subtypes жёстко связаны с модулем через `module_id`. UI показывает плашку домена на карточке модуля и фильтр по домену.

**Чего не хватает.** Обратного поиска «домен → его модули и регламенты». Нет API-endpoint'а, нет UI-экрана.

### Endpoint `GET /api/domains/{id}/overview`
*Complexity: низкая.*

Возвращает `{regulations: [...], modules: [...], sensor_subtypes: [...]}` для домена. По сути SQL-JOIN'ы по slug'у.

### Экран «Домен» (Domain Detail Screen)
*Complexity: средняя.*

Когда пользователь кликает на домен в списке доменов (или фильтре) — открывается страница:
- Шапка домена (иконка, цвет, описание).
- Секция «Регламенты» — список карточек этого домена.
- Секция «Модули-источники» — список карточек подключённых модулей (с их статусами).
- Секция «Датчики» — типы и подтипы датчиков из подключённых модулей.
- Граф связей в этом домене (sensor → trigger → regulation).
- Бейдж покрытия в самой карточке домена в Studio: «N регламентов · M модулей · K датчиков».

### Покрытие домена модулями
*Complexity: низкая.*

Подсветка «домен закрыт модулем (есть подключённый источник)» vs «домен не закрыт». Помогает методологу видеть, для каких регламентов нет источника событий.

---

## 🧭 UX списка регламентов — Phase 2 + 3

После Phase 1 (карточки/компакт + ⭐ Мои + hover actions + дублирование) — продолжение UX-улучшений для списка регламентов когда корпус вырастет.

### Phase 2 · «Контекст работы аналитика» (день-два)

**2.1. Last-edited timestamp + автор**
*Complexity: низкая.*

Backend уже хранит `updated_at` в `regulation_history`. Добавить в `/api/datasets` ответ. UI: «3 ч назад» / «вчера, 14:30» — относительное время на карточке + в compact-row. Помогает аналитику возвращаться к незавершённой работе.

**2.2. Секция «Недавние» (auto-pinned)**
*Complexity: средняя.*

Track последние 10 регламентов по `edit/view` events (localStorage сейчас, позже user-prefs DB). Показывать сверху списка между tabs и доменами (только в режиме «Все»). Auto-decay через 7 дней.

**2.3. Coverage-badge на карточке**
*Complexity: низкая · уже есть backend.*

Бэйдж «📡 источник подключён» если у домена регламента есть модуль с подтипом датчика. «⚠ нет источника» если нет. Использует существующий `/api/domains/{id}/overview`. Аналитик сразу видит регламенты «висящие в воздухе».

**2.4. Smart filter chips**
*Complexity: средняя.*

При активации фильтра (домен/статус/поиск) — горизонтальная лента под tabs:
```
Активные фильтры: [Домен: Теплоснабжение ✕] [Статус: черновик ✕] [сбросить всё]
```
Плюс **«Сохранить как мой вид»** — saved view с именем (Notion-pattern).

**2.5. Keyboard shortcuts**
*Complexity: средняя.*

- `/` — focus search
- `j/k` — next/prev
- `Enter` — open in editor
- `s` — toggle star
- `e` — editor, `f` — flow, `c` — constraints, `g` — graph
- `d` — duplicate
- `?` — справка по shortcuts

**2.6. Tabs для статуса**
*Complexity: средняя — требует расширения `/api/datasets`.*

Расширить tabs до `Все · ⭐ Мои · Черновики · Активные · Архив`. Сейчас `/api/datasets` не возвращает `status` — backend имеет поле, фронт не видит. Добавить в response.

### Phase 3 · «Power-user» (по запросу, позже)

**3.1. Multi-select + bulk operations**
*Complexity: высокая.*

Checkbox на hover, sticky после первого выбора. Bulk: «Архивировать», «Сменить домен», «Экспортировать SIGMA-bundle», «Удалить с подтверждением» (Linear-pattern).

**3.2. Inline detail panel**
*Complexity: высокая.*

Клик в compact-режиме → правая панель с полным содержанием регламента + вкладки Поток/Ограничения/Граф inline (как в Jira). Полно-страничный редактор остаётся как «Открыть в редакторе». Резко ускоряет lookup-сценарий.

**3.3. Saved views (custom filters)**
*Complexity: средняя.*

Аналитик создаёт свой view: «Регламенты теплоснабжения в статусе review», «Без источника событий», «Со старыми правками >30 дней». Notion-pattern. Хранение в user-prefs DB (когда появится).

**3.4. Третий density-режим: «Таблица»**
*Complexity: средняя.*

Sortable columns — Name / Domain / Status / Last edited / Params / Triggers. Для аудитора покрытия, когда корпус >50 регламентов.

**3.5. Bulk-сравнение через RAGU**
*Complexity: высокая · требует RAGU demo #4.*

Multi-select → «Сравнить» → RAGU выдаёт «общие параметры», «противоречащие пороги», «перекрывающиеся рекомендации». Полезно при унификации регламентов из разных источников.

---

## 🏛️ Phase 4 · Enterprise polish

После закрытия SIGMA-интеграции (топ-10 выше) — финишинг под enterprise-use:

### User menu + ролевая UI
Уже выйдет из #2 «API Gateway + RBAC». Доп.: переключатель ролей в шапке (debug-режим: «посмотреть как оператор»), профиль пользователя, выход.

### Глобальный поиск Cmd-K
Как в Linear/Notion. Поиск по регламентам, модулям, датчикам, инцидентам через единый popup. RAGU-семантика как backend.

### Status bar
Внизу: БД, время отклика, режим mock/real, LLM-статус (есть частично в `LLMStatusBar`).

### Code-splitting
Vite warning > 500kB (текущий чанк 1.4MB). Lazy-loaded routes: `/sandbox`, `/graph`, `/twins`, `/audit-log`.

---

## 🧠 RAGU-песочница: следующие демо

### #3 · KG регламентов с community detection
*Complexity: средняя.*

`GlobalSearchEngine` → кластеризация регламентов по общим параметрам/action-типам/доменам. Cross-domain entity detection (есть в Cytoscape-графе, нужно расширить с RAGU-силой).

### #4 · Сравнение двух регламентов
*Complexity: средняя.*

«Эти параметры общие», «эти противоречат», «эта рекомендация перекрывает». Парно с side-by-side diff viewer (см. ниже).

### #5 · Авто-классификация домена нового регламента
*Complexity: низкая.*

При импорте из PDF — `embedder` + cosine similarity к центроидам существующих регламентов. Помогает Scenario B.

### #6 · Q&A над одним регламентом
*Complexity: средняя.*

Панель «Спроси у RAGU» в RegulationEditor. `LocalSearchEngine` по подграфу регламента (узлы = параметры + рекомендации + триггеры).

### #7 · RAGU-ассистент в создании регламентов (табл. 7.3 «октябрь»)
*Complexity: средняя.*

«Помощник в наполнении регламентов» — диалог типа «У меня есть PDF: какие параметры стоит вытянуть? Какие триггеры предложить? Чего не хватает по сравнению с похожими регламентами?». Сверх extract: проактивные подсказки.

### #8 · Проверка регламента на непротиворечивость и полноту (табл. 7.3 «октябрь»)
*Complexity: высокая.*

LLM-проход по регламенту: «Параметр Pressure имеет deviation=1.5 атм, но min_inclusive=0 — допускается отрицательное давление? Кажется ошибка»; «Рекомендация ссылается на параметр который не объявлен»; «Триггер sensor_subtype=ph-meter, но в модуле нет такого датчика». Использует SHACL + LLM-проверку.

---

## 🔧 Основной функционал (хвост)

### Versioning · Diff для flow-версий
*Complexity: низкая.*

`FlowVersion.diff_summary` объявлен в спеке но не считается. Нужна `compute_flow_diff(old, new)` с подсчётом added/removed nodes, изменённых edges, переименований. Парно с side-by-side viewer.

### Versioning · Side-by-side diff viewer
*Complexity: средняя.*

Сейчас unified diff. Side-by-side в духе GitHub. Хорошо парой с #4 RAGU «Сравнение».

### Approval workflow · review-статус
*Complexity: низкая.*

Сейчас `draft / active / archived`. Добавить `review` между draft и active с системой комментариев и approvals (по аналогии с PR-ревью).

### Импорт регламента из YAML / JSON
*Complexity: низкая.*

По аналогии с upload SHACL. Pydantic-совместимый JSON/YAML → backend парсит → создаёт регламент. Полезно для миграции с других систем.

### Scenario B · flow-first сборка регламента
*Complexity: средняя.*

Пользователь сначала собирает Flow (input + threshold + output), потом backend выводит `Regulation` (parameters из inputs, recommendation из outputs).

### «Сбросить к исходнику»
*Complexity: низкая.*

Кнопка в RegulationEditor: удалить правки этого регламента из DuckDB и пересеять из фикстуры. Сейчас можно только удалив весь файл `regulations.duckdb`.

### Регуляторное расширение
*Complexity: средняя.*

Конвертация NSK_OpenData_Bot YAML (`traffic`, `industrial`, `power`) в наш формат. Покрывает #9 SIGMA-интеграция.

---

## 🔬 NER / извлечение

### NER-обогащение через Natasha
*Complexity: средняя.*

Дополнить rules-based извлечение русским NER-слоем (DATE/TIME/LAW/ORG/MONEY). Цель — автоматическая привязка регламента к нормативной базе («согласно ГОСТ 22270-2018», «ФЗ-261») и извлечение периодичности.

1. `pip install natasha` в requirements.
2. `backend/app/services/ner_temporal.py` — обёртка над `NamesExtractor` + `DatesExtractor` + regex на LAW.
3. В `sandbox.extract_parameters` — дополнительный проход, `validity_period`/`source_law_refs`/`periodicity` как мета-атрибуты.
4. UI: секция «Нормативные ссылки и сроки» в RegulationEditor.

Если Natasha не зайдёт по качеству — fine-tune `rubert-base-cased` на NEREL (2–4 GPU-часа). Отдельная задача.

### PostgreSQL видеодетекторов
*Complexity: средняя.*

Продакшн-схема `EventPerson` (76+ атрибутов) + `EventNumberPlate` в [event-data-examples/videodetectors/](../event-data-examples/videodetectors/). Адаптер-источник (polling или push) → SIGMA-event формат → ETL. Зависит от #1.

---

## 📚 Документация / DX

### Юнит-тесты на `templates.py`
Сейчас покрыто только через `test_create_regulation.py`. После реализации #8 (генератор документов) — отдельные тесты.

### E2E тест на полный цикл
POST → GET → PUT → publish → archive → restore. Сейчас покрыто фрагментарно.

### Storybook-альбом UI-компонентов
RegulationHeader, CreateDialog, SliderRow, ModuleEditorDialog, AuditLogScreen — для быстрого визуального ревью без поднятия backend'а.

### `docs/LOCAL_LLM.md`
Уже есть Ollama-стек в продакшене, но нет связного doc-туториала. Step-by-step: `brew install ollama` → `ollama pull qwen2.5:7b-instruct-q4_K_M` → `ollama pull bge-m3` → правки в `.env`. Health-check endpoint `/api/sandbox/llm-status` уже есть.

---

## 🧹 Git-гигиена (быстрая чистка, не блокирует пользователя)

**Контекст:** `git ls-files backend/data` показывает что в репо tracked:
- `backend/data/regulations.duckdb` (18 MB)
- `backend/data/regulations.duckdb.wal`
- `backend/data/regulations.duckdb.bak-20260517-081945` (9 MB)
- `backend/data/regulations.duckdb.wal.bak-20260517-081945`

Это **не блокирует** локального пользователя (его данные живут в
`~/RAGRAF/data/` — вне git tree, `git pull` их не трогает), но есть 3 минорных
проблемы:

1. **Раздутый clone**: пользователь качает ~28 MB бесполезного бинаря.
2. **Утечка dev-данных**: моя локальная БД с twins/audit/правками регламентов
   уходит в публичный repo при каждом коммите.
3. **Bloat истории**: каждый dev-коммит регламентов меняет .duckdb → 18 MB
   на коммит в git-истории.

**Фикс** (на отдельную сессию):
```bash
git rm --cached backend/data/regulations.duckdb
git rm --cached backend/data/regulations.duckdb.wal
git rm --cached 'backend/data/regulations.duckdb.bak-*'
git rm --cached 'backend/data/regulations.duckdb.wal.bak-*'

# Добавить в .gitignore:
echo 'backend/data/regulations.duckdb' >> .gitignore
echo 'backend/data/regulations.duckdb.wal' >> .gitignore
echo 'backend/data/*.bak-*' >> .gitignore
echo 'backend/data/source_documents/' >> .gitignore

git commit -m "git: untrack runtime DuckDB — должно быть на Volume, не в repo"
```

После этого clone легче на 28 MB. История репо толстая (БД уже там в blob'ах) —
для полной очистки нужен `git filter-repo`, но это разово, не критично.

---

## 🚫 Снято / не делаем

- ~~«Зеркальный» режим вместо СИГМЫ~~ — стало нерелевантно после фикса 049/050 (запускается локально, СИГМА уже не нужна для демо).
- ~~Авто-генератор регламентов из чистого RAGU без human-in-the-loop~~ — противоречит ключевому требованию объяснимости (§4.2.2 #4 ТЗ Фреймворка).
