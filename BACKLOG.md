# RAGRAF Backlog

Идеи и фичи в очереди. Реализуем когда станет ясно что нужно, не пытаемся завершить весь список.

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
