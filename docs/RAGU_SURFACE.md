# RAGU surface — что есть в чёрном ящике

Аудит `external/RAGU/ragu/` (graph_ragu 0.0.2). Цель — найти, какие «ручки»
RAGU торчат наружу как публичный API, но нигде в UI у нас не выведены, и
выбрать минимальный набор для интерактивной панели «RAGU Studio».

## 1. Промпт-система — главная находка

`ragu/common/prompts/default_templates.py` содержит **18 именованных Jinja2-промптов**,
все доступны через `RAGUInstruction` объект (текст + pydantic-схема ответа + описание).
Каждый модуль RAGU наследует `RaguGenerativeModule`, у которого есть метод
`update_prompt(name, RAGUInstruction)` — то есть **любой промпт можно переопределить
в runtime без форка библиотеки**.

| Имя промпта                       | Где используется                          | Что регулирует                       |
|-----------------------------------|-------------------------------------------|--------------------------------------|
| `artifact_extraction`             | `ArtifactsExtractorLLM`                   | Извлечение сущностей и связей из текста |
| `artifact_validation`             | `ArtifactsExtractorLLM` (validator stage) | Проверка/дополнение извлечённых триплетов |
| `community_report`                | `CommunitySummarizer`                     | Отчёт по графовой общине (title + 5–10 findings) |
| `entity_summarizer`               | `EntitySummarizer`                        | Слияние дубликатов сущности в один summary |
| `relation_summarizer`             | `RelationSummarizer`                      | Слияние описаний связей |
| `global_search`                   | `GlobalSearchEngine` (final stage)        | Финальный ответ по ranked community insights |
| `global_search_context`           | `GlobalSearchEngine` (rating stage)       | Оценка релевантности community 0–10 |
| `local_search`                    | `LocalSearchEngine`                       | Ответ по entity-neighborhood контексту |
| `naive_search`                    | `NaiveSearchEngine`                       | Vector-RAG ответ (без графа) |
| `mix_search`                      | `MixSearchEngine`                         | Ensemble-ответ, сравнение результатов разных движков |
| `mix_search_context`              | `MixSearchEngine` (formatting stage)      | Формат входа для ensemble |
| `cluster_summarize`               | Внутренний — кластеризация               | Свертка списка описаний в одно |
| `ragu_lm_entity_extraction`       | `RaguLmArtifactExtractor` (NER stage)     | Первичное NER без типов |
| `ragu_lm_entity_normalization`    | `RaguLmArtifactExtractor`                 | Лемматизация / нормализация сущности |
| `ragu_lm_entity_description`      | `RaguLmArtifactExtractor`                 | Описание сущности в контексте текста |
| `ragu_lm_relation_description`    | `RaguLmArtifactExtractor`                 | Описание связи между двумя сущностями |
| `query_decomposition`             | `QueryPlanEngine`                         | Разбор вопроса на DAG атомарных подзапросов |
| `query_rewrite`                   | `QueryPlanEngine`                         | Подстановка ответов зависимостей в подзапрос |

**Ценность**: аналитик может управлять стилем ответа, форматом отчётов по
общинам, языком, степенью детализации NER и т.д. **без правки кода**.

### Как переопределяется

```python
from ragu.common.prompts.prompt_storage import RAGUInstruction
from ragu.common.prompts.messages import ChatMessages, UserMessage

engine.update_prompt("global_search", RAGUInstruction(
    messages=ChatMessages.from_messages([UserMessage(content=NEW_TEMPLATE)]),
    pydantic_model=str,
    description="Custom global search prompt",
))
```

Каждый шаблон — Jinja2 с известным набором переменных:
- `query`, `context`, `language` — почти везде
- `entity_types`, `relation_types`, `entity`, `relation`, `community` — у extraction/summarization
- `payload.entries`, `section_label` — у mix_search

## 2. BuilderArguments — конфигурация построения графа

`ragu.BuilderArguments` (dataclass):

| Параметр                       | Default | Что меняет                                              |
|--------------------------------|---------|---------------------------------------------------------|
| `use_llm_summarization`        | `True`  | Слияние дублей через LLM (иначе concat без LLM)         |
| `use_clustering`               | `False` | Кластеризация перед summarization                       |
| `build_only_vector_context`    | `False` | Пропускает extraction/summarization, только chunks      |
| `make_community_summary`       | `True`  | Генерация отчётов по общинам Leiden                     |
| `remove_isolated_nodes`        | `True`  | Чистка sink-сущностей без связей                        |
| `vectorize_chunks`             | `False` | Embedding'и чанков для NaiveSearch                      |
| `cluster_only_if_more_than`    | `10000` | Порог запуска кластеризации                             |
| `summarize_only_if_more_than`  | `7`     | Порог запуска summarization общины                      |
| `max_cluster_size`             | `128`   | Максимум сущностей в кластере                           |
| `random_seed`                  | `42`    | Воспроизводимость Leiden                                |

