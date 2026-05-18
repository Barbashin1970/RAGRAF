"""Optional RAGU GraphRAG integration.

Heavy import (`graph_ragu`) is deferred so the backend boots without the
package installed. Enable via env `RAGU_ENABLED=true` and `pip install graph_ragu`.
"""
from __future__ import annotations

from typing import Any

from app.config import settings


class RaguDisabled(RuntimeError):
    pass


def _ensure_enabled() -> None:
    if not settings.ragu_enabled:
        raise RaguDisabled("RAGU отключён (RAGU_ENABLED=false)")


_kg: Any | None = None


# Размерности embedding-моделей (выход — вектор фиксированной длины).
# Используется для конфигурации EmbedderOpenAI и vector-store.
_EMBED_DIMS: dict[str, int] = {
    "bge-m3": 1024,
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "snowflake-arctic-embed": 1024,
    "all-minilm": 384,
}


def _embed_dim(model_name: str) -> int:
    """Размерность embedding-вектора по имени модели. Дефолт 1024 — самый распространённый."""
    base = model_name.split(":")[0].lower()
    return _EMBED_DIMS.get(base, 1024)


def get_knowledge_graph() -> Any:
    """Lazy singleton — initialises RAGU on first call.

    Новый API (graph_ragu 0.0.2+): сначала общий CachedAsyncOpenAI клиент,
    потом LLMOpenAI(client=..., model_name=...) и EmbedderOpenAI(client=..., model_name=..., dim=...).
    Раньше клиент пробрасывался кусками в каждый wrapper — отказались в пользу
    единого клиента с rate-limit/retry/cache shared.
    """
    global _kg  # sigma:allow P3 — process-singleton KnowledgeGraph, не рекурсия.
    _ensure_enabled()
    if _kg is not None:
        return _kg
    try:
        from ragu import BuilderArguments, KnowledgeGraph, Settings as RaguSettings  # type: ignore
        from ragu.models.embedder import EmbedderOpenAI  # type: ignore
        from ragu.models.llm import LLMOpenAI  # type: ignore
        from ragu.models.openai import CachedAsyncOpenAI  # type: ignore
    except ImportError as e:
        raise RaguDisabled(f"RAGU не установлен: {e}") from e

    RaguSettings.language = "russian"
    RaguSettings.storage_folder = settings.ragu_storage_folder

    client = CachedAsyncOpenAI(
        base_url=settings.openai_base_url or None,
        api_key=settings.openai_api_key or None,
    )
    llm = LLMOpenAI(client=client, model_name=settings.ragu_llm_model)
    embedder = EmbedderOpenAI(
        client=client,
        model_name=settings.ragu_embed_model,
        dim=_embed_dim(settings.ragu_embed_model),
    )

    builder = BuilderArguments(
        use_llm_summarization=True,
        make_community_summary=True,
        remove_isolated_nodes=True,
    )
    # graph_ragu 0.0.2+: builder_settings (раньше builder_args); language прокидываем
    # отдельным kwarg; tokenizer-имена оставляем gpt-4o / text-embedding-3-large для
    # tiktoken-подсчёта — это безопасный fallback и под Ollama-модели подойдёт
    # (мы не используем точный token-budget, а только индикативно ограничиваем chunk).
    _kg = KnowledgeGraph(
        llm=llm,
        embedder=embedder,
        builder_settings=builder,
        language="russian",
    )
    return _kg


def search(query: str, mode: str = "local") -> dict[str, Any]:
    """Sync. RAGU search engines синхронные. Если в будущем RAGU добавит
    async API — обернём в `async def` с `await engine.asearch(query)` или
    в `await asyncio.to_thread(engine.search, query)`.

    Перед вызовом `engine.search(...)` применяем все пользовательские
    overrides промптов (из DuckDB) через `ragu_prompts.apply_overrides_to`.
    Так пользователь может править системные промпты RAGU из UI без форка
    библиотеки.
    """
    _ensure_enabled()
    kg = get_knowledge_graph()
    try:
        if mode == "local":
            from ragu.search_engine import LocalSearchEngine  # type: ignore
            engine = LocalSearchEngine(kg)
        elif mode == "global":
            from ragu.search_engine import GlobalSearchEngine  # type: ignore
            engine = GlobalSearchEngine(kg)
        else:
            from ragu.search_engine import NaiveSearchEngine  # type: ignore
            engine = NaiveSearchEngine(kg)
        # Применяем overrides из DuckDB — list возвращённых имён можно
        # отдать клиенту в дебаг-целях, но search возвращает чисто response.
        from app.services import ragu_prompts
        ragu_prompts.apply_overrides_to(engine)
        result = engine.search(query)
        return {
            "response": getattr(result, "response", str(result)),
            "entities": getattr(result, "entities", []),
            "sources": getattr(result, "sources", []),
        }
    except ImportError as e:
        raise RaguDisabled(f"RAGU search engine не доступен: {e}") from e
