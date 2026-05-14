"""Семантический индекс регламентов на основе bge-m3 embeddings через Ollama.

Зачем: текущий TF-IDF (`sandbox.semantic_search`) ловит общие предлоги вроде «при»
(встречается в названии каждого регламента), а stem `навод` не матчит `проте`,
хотя «наводнение» и «протечка» концептуально близки. Embedding-similarity это
решает: модель видела оба слова в контексте «вода/затопление» и располагает их
рядом в векторном пространстве.

Индекс ленив (`_INDEX` строится при первом обращении), пересобирается когда
меняется набор регламентов (детектится по сигнатуре `id+name+rec_text`). Хранится
только в памяти — при перезапуске backend'а первое обращение к /chat будет на
~5 сек медленнее, дальше всё в RAM.
"""
from __future__ import annotations

import asyncio
import hashlib
import math
from typing import Any

from app.config import settings
from app.services import regulation_store


class EmbeddingIndex:
    """In-memory cosine-similarity индекс {regulation_id: vector}."""

    def __init__(self) -> None:
        self._vectors: dict[str, list[float]] = {}
        self._signature: str = ""

    def signature(self) -> str:
        """Хэш текущего состава регламентов — для детекта что нужно пересобрать."""
        items = sorted(regulation_store.list_all(), key=lambda r: r["id"])
        h = hashlib.sha256()
        for it in items:
            reg = regulation_store.get(it["id"])
            if reg is None:
                continue
            h.update(reg.id.encode())
            h.update((reg.name or "").encode())
            for r in reg.recommendations:
                h.update((r.text or "").encode())
        return h.hexdigest()

    def is_fresh(self) -> bool:
        return self._signature == self.signature() and bool(self._vectors)

    @staticmethod
    def _doc_text(reg: Any) -> str:
        """Какой текст пакуем в эмбеддинг — определяет качество поиска."""
        parts: list[str] = []
        if reg.name:
            parts.append(reg.name)
        if reg.domain:
            parts.append(f"Домен: {reg.domain}")
        param_names = [p.name for p in reg.parameters]
        if param_names:
            parts.append("Параметры: " + ", ".join(param_names))
        for r in reg.recommendations:
            if r.text:
                parts.append(r.text)
        return ". ".join(parts)

    async def rebuild(self) -> None:
        """Пере-эмбеддит все регламенты. Зовётся когда signature не совпадает.

        Sigma-audit P8: батчим все тексты в один embeddings.create(input=[...])
        вместо N последовательных await'ов. Ollama батчит на сервере → 1 HTTP
        round-trip вместо N. Для N>5 заметно быстрее, для N=1 эквивалентно.
        """
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url=settings.openai_base_url or None,
            api_key=settings.openai_api_key or "ollama",
            timeout=60.0,
        )
        ids: list[str] = []
        texts: list[str] = []
        for it in regulation_store.list_all():
            reg = regulation_store.get(it["id"])
            if reg is None:
                continue
            text = self._doc_text(reg)
            if not text.strip():
                continue
            ids.append(reg.id)
            texts.append(text)

        if texts:
            resp = await client.embeddings.create(
                model=settings.ragu_embed_model,
                input=texts,
            )
            self._vectors = {rid: list(d.embedding) for rid, d in zip(ids, resp.data)}
        else:
            self._vectors = {}
        self._signature = self.signature()

    async def search(self, query: str, top_k: int = 5) -> list[tuple[str, float]]:
        """Возвращает [(regulation_id, similarity_score)] top-k по убыванию."""
        if not self.is_fresh():
            await self.rebuild()
        if not self._vectors or not (query or "").strip():
            return []
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url=settings.openai_base_url or None,
            api_key=settings.openai_api_key or "ollama",
            timeout=60.0,
        )
        resp = await client.embeddings.create(
            model=settings.ragu_embed_model,
            input=query,
        )
        qvec = list(resp.data[0].embedding)
        scored: list[tuple[str, float]] = [
            (rid, _cosine(qvec, vec)) for rid, vec in self._vectors.items()
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# Singleton — переживает между запросами в рамках одного процесса uvicorn.
_INDEX: EmbeddingIndex | None = None


def get_index() -> EmbeddingIndex:
    global _INDEX
    if _INDEX is None:
        _INDEX = EmbeddingIndex()
    return _INDEX


async def semantic_search_embeddings(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Drop-in замена `sandbox.semantic_search` через bge-m3 embeddings.

    Возвращает список в том же формате, что и TF-IDF-версия — клиенту менять
    ничего не нужно. matched_terms не вычисляются (для embedding-search их не
    имеет смысла показывать), вместо этого подсвечиваем top-keywords из
    регламента — это даёт пользователю понятный "почему".
    """
    idx = get_index()
    pairs = await idx.search(query, top_k=top_k)
    results: list[dict[str, Any]] = []
    for rid, score in pairs:
        reg = regulation_store.get(rid)
        if reg is None:
            continue
        snippet = ""
        if reg.recommendations and reg.recommendations[0].text:
            full = reg.recommendations[0].text
            # Берём первое предложение для краткости.
            for sep in [". ", "! ", "? ", ".\n"]:
                idx_sep = full.find(sep)
                if idx_sep != -1 and idx_sep < 250:
                    full = full[: idx_sep + 1]
                    break
            snippet = full[:250].rstrip()
        results.append({
            "regulation_id": reg.id,
            "regulation_name": reg.name,
            "domain": reg.domain,
            # Косинус 0..1 → шкалируем к 0..10 для UI-совместимости со старым score.
            "score": round(score * 10, 2),
            "matched_terms": [],
            "snippet": snippet,
            "parameters_count": len(reg.parameters),
        })
    return results


def reset_index() -> None:
    """Принудительно сбросить индекс — пригодится при тестах и перезагрузке фикстур."""
    global _INDEX
    _INDEX = None


# Async-safe wrapper если кто-то хочет звать из sync кода (например тестов).
def semantic_search_embeddings_sync(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    return asyncio.run(semantic_search_embeddings(query, top_k))