В `ragu_service.py` мы пробросили только три из десяти — остальные дефолты.

## 3. Поисковые движки — у нас выведены только 3 из 5

| Движок               | У нас  | Возвращает                                                   |
|----------------------|--------|--------------------------------------------------------------|
| `LocalSearchEngine`  | ✅     | entities + relations + summaries + chunks + documents_id     |
| `GlobalSearchEngine` | ✅     | response + ranked per-community insights с rating 0–10      |
| `NaiveSearchEngine`  | ✅     | response + chunks                                            |
| `MixSearchEngine`    | ❌     | Список ответов всех движков + ensemble-ответ                 |
| `QueryPlanEngine`    | ❌     | DAG подзапросов с rewrites + промежуточные ответы            |

И — мы возвращаем только `response` из результата. Поля `entities`, `relations`,
`chunks`, `documents_id`, `metrics["entities"]` (rank, relevance_score),
`get_meta_responses` (per-community с rating) — выкидываются в `search.py:23`.

## 4. KnowledgeGraph — программное API для просмотра графа

```python
kg.get_entities([entity_ids])    # Entity[] с name/type/description
kg.get_relations([edge_specs])   # Relation[] с subject/object/strength/description
kg.get_chunks([chunk_ids])       # Chunk[] с content
kg.get_communities([ids])        # Community[] от Leiden
kg.get_summaries([summary_ids])  # CommunitySummary[] (LLM-generated title+findings)
```

В UI нет ничего из этого — мы строим Cytoscape-граф через свой
`graph_builder.regulation_to_subgraph()` поверх Turtle/DuckDB, RAGU-граф
доступен только когда корпус большой и берётся через `to_cytoscape(kg)` —
но без entity-описаний, без community-summaries, без metrics.

## 5. Settings (singleton)

`ragu.Settings` — глобальный singleton, два атрибута:
- `language` — мы выставляем `"russian"` (используется во всех промптах через Jinja-переменную)
- `storage_folder` — кэш + persist `kv_*.json` / `vdb_*.json` / `knowledge_graph.gml`

Если переключить `language` на лету — все следующие LLM-вызовы будут на другом языке.

## 6. Рекомендованные модели в RAGU (что мы НЕ используем)

В [README RAGU](external/RAGU/README.md) и [docs/ru/ragu_components.md](external/RAGU/docs/ru/ragu_components.md) приведены конкретные модели для всех слоёв пайплайна. Важно понимать что они там по дефолту, чтобы знать на что апгрейдиться при росте корпуса.

### 6.1 Модели по умолчанию (cloud-LLM сценарий)

```python
llm = LLMOpenAI(client=client, model_name="mistralai/mistral-medium-3")
embedder = EmbedderOpenAI(client=client, model_name="emb-qwen/qwen3-embedding-8b", dim=4096)
```

Альтернатива из русской документации:
```python
llm = LLMOpenAI(client=client, model_name="gpt-4o-mini")
embedder = EmbedderOpenAI(client=client, model_name="text-embedding-3-large", dim=3072)
```

Обе конфигурации требуют **cloud API key** — не для локального запуска.

### 6.2 RAGU-lm — специализированная модель для русского NER

