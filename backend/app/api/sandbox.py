"""Sandbox endpoints — демо-фичи поверх RAGU (mock или real)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services import document_analysis, document_store, domain_store, fixtures, regulation_store, sandbox, templates  # noqa: F401
from app.services.flow_storage import save_flow
from app.services.templates import ensure_unique_source_id, slugify

router = APIRouter()


class SearchRequest(BaseModel):
    query: str = Field(..., description="Запрос на естественном языке")
    top_k: int = Field(5, ge=1, le=20)


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    """Тело /sandbox/chat.

    `temperature` и `max_tokens` опциональны — если не заданы, используем
    серверные дефолты (0.1 и 600). Клампы здесь и есть линия защиты —
    клиенту не доверяем, потому что temperature > 1.5 даёт неконтролируемые
    бредовые ответы, а max_tokens > 4000 может на phi3 уронить контекст.

    `extra_system_prompt` — пользовательская доп-инструкция (из правой панели
    «Системный промпт» в Студии). Приклеивается к встроенному system-промпту,
    не заменяет его — иначе LLM потеряет регламентный контекст и анти-галлюц
    правила. Длина ограничена 4 КБ чтобы не раздувать prompt-eval.
    """
    messages: list[ChatMessage] = Field(..., min_length=1)
    top_k: int = Field(4, ge=1, le=10)
    temperature: float | None = Field(None, ge=0.0, le=1.5)
    # 16000 — потолок под cloud-провайдеры (Cerebras Qwen3-235B выдаёт до 16K
    # в одном ответе). Для Ollama UI самоограничит до 4000 через `limits` в
    # llm-info, но сам бэкенд принимает до 16000 — это не вредит, длинные
    # ответы Ollama просто медленно генерируются, но не падают.
    max_tokens: int | None = Field(None, ge=50, le=16000)
    extra_system_prompt: str | None = Field(None, max_length=4000)
    # Регламенты, исключённые из retrieval'а для этого запроса (галки сняты в
    # левой панели). Длина 0..200 чтобы не дать клиенту прислать монстр-список.
    # Пустой список = всё включено (дефолтное поведение).
    disabled_regulation_ids: list[str] = Field(default_factory=list, max_length=200)
    # Размер контекстного окна Ollama (`num_ctx`). Управляет тем сколько
    # токенов модель может «увидеть» — это вход + выход. По умолчанию None,
    # Ollama берёт значение из Modelfile (обычно 2048-4096), что часто мало
    # для длинных документов. Верхняя планка 32K — теоретически qwen2.5
    # тянет 128K через rope-scaling, но на M2 Air это съест всю RAM и
    # генерация превратится в часы.
    num_ctx: int | None = Field(None, ge=512, le=32768)
    # Override модели на конкретный запрос. None = settings.ragu_llm_model
    # (дефолт «точной» 7b). Frontend позволяет переключить на быструю 3b для
    # коротких сценариев. Имя 1-100 символов — Ollama примет любой tag, валидация
    # происходит на стороне Ollama (404 если модель не скачана).
    model: str | None = Field(None, min_length=1, max_length=100)


class ExtractRequest(BaseModel):
    text: str = Field(..., description="Сырой текст регламента (фрагмент Постановления, описание и т.п.)")


class ExtractedParamPayload(BaseModel):
    """Один параметр из результата `/sandbox/extract-parameters` для последующей сборки регламента."""
    suggested_name: str = Field(..., min_length=1)
    value: float
    deviation: float | None = None
    unit: str | None = None


class CreateFromParamsRequest(BaseModel):
    """Тело `POST /api/sandbox/create-from-params`.

    Третий шаг песочницы: «текст → извлечённые параметры → регламент».
    """
    name: str = Field(..., min_length=1, max_length=200)
    domain: str = Field(..., description="ID домена (heating / housing / safety / environment)")
    params: list[ExtractedParamPayload] = Field(..., min_length=1)


@router.get("/sandbox/status")
def sandbox_status() -> dict[str, Any]:
    """Текущий режим работы песочницы — mock или real (RAGU)."""
    return {
        "mode": sandbox.backend_mode(),
        "real_available": sandbox.is_real_ragu_available(),
        "demos": ["semantic-search", "extract-parameters"],
        "backlog": ["knowledge-graph", "compare-regulations"],
    }


@router.post("/sandbox/chat")
async def sandbox_chat(req: ChatRequest) -> dict[str, Any]:
    """Conversational Q&A над регламентами.

    Принимает историю чата (user/assistant turns), возвращает следующий ответ
    ассистента + список регламентов-источников (sources). При `RAGU_ENABLED=true`
    и достижимой Ollama — ответ генерирует LLM с retrieved-регламентами в
    system-prompt'е. В mock-режиме возвращает шаблонный ответ со списком найденного.

    Семантика follow-up'ов: LLM видит всю историю, так что вопрос «а ночью?» после
    «куда звонить при пожаре?» интерпретируется в контексте предыдущего ответа.
    """
    return await sandbox.chat(
        [m.model_dump() for m in req.messages],
        top_k=req.top_k,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        extra_system_prompt=req.extra_system_prompt,
        disabled_regulation_ids=req.disabled_regulation_ids,
        num_ctx=req.num_ctx,
        model=req.model,
    )


@router.get("/sandbox/llm-info")
async def sandbox_llm_info() -> dict[str, Any]:
    """Подробная информация о LLM-стеке: провайдер, текущая модель,
    доступность endpoint'а, список моделей (для Ollama — из /api/tags,
    для облачных провайдеров — preset из кода), флаг embeddings,
    дефолты параметров генерации. UI рисует по этому ответу шапку
    Песочницы, банер «embeddings off» и выпадашку моделей.
    """
    from app.services import embedding_index
    from app.config import settings as cfg

    # Для cloud-провайдеров поднимаем верхнюю границу max_tokens до 16000 —
    # Cerebras Qwen3-235B / gpt-oss-120b выдают до 16K в одном ответе, на M2
    # с qwen2.5:7b 4000 был рациональным потолком (RAM + время). Это меняет
    # только верхнюю границу слайдера — дефолт остаётся 600 (короткие ответы
    # для Q&A; длинные саммари — пользователь подкручивает сам).
    is_cloud = cfg.llm_provider not in ("ollama", "mock")
    max_tokens_cap = 16000 if is_cloud else 4000

    info: dict[str, Any] = {
        "mode": sandbox.backend_mode(),
        "provider": cfg.llm_provider,
        "embeddings_enabled": cfg.embeddings_enabled,
        "ragu_enabled": cfg.ragu_enabled,
        "llm_model": cfg.ragu_llm_model,
        "embed_model": cfg.ragu_embed_model,
        "base_url": cfg.openai_base_url or None,
        # Embedding endpoint может отличаться от chat endpoint'а (гибрид:
        # cloud chat + локальный bge-m3). UI показывает где живут embeddings.
        "embedding_base_url": cfg.effective_embedding_base_url or None,
        "hybrid_embeddings": bool(
            cfg.embedding_base_url
            and cfg.embedding_base_url != cfg.openai_base_url
        ),
        # `num_ctx` имеет смысл только для Ollama (она читает `extra_body.options.num_ctx`).
        # Cloud-провайдеры выбирают context-window сами по модели (не управляется
        # через API). UI скрывает слайдер если supports_num_ctx=false.
        "supports_num_ctx": cfg.llm_provider == "ollama",
        "defaults": {"temperature": 0.1, "top_k": 4, "max_tokens": 600},
        "limits": {
            "temperature": [0.0, 1.5],
            "top_k": [1, 10],
            "max_tokens": [50, max_tokens_cap],
        },
        "llm_reachable": False,
        "llm_loaded_in_memory": False,
        "available_models": _provider_model_presets(cfg.llm_provider, cfg.ragu_llm_model),
        "index_size": 0,
    }

    # Для Ollama — пингуем native эндпойнты /api/tags + /api/ps. Для облачных
    # провайдеров эти URL не существуют, поэтому считаем endpoint доступным
    # «оптимистично» по факту наличия base_url+api_key (реальная проверка —
    # первый chat-запрос, нет смысла тратить запрос на ping).
    if cfg.llm_provider == "ollama" and cfg.openai_base_url:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                tags_url = cfg.openai_base_url.rstrip("/").rstrip("/v1") + "/api/tags"
                resp = await client.get(tags_url)
                if resp.status_code == 200:
                    info["llm_reachable"] = True
                    data = resp.json()
                    info["available_models"] = [m["name"] for m in data.get("models", [])]
                ps_url = cfg.openai_base_url.rstrip("/").rstrip("/v1") + "/api/ps"
                resp = await client.get(ps_url)
                if resp.status_code == 200:
                    loaded = [m["name"] for m in resp.json().get("models", [])]
                    info["llm_loaded_in_memory"] = cfg.ragu_llm_model in loaded
                    info["loaded_models"] = loaded
        except Exception:
            pass
    elif cfg.llm_provider not in ("ollama", "mock") and cfg.openai_base_url:
        # Облачные OpenAI-совместимые провайдеры — пингуем `/v1/models`
        # чтобы получить актуальный список (Cerebras / Groq / OpenRouter / OpenAI
        # все поддерживают этот endpoint). На stale preset из кода больше не
        # полагаемся — если провайдер добавил / убрал модель, UI сразу увидит.
        # Fallback на preset если запрос упал (timeout / 401 / сеть).
        import httpx
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                models_url = cfg.openai_base_url.rstrip("/") + "/models"
                resp = await client.get(
                    models_url,
                    headers={"Authorization": f"Bearer {cfg.openai_api_key}"} if cfg.openai_api_key else {},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    live = [m["id"] for m in data.get("data", []) if m.get("id")]
                    if live:
                        # Если текущая модель из настроек есть в живом списке —
                        # ставим её первой, чтобы UI открывал picker с правильным
                        # выбором по умолчанию.
                        if cfg.ragu_llm_model in live:
                            live = [cfg.ragu_llm_model] + [m for m in live if m != cfg.ragu_llm_model]
                        info["available_models"] = live
                    info["llm_reachable"] = True
                else:
                    info["llm_reachable"] = bool(cfg.openai_api_key)
        except Exception:
            # Сетевой fail — оставляем preset из _provider_model_presets()
            # и доверяем наличию ключа как «должно работать».
            info["llm_reachable"] = bool(cfg.openai_api_key)

    # Размер embedding-индекса — без побочных эффектов (если ещё не построен, не строим).
    try:
        idx = embedding_index.get_index()
        info["index_size"] = len(idx._vectors)
        info["index_fresh"] = idx.is_fresh()
    except Exception:
        pass

    return info


def _provider_model_presets(provider: str, current: str) -> list[str]:
    """Список моделей по умолчанию для выпадашки UI. Для Ollama он будет
    переписан реальным `/api/tags` (если доступен) — это fallback на случай
    когда Ollama не пингуется. Для облачных провайдеров — захардкоженный
    хороший выбор для русскоязычного демо (free-tier на 2026).
    """
    presets: dict[str, list[str]] = {
        "ollama": [
            "qwen2.5:7b-instruct-q4_K_M",
            "qwen2.5:3b-instruct-q4_K_M",
            "llama3.2:3b",
        ],
        "cerebras": [
            # Реальный список из https://api.cerebras.ai/v1/models на 2026.
            # qwen-3-235b — MoE 235B-A22B, отличный русский, ~1500+ т/с.
            "qwen-3-235b-a22b-instruct-2507",
            "gpt-oss-120b",
            "zai-glm-4.7",
            "llama3.1-8b",
        ],
        "groq": [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen-qwq-32b",
        ],
        "openrouter": [
            "qwen/qwen-2.5-72b-instruct:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-r1:free",
        ],
        "openai": [
            "gpt-4o-mini",
            "gpt-4o",
        ],
        "mock": [],
    }
    items = list(presets.get(provider, []))
    if current and current not in items:
        items.insert(0, current)
    return items


@router.post("/sandbox/search")
def sandbox_search(req: SearchRequest) -> dict[str, Any]:
    """Семантический поиск по регламентам.

    Mock-режим: keyword scoring (name×3 + domain×2 + params×2 + recommendation×1).
    Возвращает список { regulation_id, regulation_name, domain, score, matched_terms, snippet }.
    """
    results = sandbox.semantic_search(req.query, top_k=req.top_k)
    return {
        "query": req.query,
        "mode": sandbox.backend_mode(),
        "results": results,
    }


@router.post("/sandbox/extract-parameters")
def sandbox_extract_parameters(req: ExtractRequest) -> dict[str, Any]:
    """Извлечь параметры из произвольного текста регламента + предсказать домен.

    Rules-based: regex по `число [± deviation] единица` + DuckDB-словарь
    extraction_terms (давление → pressure, дым → smokeConcentration, ...).
    Каждый термин может нести domain-тэг — это голос за предсказание домена
    регламента. predicted_domain = argmax по сумме голосов.
    """
    result = sandbox.extract_parameters(req.text)
    return {
        "mode": sandbox.backend_mode(),
        "extracted": result["extracted"],
        "count": len(result["extracted"]),
        "predicted_domain": result["predicted_domain"],
        "domain_scores": result["domain_scores"],
    }


@router.post("/sandbox/create-from-params", status_code=201)
def sandbox_create_from_params(req: CreateFromParamsRequest) -> dict[str, Any]:
    """Собрать регламент из выбранных пользователем параметров.

    Замыкает цикл песочницы: текст → извлечённые параметры → регламент.
    Сохраняется в DuckDB (создаётся первая запись в history) + starter flow
    в `data/flows/`. Клиент после успеха переходит в `/regulations/:id/edit`,
    чтобы пользователь уточнил пороги и допилил Flow Editor.
    """
    if not domain_store.exists(req.domain):
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестный домен '{req.domain}'. Доступны: {[d['id'] for d in domain_store.list_all()]}",
        )

    source_id = ensure_unique_source_id(slugify(req.name))
    try:
        reg, flow = templates.build_regulation_from_params(
            source_id=source_id,
            domain=req.domain,
            name=req.name,
            extracted=[p.model_dump() for p in req.params],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    regulation_store.save(
        reg,
        author="anonymous",
        comment="Создан через песочницу из извлечённых параметров",
    )
    if flow.nodes:
        save_flow(source_id, flow, author="anonymous", comment="Starter flow из песочницы")

    return {
        "regulation_id": source_id,
        "name": reg.name,
        "domain": reg.domain,
        "parameters_count": len(reg.parameters),
    }


# ── Documents (NotebookLM-style контекст для Q&A) ────────────────────


class DocumentToggleRequest(BaseModel):
    enabled: bool


@router.get("/sandbox/documents")
def sandbox_list_documents() -> dict[str, Any]:
    """Список загруженных аналитиком документов.

    Каждый документ имеет toggle `enabled` — включён ли в контекст Q&A.
    NotebookLM-паттерн: 1–3 источника включены одновременно для конкретного
    вопроса; UI показывает предупреждение про скорость при 2+ enabled
    (контекст растёт линейно, qwen2.5:7b на M2 уже неспешный).
    """
    docs = document_store.list_documents()
    return {
        "documents": docs,
        "limits": {
            "max_documents": document_store.MAX_DOCUMENTS,
            "max_file_size_bytes": document_store.MAX_FILE_SIZE,
            "current_count": len(docs),
            "enabled_count": sum(1 for d in docs if d["enabled"]),
        },
    }


@router.post("/sandbox/documents/upload", status_code=201)
async def sandbox_upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    """Загрузить PDF или DOCX. Запускает полный пайплайн parse → chunk → embed.

    Когда `settings.embeddings_enabled=False` (демо-режим без embedding-провайдера)
    отдаём 503 — без векторов retrieval по PDF деградирует до substring-поиска,
    это бесполезный UX. Лучше явно сказать пользователю что фича выключена,
    чем дать загрузить документ и потом не суметь по нему отвечать.
    """
    from app.config import settings as cfg
    if not cfg.embeddings_enabled:
        raise HTTPException(
            status_code=503,
            detail=(
                "Загрузка документов отключена: текущий LLM-провайдер не предоставляет "
                "embeddings. Включить можно установив EMBEDDINGS_ENABLED=true и подключив "
                "embedding-провайдер (Ollama bge-m3 локально, либо Gemini text-embedding-004)."
            ),
        )
    if not file.filename:
        raise HTTPException(status_code=400, detail="Имя файла обязательно")
    data = await file.read()
    mime = file.content_type or "application/octet-stream"
    try:
        meta = await document_store.add_document(file.filename, mime, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return meta


@router.patch("/sandbox/documents/{doc_id}")
def sandbox_toggle_document(doc_id: str, req: DocumentToggleRequest) -> dict[str, Any]:
    """Включить / выключить документ из контекста Q&A."""
    doc = document_store.toggle_document(doc_id, req.enabled)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Документ {doc_id} не найден")
    return doc


@router.delete("/sandbox/documents/{doc_id}")
def sandbox_delete_document(doc_id: str) -> dict[str, str]:
    """Удалить документ и все его chunks."""
    if not document_store.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Документ {doc_id} не найден")
    return {"doc_id": doc_id, "status": "deleted"}


@router.post("/sandbox/documents/{doc_id}/analyze")
async def sandbox_analyze_document(doc_id: str) -> dict[str, Any]:
    """Быстрый cross-corpus анализ документа против корпуса регламентов.

    Возвращает «картину по доменам» + список релевантных регламентов +
    структурированный fallback-summary без LLM. Целевое время: ~5-10 сек
    (зависит от размера документа). LLM-summary вынесена в отдельный
    эндпойнт `/analyze-summary` — она тяжёлая (60-120 сек на M2 Air,
    swap-thrashing на qwen2.5:7b), пользователь зовёт её по явной кнопке.
    """
    try:
        return await document_analysis.analyze_document(doc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


class ModelOpRequest(BaseModel):
    """Тело `/sandbox/llm/{load,unload}`. Имя модели — Ollama tag."""
    model: str = Field(..., min_length=1, max_length=100)


@router.post("/sandbox/llm/load")
async def sandbox_llm_load(req: ModelOpRequest) -> dict[str, Any]:
    """Принудительно загрузить модель в RAM Ollama. Используется кнопкой
    «Загрузить» в правой панели — даёт UX «нажми и подожди прогрев», после
    чего следующий чат-запрос идёт без задержки на cold-start.

    Реализация: дёргаем native Ollama `/api/generate` с пустым промптом и
    `keep_alive: -1` (держать в памяти бессрочно). Ollama не генерирует
    токены, но загружает веса в VRAM/RAM.
    """
    from app.config import settings as cfg
    if cfg.llm_provider != "ollama":
        raise HTTPException(
            status_code=400,
            detail=f"Управление RAM-загрузкой моделей доступно только для Ollama, текущий провайдер: {cfg.llm_provider}",
        )
    if not cfg.openai_base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL не задан")
    base = cfg.openai_base_url.rstrip("/").rstrip("/v1")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{base}/api/generate",
                json={"model": req.model, "prompt": "", "keep_alive": -1, "stream": False},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Ollama: {r.status_code} {r.text[:200]}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Ollama недоступен: {e}") from e
    return {"ok": True, "model": req.model, "status": "loaded"}


@router.post("/sandbox/llm/unload")
async def sandbox_llm_unload(req: ModelOpRequest) -> dict[str, Any]:
    """Принудительно выгрузить модель из RAM Ollama (`keep_alive: 0`).
    Освобождает 2-5 ГБ памяти когда модель больше не нужна. Следующий
    запрос будет с cold-start."""
    from app.config import settings as cfg
    if cfg.llm_provider != "ollama":
        raise HTTPException(
            status_code=400,
            detail=f"Управление RAM-загрузкой моделей доступно только для Ollama, текущий провайдер: {cfg.llm_provider}",
        )
    if not cfg.openai_base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL не задан")
    base = cfg.openai_base_url.rstrip("/").rstrip("/v1")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{base}/api/generate",
                json={"model": req.model, "keep_alive": 0, "stream": False},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Ollama: {r.status_code} {r.text[:200]}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Ollama недоступен: {e}") from e
    return {"ok": True, "model": req.model, "status": "unloaded"}


@router.post("/sandbox/documents/{doc_id}/analyze-summary")
async def sandbox_analyze_document_summary(doc_id: str) -> dict[str, Any]:
    """LLM-саммари по документу (qwen2.5:7b). Тяжёлая операция, отдельным
    эндпойнтом — UI зовёт по явной кнопке «Сгенерировать LLM-анализ»."""
    try:
        return await document_analysis.analyze_document_summary(doc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
