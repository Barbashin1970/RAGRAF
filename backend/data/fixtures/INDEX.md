# Fixtures — golden seed для RAGRAF

Извлечено из трёх источников:
- `Rules-Management.pdf` (корень проекта) — формальный пример SHACL/OWL онтологии Sigma на Apache Jena.
- `~/demo-sigma-main/src/config/regulations.yaml` — реальные сценарии НГУ-кампуса
  (пожар в серверной, прорыв теплового ввода, ночная протечка в общежитии, СКУД и др.).
- `~/NSK_OpenData_Bot/config/rules/ecology_rules.yaml` — экологические пороги Новосибирска
  (smog_trap, pdk, black_ice, temp_shock, extreme_cold).

## Роль фикстур после DuckDB

С появлением DuckDB-store (`backend/data/regulations.duckdb`) фикстуры стали **seed-only** —
загружаются в DB один раз при первом старте через `regulation_store.init_db()`, дальше
**не модифицируются**. Все правки идут в DuckDB через `PUT /api/regulations/{id}` (UI Regulation Editor).

| Где живут данные | Что хранят | Изменяемость |
|------------------|-----------|--------------|
| `data/fixtures/*.data.ttl` | OWL онтология + начальные значения параметров | **только при разработке вручную** |
| `data/fixtures/*.shapes.ttl` | SHACL формы валидации | **только при разработке** + через `POST /shacl/import` |
| `data/fixtures/*.flow.json` | Стартовый Rule DSL | seed для пустого flow + ручное обновление |
| `data/regulations.duckdb` | Текущее состояние регламента после UI-правок | **через PUT /regulations/{id}** |
| `data/flows/{id}.json` | Текущий flow (saved через Flow Editor) | **через PUT /flow** |
| `data/versions/{id}/*.json` | Immutable snapshots flow | only-append |

**Чтобы пересоздать DuckDB store из фикстур:** удалить `backend/data/regulations.duckdb` —
сидинг прокатится заново при следующем старте (можно использовать как «сброс к исходному
состоянию» во время разработки).

Также используется как:
- **референсная схема** для аналитика — как должна выглядеть Turtle онтология и SHACL-форма правильного регламента;
- **fallback** для не-редактировавшихся регламентов когда в DuckDB пусто.

## Регламенты по доменам

### Домен `heating` — Теплоснабжение

| source_id | Описание |
|-----------|----------|
| `pressure-diameter` | Регламент на допустимые параметры давления и диаметра трубопроводов водоснабжения. Постановление № 001/2023. **Источник:** Rules-Management.pdf. |
| `heat-inlet-breach` | Регламент при прорыве теплового ввода (smart-valve, обходчик, аварийная бригада, оповещение медблока). **Источник:** demo-sigma-main `heat-inlet-breach`. |

### Домен `housing` — Управление ЖКХ

| source_id | Описание |
|-----------|----------|
| `roof-snow-fencing` | Регламент огораживания придомовой территории при риске схода снега и падения сосулек (ТСЖ). Триггер — резкий выход температуры с минуса на плюс. |
| `dormitory-flood` | Регламент при ночной протечке в жилом блоке общежития (отсекатель стояка, комендант, эвакуация в холл). **Источник:** demo-sigma-main `dormitory-flood`. |

### Домен `safety` — Безопасность кампуса

| source_id | Описание |
|-----------|----------|
| `thermal-incident-server` | Регламент при термическом инциденте в серверной НГУ. Эскалация: ИТ-служба → охрана → дежурный → 01/101/112 при critical. **Источник:** demo-sigma-main `thermal-incident` + Инструкция НГУ (Приложение №6 к приказу № 721-3 от 26.03.2024). |

### Домен `environment` — Городская экология

| source_id | Описание |
|-----------|----------|
| `air-quality-smog-trap` | Регламент при экологической ловушке: безветрие (<1.5 м/с) + PM2.5 > 20 мкг/м³. Эскалация: жители → SMS уязвимым → режим НМУ + предписания предприятиям 15–20% → экстренное оповещение при ПДК ВОЗ. **Источник:** NSK_OpenData_Bot — `config/rules/ecology_rules.yaml` (smog_trap, pdk) + `src/ecology_cache.py`. |

## Состав каждого фикстуры

Для каждого `source_id` есть три файла:

- `{id}.data.ttl` — OWL онтология + инстанс `:Regulation` с реальными значениями параметров
- `{id}.shapes.ttl` — SHACL NodeShape с границами `sh:minInclusive` / `sh:maxInclusive` и сообщениями `@ru`
- `{id}.flow.json` — стартовый Rule DSL для редактора потока (используется как первый шаблон при открытии flow editor)

## ETL-пример

- `etl-incoming.json` / `etl-enriched.json` — пример данных ETL: показания датчиков теплосети и обогащённые отклонения, ссылающиеся на регламент (из Rules-Management.pdf, страница 5).

## Реестр `/api/datasets`

Бэкенд автоматически отдаёт записи из реестра `app/services/fixtures.py:REGISTRY`. Регистрация нового регламента: положить три файла в эту папку, добавить запись в `REGISTRY` (с указанием `domain`), при необходимости дополнить `app/services/turtle_bridge.py:PARAM_UNITS`.