Самая интересная находка. У RAGU есть **собственная** дообученная модель: [RaguTeam/RAGU-lm](https://huggingface.co/RaguTeam/RAGU-lm).

- **База**: Qwen-3-0.6B (всего 600M параметров — компактнее некуда)
- **Fine-tuned на**: NEREL — русскоязычный датасет именованных сущностей (PERSON, ORGANIZATION, LOCATION, ...)
- **Пайплайн**: 4 стадии через `RaguLmArtifactExtractor`:
  1. Extract unnormalized entities from text
  2. Normalize entities into canonical forms
  3. Generate entity descriptions
  4. Extract relations based on entity-pair inner products

**Бенчмарк** (из README RAGU, на датасете NEREL):

| Модель | F1 (Entities) | F1 (Relations) |
|---|---|---|
| Qwen-2.5-14B-Instruct | 0.32 | 0.69 |
| **RAGU-lm (Qwen-3-0.6B)** | **0.6** | **0.71** |
| Small-model pipeline | 0.74 | 0.75 |

То есть **0.6B специализированная модель почти в 2× точнее по сущностям** чем универсальная 14B модель. Это контр-интуитивный результат и сильный аргумент: для NER на русском **дообученная маленькая модель бьёт большую общую**.

**Запуск**: только через vLLM (Ollama не поддерживает этот формат напрямую):
```bash
sudo vllm serve RaguTeam/ragu-lm --max_model_len 4096
```

```python
from ragu.triplet.ragu_lm_artifact_extractor import RaguLmArtifactExtractor
llm = LLMOpenAI(client=client, model_name="RaguTeam/ragu-lm")
pipeline = RaguLmArtifactExtractor(llm=llm)
entities, relations = await pipeline.extract(chunks)
```

### 6.3 Почему RAGRAF не использует RAGU-lm (сейчас)

1. **vLLM плохо на macOS** — нет нативной Metal-поддержки, нужен Linux-сервер с CUDA или Docker. Наш target — M-серия Mac локально.
2. **Корпус 6-50 регламентов**, граф знаний строится из Turtle/DuckDB напрямую (subj-predicate-obj от руки в Constraint Editor). LLM-extraction не нужен — у нас уже есть структурированный источник.
3. **RAGU-lm специализирован под NEREL-онтологию** (PERSON, ORG, LOC). Наши регламенты говорят о технических сущностях — давление, температура, регламент. Качество fine-tune'а на нашем домене неизвестно — нужен бенчмарк.

### 6.4 Когда стоит апгрейдиться на RAGU-lm

- **Корпус ≥50 регламентов** + хочется автоматически вытаскивать сущности из произвольных PDF/DOCX через `RaguLmArtifactExtractor`
- **Появилась Linux-машина или GPU-сервер** где можно крутить vLLM
- **Расширение онтологии** на технические сущности (нужен fine-tune RAGU-lm на нашем датасете — или замена на model, обученный под наш домен)

Это Tier 3 фича — см. §«Графовая инспекция» в этом документе.

---

# Что предлагаю встроить в UI

Сценарий: аналитик заходит в новую вкладку «**RAGU Studio**» (или раздел в студии аналитика) и видит:

## Tier 1 — Visibility (минимальный scope, ~1 день работы)

**A. Эндпойнт `GET /api/ragu/prompts`** — список всех 18 промптов с
`name`, `description`, `template`, `variables[]`, `pydantic_schema_name`.

**B. Эндпойнт `GET /api/ragu/prompts/{name}`** + `PUT` для override (хранится
в DuckDB в новой таблице `ragu_prompt_overrides`, применяется при инициализации
движков через `engine.update_prompt(...)`).

**C. UI «RAGU Промпты»** — сайдбар со списком, monaco/textarea для редактирования,
кнопка «Восстановить default», кнопка «Применить» (триггерит invalidate + перезагрузку
движков). Видимо это самое ценное — пользователь видит, *чем именно* RAGU
просит LLM-у. Сразу выходит из «чёрного ящика».

**D. Эндпойнт `GET /api/ragu/config`** — текущий `BuilderArguments` + `Settings` +
имена моделей + размер индекса. Read-only debug-панель.

## Tier 2 — Richer search results (~1 день)

**E. `/api/search` обогатить** возвращать `entities`, `relations`, `chunks`,
`metrics`, `community_insights` (для global). UI показывает их раскрываемыми
секциями под основным ответом.

**F. Mode `"mix"` и `"plan"`** добавить в SearchRequest. Для `mix` отображать
ответы каждого подключённого движка отдельно + ensemble; для `plan` —
визуализацию DAG подзапросов с rewriting'ом.

## Tier 3 — Graph inspection (~2-3 дня)

**G. Endpoint'ы `/api/ragu/communities`, `/api/ragu/entities/{id}`,
`/api/ragu/relations`** — программный browse RAGU-графа.

**H. UI «Карта общин»** — список Leiden-общин со сводками, для каждой —
сущности входящие в неё + ссылки на регламенты.

## Tier 4 — Builder controls (опционально, ~1 день)

**I. Эндпойнт `PUT /api/ragu/builder-args`** — изменить runtime'ные параметры
сборки. Применяется на следующем `build_from_docs`.

---

# Рекомендация по приоритетам

1. **Tier 1A-D** — приносит 80% ценности «выйти из чёрного ящика» за минимальный труд.
   Особенно `/api/ragu/prompts` — это просто mapping существующих констант.
2. **Tier 2E** — небольшое изменение `search.py`, но даёт виды «entities в ответе»,
   «community ratings», что отличает GraphRAG от обычного RAG. Это PR полезен в маркетинговом
   смысле — демонстрирует то ради чего RAGU вообще взят.
3. **Tier 2F + Tier 3** — серьёзная фича-разработка, на пользователе появится «нагрузка»
   которую он попросит понять (QueryPlan визуализация — это отдельный UX).
   Сначала Tier 1-2, потом смотрим спрос.

Корпус сейчас 6 регламентов — RAGU фактически работает в режиме fallback'а
(см. `graph.py:91-95` где он переключается на kg только если `not domain`).
До роста корпуса ~50+ Tier 3 не даст видимой пользы.
