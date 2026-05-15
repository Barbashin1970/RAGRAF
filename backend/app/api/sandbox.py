"""Sandbox endpoints — демо-фичи поверх RAGU (mock или real)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services import document_analysis, document_store, fixtures, regulation_store, sandbox, templates
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
    """
    messages: list[ChatMessage] = Field(..., min_length=1)
    top_k: int = Field(4, ge=1, le=10)
    temperature: float | None = Field(None, ge=0.0, le=1.5)
    max_tokens: int | None = Field(None, ge=50, le=4000)


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
    )


@router.get("/sandbox/llm-info")
async def sandbox_llm_info() -> dict[str, Any]:
    """Подробная информация о LLM-стеке: текущие модели, доступность Ollama,
    список установленных моделей, размер семантического индекса, дефолты
    параметров генерации. Используется UI для отображения «состояние» в шапке
    Песочницы и в панели управления генерацией.
    """
    from app.services import embedding_index
    from app.config import settings as cfg

    info: dict[str, Any] = {
        "mode": sandbox.backend_mode(),
        "ragu_enabled": cfg.ragu_enabled,
        "llm_model": cfg.ragu_llm_model,
        "embed_model": cfg.ragu_embed_model,
        "base_url": cfg.openai_base_url or None,
        "defaults": {"temperature": 0.1, "top_k": 4, "max_tokens": 600},
        "limits": {
            "temperature": [0.0, 1.5],
            "top_k": [1, 10],
            "max_tokens": [50, 4000],
        },
        "llm_reachable": False,
        "llm_loaded_in_memory": False,
        "available_models": [],
        "index_size": 0,
    }

    # Пингуем Ollama без падения если её нет.
    if cfg.openai_base_url:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                # /api/tags — список всех скачанных моделей
                tags_url = cfg.openai_base_url.rstrip("/").rstrip("/v1") + "/api/tags"
                resp = await client.get(tags_url)
                if resp.status_code == 200:
                    info["llm_reachable"] = True
                    data = resp.json()
                    info["available_models"] = [m["name"] for m in data.get("models", [])]
                # /api/ps — модели, загруженные в RAM прямо сейчас
                ps_url = cfg.openai_base_url.rstrip("/").rstrip("/v1") + "/api/ps"
                resp = await client.get(ps_url)
                if resp.status_code == 200:
                    loaded = [m["name"] for m in resp.json().get("models", [])]
                    info["llm_loaded_in_memory"] = cfg.ragu_llm_model in loaded
                    info["loaded_models"] = loaded
        except Exception:
            pass

    # Размер embedding-индекса — без побочных эффектов (если ещё не построен, не строим).
    try:
        idx = embedding_index.get_index()
        info["index_size"] = len(idx._vectors)
        info["index_fresh"] = idx.is_fresh()
    except Exception:
        pass

    return info


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
    """Извлечь параметры из произвольного текста регламента.

    Mock-режим: regex по `число [± deviation] единица` + контекстный словарь
    (давление → pressure, температура → temperature и т.п.).
    """
    found = sandbox.extract_parameters(req.text)
    return {
        "mode": sandbox.backend_mode(),
        "extracted": found,
        "count": len(found),
    }


@router.post("/sandbox/create-from-params", status_code=201)
def sandbox_create_from_params(req: CreateFromParamsRequest) -> dict[str, Any]:
    """Собрать регламент из выбранных пользователем параметров.

    Замыкает цикл песочницы: текст → извлечённые параметры → регламент.
    Сохраняется в DuckDB (создаётся первая запись в history) + starter flow
    в `data/flows/`. Клиент после успеха переходит в `/regulations/:id/edit`,
    чтобы пользователь уточнил пороги и допилил Flow Editor.
    """
    valid_domains = {d["id"] for d in fixtures.list_domains()}
    if req.domain not in valid_domains:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестный домен '{req.domain}'. Доступны: {sorted(valid_domains)}",
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
    """Загрузить PDF или DOCX. Запускает полный пайплайн parse → chunk → embed."""
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
    """Cross-corpus анализ документа против корпуса регламентов.

    Возвращает «картину по доменам» (сколько регламентов каждого домена
    затронуто) + список релевантных регламентов с числом совпадений +
    LLM-summary. Время: ~5 сек retrieval + 10-30 сек LLM (qwen2.5:7b на M2).
    """
    try:
        return await document_analysis.analyze_document(doc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
