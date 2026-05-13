# RAGRAF

Визуализатор и редактор регламентов: knowledge graph (Cytoscape) + node-based rule flow (React Flow) + табличный редактор SHACL над **Regulation Management API**.

Спецификация продукта: [`regulation-viz-skill.md`](regulation-viz-skill.md). Каталог навыков, используемых при разработке: [`SKILL.md`](SKILL.md).

---

## Структура

```
RAGRAF/
├── backend/           # FastAPI: домен, валидация, SHACL bridge, RAGU, версии
│   ├── app/
│   │   ├── api/       # routers
│   │   ├── services/  # turtle_bridge, regulation_client, validator, ragu_service, flow_storage
│   │   ├── adapters/  # cytoscape_adapter (RAGU → Cy)
│   │   ├── schemas/   # pydantic domain
│   │   └── main.py
│   ├── data/          # хранилище flow + версии (gitignore)
│   ├── requirements.txt
│   └── .env.example
├── frontend/          # React 18 + Vite + Tailwind + React Flow + Cytoscape
│   └── src/
│       ├── components/{regulations,graph,flow,constraints}/
│       ├── lib/{api,rulesDsl,cn,nanoid}.ts
│       ├── store/flowStore.ts
│       └── App.tsx
├── SKILL.md
├── regulation-viz-skill.md
└── README.md
```

---

## Запуск

### Одна кнопка

- **macOS / Linux:** двойной клик по `start.command` (или `./start.command` в терминале)
- **Windows:** двойной клик по `start.bat`

Скрипт сам:
1. создаёт `backend/.venv` и ставит зависимости (если ещё нет),
2. делает `npm install` во `frontend/` (если ещё нет),
3. копирует `backend/.env.example` → `backend/.env`,
4. поднимает FastAPI (`:8000`) и Vite (`:5173`), ждёт пока оба ответят,
5. открывает `http://localhost:5173` в браузере.

Лог-файлы — в `logs/backend.log` и `logs/frontend.log`. Остановка — `Ctrl+C` (закрывает оба сервиса).

Флаги:

```
--no-open               не открывать браузер
--backend-only          только backend
--frontend-only         только frontend
--reset-deps            переустановить .venv и node_modules
--port-back=8001        другой порт backend (фронт пробросит туда же)
--port-front=5174       другой порт frontend
```

### Ручной запуск (если без скрипта)

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (в другом терминале)
cd frontend && npm install && npm run dev
```

Health: <http://localhost:8000/health>. OpenAPI: <http://localhost:8000/docs>. UI: <http://localhost:5173>.

---

## REST API (наш слой)

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/api/datasets` | Список регламентов |
| `GET` | `/api/regulations/{id}` | Регламент (domain JSON) |
| `GET` | `/api/regulations/{id}/raw` | Регламент сырым Turtle |
| `GET/PUT` | `/api/regulations/{id}/flow` | Rule DSL |
| `POST` | `/api/regulations/{id}/validate` | Валидация DSL |
| `GET` | `/api/regulations/{id}/flow/history` | История версий |
| `POST` | `/api/regulations/{id}/flow/restore/{version_id}` | Восстановить версию |
| `GET/PUT` | `/api/regulations/{id}/constraints` | SHACL constraints (наш JSON) |
| `GET` | `/api/regulations/{id}/shacl/export` | Turtle |
| `POST` | `/api/regulations/{id}/shacl/import` | multipart upload .ttl |
| `GET` | `/api/graph` | Cytoscape JSON всех регламентов |
| `GET` | `/api/graph/regulation/{id}` | Подграф одного |
| `POST` | `/api/search` | Поиск через RAGU (опционально) |

Upstream: проксируем `109.202.1.153:8958/api/v1/regulations/{source_id}/{data,shapes}`.

---

## RAGU GraphRAG (опционально)

```bash
.venv/bin/pip install graph_ragu
# в .env:
RAGU_ENABLED=true
OPENAI_BASE_URL=https://...
OPENAI_API_KEY=...
```

Иначе `/api/graph` собирается напрямую из domain объектов, а `/api/search` отвечает 503.

---

## Калибровочные данные

В [`backend/data/fixtures/`](backend/data/fixtures/INDEX.md) — реальный регламент из `Rules-Management.pdf`:
- `pressure-diameter.data.ttl` — онтология и инстанс `PressureAndDiameterRegulation` (Постановление № 001/2023, давление 20.5 ± 1.5 атм, диаметр 5.0 ± 0.2 см)
- `pressure-diameter.shapes.ttl` — `RegulationShape` (SHACL, 6 property constraints)
- `pressure-diameter.flow.json` — стартовый Rule DSL для редактора потока
- `etl-incoming.json` / `etl-enriched.json` — пример данных ETL из теплосети

По умолчанию `USE_FIXTURES=true` — данные берутся из этих файлов. Чтобы переключиться на живой upstream, поставь `USE_FIXTURES=false` в `backend/.env` (фикстура останется как fallback при недоступности).

---

## Стек

- **Backend:** FastAPI 0.115, pydantic 2, httpx, rdflib + pyshacl, networkx, опц. graph_ragu
- **Frontend:** React 18, Vite 5, TypeScript, Tailwind 3, React Flow 11, Cytoscape 3 + cola, @tanstack/react-query, zustand, react-router

---

## Реализовано (MVP)

- [x] Список регламентов (`/regulations`)
- [x] Graph View с Cytoscape + cola layout, легендой, side-panel
- [x] Rule Flow Editor: 7 типов узлов, DnD-палитра, property panel, save/validate
- [x] Constraint Editor: таблица, инлайн-редактирование, import/export SHACL Turtle
- [x] Validation: 7 правил, подсветка ошибочных узлов
- [x] Versioning: immutable JSON snapshots + restore UI

## Дальше (Should/Nice Have из спеки)

- [ ] Diff визуализация между версиями
- [ ] Approval workflow (draft → review → active)
- [ ] Анимация simulation mode
- [ ] AI-подсказки constraint через RAGU LocalSearch
- [ ] Code-splitting (предупреждение Vite о chunk > 500 kB)
