from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import datasets, extraction_terms, flow, graph, ragu, regulations, sandbox, sensor_schemas, shacl, search, validate, versions
from app.config import settings
from app.services import regulation_store, sensor_schema_store


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Создаём DuckDB schema и сидим из фикстур при первом старте.
    try:
        regulation_store.init_db()
    except Exception as e:
        print(f"[lifespan] regulation_store.init_db failed: {e}")
    # Registry полей датчиков — отдельная таблица, идемпотентный seed.
    try:
        sensor_schema_store.init_db()
    except Exception as e:
        print(f"[lifespan] sensor_schema_store.init_db failed: {e}")
    # Словарь rules-based извлечения — отдельная таблица, идемпотентный seed.
    try:
        from app.services import extraction_term_store
        extraction_term_store.init_db()
    except Exception as e:
        print(f"[lifespan] extraction_term_store.init_db failed: {e}")
    yield


TAGS_METADATA = [
    {
        "name": "sandbox",
        "description": (
            "Песочница RAGU — изолированные демо-сценарии: семантический поиск "
            "по регламентам, авто-извлечение параметров из произвольного текста. "
            "По умолчанию работает в mock-режиме (regex + keyword scoring), "
            "без необходимости LLM-ключей. При `RAGU_ENABLED=true` сможет "
            "переключиться на реальный `graph_ragu` (`LocalSearchEngine`, "
            "`TwoStageArtifactsExtractorLLM` etc.)."
        ),
    },
    {
        "name": "meta",
        "description": "Служебные эндпоинты — health-check и базовая информация о сервисе.",
    },
    {
        "name": "datasets",
        "description": (
            "Список регламентов, доступных пользователю. Объединяет данные из "
            "локального DuckDB-store (`backend/data/regulations.duckdb`) и "
            "upstream Sigma API (`/admin/datasets/`). При `USE_FIXTURES=true` "
            "отдаются только seed-фикстуры."
        ),
    },
    {
        "name": "regulations",
        "description": (
            "Чтение, редактирование, версионирование и approval-workflow "
            "регламента. Domain-modelled — параметры, рекомендации, метаданные. "
            "Все правки идут в DuckDB; при `WRITEBACK_UPSTREAM=true` "
            "сериализуются в Turtle и публикуются в upstream `PUT /data`."
        ),
    },
    {
        "name": "flow",
        "description": (
            "Rule DSL — визуальное правило реагирования (React Flow-граф из 7 "
            "типов узлов). Загрузка / сохранение / валидация (7 правил из "
            "regulation-viz-skill.md § Validation Rules)."
        ),
    },
    {
        "name": "versions",
        "description": (
            "История версий Rule DSL — immutable JSON-snapshots в "
            "`data/versions/{regulation_id}/{version_id}.json`. Restore "
            "восстанавливает любую версию."
        ),
    },
    {
        "name": "shacl",
        "description": (
            "SHACL-ограничения как табличный CRUD и как Turtle import/export. "
            "Маппинг `Constraint` ↔ `sh:NodeShape` через rdflib."
        ),
    },
    {
        "name": "graph",
        "description": (
            "Cytoscape-карта регламентов: список доменов и payload для UI. "
            "Поддерживает фильтр `?domain=heating|housing|safety|environment`."
        ),
    },
    {
        "name": "search",
        "description": (
            "Семантический поиск через RAGU (GraphRAG). Активен только при "
            "`RAGU_ENABLED=true` и наличии `graph_ragu` в окружении — иначе 503."
        ),
    },
]


