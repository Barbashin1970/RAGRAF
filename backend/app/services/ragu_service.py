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


def get_knowledge_graph() -> Any:
    """Lazy singleton — initialises RAGU on first call."""
    global _kg
    _ensure_enabled()
    if _kg is not None:
        return _kg
    try:
        from ragu import BuilderArguments, KnowledgeGraph, Settings as RaguSettings  # type: ignore
        from ragu.models.embedder import EmbedderOpenAI  # type: ignore
        from ragu.models.llm import LLMOpenAI  # type: ignore
    except ImportError as e:
        raise RaguDisabled(f"RAGU не установлен: {e}") from e

    RaguSettings.language = "russian"
    RaguSettings.storage_folder = settings.ragu_storage_folder

    llm = LLMOpenAI(
        model=settings.ragu_llm_model,
        base_url=settings.openai_base_url or None,
        api_key=settings.openai_api_key or None,
    )
    embedder = EmbedderOpenAI(
        model=settings.ragu_embed_model,
        base_url=settings.openai_base_url or None,
        api_key=settings.openai_api_key or None,
    )

    builder = BuilderArguments(
        use_llm_summarization=True,
        make_community_summary=True,
        remove_isolated_nodes=True,
    )
    _kg = KnowledgeGraph(llm=llm, embedder=embedder, builder_args=builder)
    return _kg


async def search(query: str, mode: str = "local") -> dict[str, Any]:
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
        result = engine.search(query)
        return {
            "response": getattr(result, "response", str(result)),
            "entities": getattr(result, "entities", []),
            "sources": getattr(result, "sources", []),
        }
    except ImportError as e:
        raise RaguDisabled(f"RAGU search engine не доступен: {e}") from e