app = FastAPI(
    title="RAGRAF API",
    version="0.1.0",
    summary="Визуализатор и редактор регламентов поверх Regulation Management API (Sigma)",
    description=(
        "REST API сервиса **RAGRAF** — слой над upstream Sigma "
        "([109.202.1.153:8958](http://109.202.1.153:8958/docs)) с собственным "
        "хранилищем правок (DuckDB) и слоем сериализации Regulation ↔ Turtle / SHACL.\n\n"
        "**Архитектура источников при чтении `/regulations/{id}`:**\n"
        "1. DuckDB store (если регламент редактировался)\n"
        "2. Локальная фикстура (golden seed из `Rules-Management.pdf`)\n"
        "3. Upstream Sigma API (когда `USE_FIXTURES=false`)\n\n"
        "**Запись через PUT:** всегда DuckDB + версия в `regulation_history`. "
        "При `WRITEBACK_UPSTREAM=true` дополнительно публикуется в upstream `/data`.\n\n"
        "Полная спецификация: [`regulation-viz-skill.md`](https://github.com/RaguTeam/RAGU). "
        "Каталог фикстур: [`backend/data/fixtures/INDEX.md`](../backend/data/fixtures/INDEX.md)."
    ),
    contact={
        "name": "RAGRAF",
        "url": "http://localhost:5173",
    },
    license_info={
        "name": "Internal",
    },
    openapi_tags=TAGS_METADATA,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    """Health-check для Railway / docker-compose. Возвращает 200 как только
    FastAPI поднял lifespan и слушает порт. Дублируется на /api/health чтобы
    из-под reverse-proxy запрос не уходил в SPA-catch-all."""
    return {"status": "ok"}


# All v1 endpoints are mounted under /api so the frontend uses /api/...
app.include_router(datasets.router, prefix="/api", tags=["datasets"])
app.include_router(regulations.router, prefix="/api", tags=["regulations"])
app.include_router(flow.router, prefix="/api", tags=["flow"])
app.include_router(validate.router, prefix="/api", tags=["flow"])
app.include_router(versions.router, prefix="/api", tags=["versions"])
app.include_router(shacl.router, prefix="/api", tags=["shacl"])
app.include_router(graph.router, prefix="/api", tags=["graph"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(sandbox.router, prefix="/api", tags=["sandbox"])
app.include_router(ragu.router, prefix="/api", tags=["ragu"])
app.include_router(sensor_schemas.router, prefix="/api", tags=["sensor-schemas"])
app.include_router(extraction_terms.router, prefix="/api", tags=["extraction-terms"])


# ── SPA static serving ────────────────────────────────────────────────
# В dev (vite на 5173 проксирует /api → :8000) этот блок выключен — settings.static_dir
# пустой. На проде в Dockerfile укажем STATIC_DIR=/srv/frontend_dist, и
# FastAPI начнёт раздавать:
#   - /assets/* — статика с долгим cache (Vite-хеширует имена файлов)
#   - / и любой неизвестный путь — index.html (для роутов React Router)
# Catch-all регистрируется ПОСЛЕ всех api-роутеров, иначе перехватит /api/*.
if settings.static_dir:
    _static_root = Path(settings.static_dir).resolve()
    if _static_root.is_dir():
        _assets_dir = _static_root / "assets"
        if _assets_dir.is_dir():
            # Vite кладёт хешированные JS/CSS в /assets — раздаём с
            # immutable-cache (1 год), браузер не дёргает их повторно.
            app.mount(
                "/assets",
                StaticFiles(directory=str(_assets_dir)),
                name="assets",
            )

        _index_html = _static_root / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            # /api/* уже выловлены роутерами выше; если запрос дошёл сюда —
            # это либо реальный файл (vite.svg, favicon.ico), либо
            # клиентский маршрут SPA → отдаём index.html.
            # Хендлер sync — внутри только Path-операции (resolve/is_file),
            # которые синхронные. FastAPI выполнит их в threadpool. Раньше
            # был помечен async без await (sigma-audit P8.3 → исправлено).
            # Блокируем path-traversal: resolve относительно root.
            if full_path:
                candidate = (_static_root / full_path).resolve()
                if (
                    _static_root in candidate.parents
                    and candidate.is_file()
                ):
                    return FileResponse(candidate)
            if _index_html.is_file():
                return FileResponse(_index_html)
            raise HTTPException(status_code=404, detail="SPA index.html not found")
