"""Cross-corpus анализ загруженного аналитиком документа против корпуса регламентов.

Что делает: для каждого chunk документа находит top-N релевантных регламентов
через bge-m3, агрегирует по доменам, генерирует LLM-summary с описанием связей.

Использует:
- `embedding_index` для семантического поиска (bge-m3 уже batched в индексе)
- Опционально RAGU `ArtifactsExtractorLLM` для извлечения сущностей из документа
- Прямой LLM-вызов для финального summary

Алгоритм (one-pass over chunks):
  1. Загрузить все chunks документа.
  2. Для каждого chunk → bge-m3 semantic_search → top-K регламентов.
  3. Aggregate: уникальные регламенты, count of chunk-matches, max score.
  4. Group by domain (heating/housing/safety/environment).
  5. Sample 3 наиболее информативных chunks (по длине после нормализации).
  6. LLM summary с указанием тем документа и найденных связей.

Время на корпусе 6 регламентов × 50 chunks: ~5 сек retrieval + 10-30 сек LLM.
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from app.config import settings
from app.services import regulation_store


# Сколько chunks макс анализируем за один проход. Длинные PDF дают сотни
# чанков; 50 — sweet spot между полнотой и временем (на M2 Air retrieval
# ~3 сек на 50 параллельных embed-запросах). При превышении выбираем
# uniformly-распределённую выборку, чтобы покрыть весь документ.
_MAX_CHUNKS_FOR_RETRIEVAL = 50


def _sample_chunks_uniform(chunks: list[dict[str, str]], cap: int) -> list[dict[str, str]]:
    """Если chunks > cap — берём uniform по индексу подвыборку из cap элементов.
    Сохраняет начало/середину/конец документа в выборке, чтобы анализ покрывал
    весь документ, а не только первые N страниц."""
    n = len(chunks)
    if n <= cap:
        return chunks
    step = n / cap
    return [chunks[int(i * step)] for i in range(cap)]


async def analyze_document(doc_id: str) -> dict[str, Any]:
    """Анализ без LLM: chunks → retrieval → spectrum + fallback summary.

    LLM-саммари выделена в отдельный эндпойнт (`analyze_document_summary`),
    чтобы UI рендерил данные сразу — иначе пользователь видит «бесконечный»
    спиннер 60-120 сек пока qwen2.5:7b генерирует текст на M2 Air.

    Возвращает структуру для UI:
      {
        "doc_id": ...,
        "filename": ...,
        "domain_spectrum": [{domain, regulation_count, total_hits}, ...],
        "regulations": [{regulation_id, name, domain, hits, max_score}, ...],
        "summary": "fallback-текст без LLM" (structured),
        "summary_llm_available": True/False (можно ли запросить LLM-summary),
        "stats": {chunks_analyzed, regulations_matched, avg_hits_per_chunk}
      }
    """
    chunks_data = _load_document_chunks(doc_id)
    if not chunks_data:
        raise ValueError(f"Документ {doc_id} не найден или пуст")

    filename = chunks_data["filename"]
    all_chunks = chunks_data["chunks"]  # list of {chunk_id, text}
    if not all_chunks:
        return {
            "doc_id": doc_id,
            "filename": filename,
            "domain_spectrum": [],
            "regulations": [],
            "summary": "Документ не содержит фрагментов для анализа.",
            "summary_llm_available": False,
            "stats": {"chunks_analyzed": 0, "regulations_matched": 0, "avg_hits_per_chunk": 0.0},
        }

    # Uniform-sampling chunks для retrieval — длинные PDF не уводят backend
    # в 200+ параллельных embed-запросов, при этом покрытие документа полное.
    chunks = _sample_chunks_uniform(all_chunks, _MAX_CHUNKS_FOR_RETRIEVAL)

    # Retrieval pass: для каждого chunk top-3 регламентов
    chunk_hits = await _retrieve_for_chunks(chunks, top_k=3)

    # Aggregate
    reg_hits: dict[str, int] = defaultdict(int)
    reg_max_score: dict[str, float] = defaultdict(float)
    reg_chunk_examples: dict[str, list[str]] = defaultdict(list)
    for chunk, hits in zip(chunks, chunk_hits):
        for h in hits:
            rid = h["regulation_id"]
            reg_hits[rid] += 1
            score = h.get("score", 0.0)
            if score > reg_max_score[rid]:
                reg_max_score[rid] = score
            # Запомним 1-2 примера chunks для каждого регламента — пригодится для UI
            if len(reg_chunk_examples[rid]) < 2:
                reg_chunk_examples[rid].append(chunk["text"][:200])

    # Group by domain + build list
    regulations: list[dict[str, Any]] = []
    domain_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"regulation_count": 0, "total_hits": 0})
    for rid, hits_count in reg_hits.items():
        reg = regulation_store.get(rid)
        if reg is None:
            continue
        domain = reg.domain or "unknown"
        regulations.append(
            {
                "regulation_id": rid,
                "name": reg.name,
                "domain": domain,
                "hits": hits_count,
                "max_score": round(reg_max_score[rid], 3),
                "chunk_examples": reg_chunk_examples[rid],
            }
        )
        domain_stats[domain]["regulation_count"] += 1
        domain_stats[domain]["total_hits"] += hits_count

    # Sort regulations: by hits desc, then by score desc
    regulations.sort(key=lambda r: (r["hits"], r["max_score"]), reverse=True)

    # Build domain spectrum (sorted by total_hits)
    domain_spectrum = sorted(
        (
            {"domain": d, "regulation_count": s["regulation_count"], "total_hits": s["total_hits"]}
            for d, s in domain_stats.items()
        ),
        key=lambda x: x["total_hits"],
        reverse=True,
    )

    # Fast path: возвращаем структурированный fallback-summary без LLM-вызова.
    # На M2 Air qwen2.5:7b занимает ~4.4 ГБ RAM и съедает CPU на 60-120 сек на
    # генерации — UI зависал, курсор лагал из-за swap-thrashing. LLM-саммари
    # теперь отдельным эндпойнтом по явному запросу.
    summary = _build_summary_fallback(filename, regulations, domain_spectrum)

    return {
        "doc_id": doc_id,
        "filename": filename,
        "domain_spectrum": domain_spectrum,
        "regulations": regulations,
        "summary": summary,
        "summary_llm_available": bool(settings.ragu_enabled and regulations),
        "stats": {
            "chunks_analyzed": len(chunks),
            "regulations_matched": len(regulations),
            "avg_hits_per_chunk": round(
                sum(reg_hits.values()) / max(len(chunks), 1), 2
            ),
        },
    }


async def analyze_document_summary(doc_id: str) -> dict[str, Any]:
    """LLM-саммари по уже-проанализированному документу. Слепить один абзац
    через qwen2.5 — это тяжёлая операция (4.4 ГБ RAM, 60-120 сек на M2 Air),
    поэтому вынесена отдельным эндпойнтом: UI зовёт её по явной кнопке
    «Сгенерировать LLM-анализ» когда пользователь готов подождать.

    Возвращает `{"doc_id", "summary"}`. На ошибке/таймауте — fallback-текст
    с пометкой «LLM недоступна».
    """
    if not settings.ragu_enabled:
        return {
            "doc_id": doc_id,
            "summary": "LLM выключена (RAGU_ENABLED=false). Доступен только структурированный отчёт.",
        }

    chunks_data = _load_document_chunks(doc_id)
    if not chunks_data:
        raise ValueError(f"Документ {doc_id} не найден или пуст")
    all_chunks = chunks_data["chunks"]
    if not all_chunks:
        return {"doc_id": doc_id, "summary": "Документ пуст — нечего анализировать."}

    # Повторяем retrieval только чтобы сформировать input для LLM. Можно было
    # бы кэшировать результат analyze_document, но 6 регламентов × 50 chunks
    # retrieval'а ~5 сек — мизерная доля LLM-генерации, не стоит ботвы кэша.
    chunks = _sample_chunks_uniform(all_chunks, _MAX_CHUNKS_FOR_RETRIEVAL)
    chunk_hits = await _retrieve_for_chunks(chunks, top_k=3)

    reg_hits: dict[str, int] = defaultdict(int)
    reg_max_score: dict[str, float] = defaultdict(float)
    for _ch, hits in zip(chunks, chunk_hits):
        for h in hits:
            rid = h["regulation_id"]
            reg_hits[rid] += 1
            score = h.get("score", 0.0)
            if score > reg_max_score[rid]:
                reg_max_score[rid] = score

    regulations: list[dict[str, Any]] = []
    domain_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"regulation_count": 0, "total_hits": 0})
    for rid, hits_count in reg_hits.items():
        reg = regulation_store.get(rid)
        if reg is None:
            continue
        domain = reg.domain or "unknown"
        regulations.append({
            "regulation_id": rid, "name": reg.name, "domain": domain,
            "hits": hits_count, "max_score": round(reg_max_score[rid], 3),
        })
        domain_stats[domain]["regulation_count"] += 1
        domain_stats[domain]["total_hits"] += hits_count
    regulations.sort(key=lambda r: (r["hits"], r["max_score"]), reverse=True)

    domain_spectrum = sorted(
        ({"domain": d, "regulation_count": s["regulation_count"], "total_hits": s["total_hits"]}
         for d, s in domain_stats.items()),
        key=lambda x: x["total_hits"], reverse=True,
    )

    summary = await _generate_summary(chunks_data["filename"], chunks, regulations, domain_spectrum)
    return {"doc_id": doc_id, "summary": summary}


def _load_document_chunks(doc_id: str) -> dict[str, Any] | None:
    """Достать filename + все chunks документа."""
    with regulation_store._LOCK:
        c = regulation_store._connection()
        head = c.execute(
            "SELECT filename FROM user_documents WHERE doc_id = ?", [doc_id]
        ).fetchone()
        if not head:
            return None
        rows = c.execute(
            """
            SELECT chunk_id, text
            FROM document_chunks
            WHERE doc_id = ?
            ORDER BY chunk_index
            """,
            [doc_id],
        ).fetchall()
    return {
        "filename": head[0],
        "chunks": [{"chunk_id": r[0], "text": r[1]} for r in rows],
    }


async def _retrieve_for_chunks(
    chunks: list[dict[str, str]], top_k: int = 3
) -> list[list[dict[str, Any]]]:
    """Для каждого chunk — top-K регламентов по semantic similarity.

    Используем уже работающий `embedding_index.semantic_search_embeddings` —
    он кэширует bge-m3 индекс корпуса регламентов в памяти, ревалидируется
    по сигнатуре корпуса. Один embed-batch на запрос (1 chunk), top-K cosine.

    Sigma-audit P8: запускаем все chunks параллельно через asyncio.gather —
    Ollama-сервер handle'ит конкурентные embed-запросы через bge-m3 в VRAM,
    50 параллельных round-trips занимают ~3 сек вместо 30 сек последовательно.
    """
    import asyncio

    from app.services.embedding_index import semantic_search_embeddings

    tasks = [semantic_search_embeddings(ch["text"], top_k=top_k) for ch in chunks]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [
        r if isinstance(r, list) else []
        for r in results
    ]


async def _generate_summary(
    filename: str,
    chunks: list[dict[str, str]],
    regulations: list[dict[str, Any]],
    domain_spectrum: list[dict[str, Any]],
) -> str:
    """Сгенерировать связный summary через qwen2.5 на основе агрегата.

    Не передаём LLM все chunks (контекст бы переполнился) — только top-3
    наиболее информативных (по длине) + список найденных регламентов.
    LLM объясняет какие темы документа пересекаются с какими доменами/регламентами.
    """
    if not settings.ragu_enabled or not regulations:
        # Fallback без LLM — структурированный текст по data
        return _build_summary_fallback(filename, regulations, domain_spectrum)

    # 2 chunks с обрезкой по 600 символов: prompt-eval на qwen2.5:7b/M2 Air —
    # ~50 tok/s; 4×800 chars/chunk ≈ 600-800 tokens → ~15 сек только на prefill.
    # 2×600 chars ≈ 300 tokens → ~6 сек. Качество summary почти не падает —
    # ретривер уже выделил релевантные регламенты.
    sampled = sorted(chunks, key=lambda c: len(c["text"]), reverse=True)[:2]
    chunks_text = "\n\n".join(
        f"[Фрагмент {i + 1}]\n{c['text'][:600]}" for i, c in enumerate(sampled)
    )

    # Build regulation summary (top 5 по hits) — больше LLM всё равно не цитирует.
    regs_text = "\n".join(
        f"- {r['name']} ({r['domain']}, совпадений: {r['hits']})"
        for r in regulations[:5]
    )

    domain_summary = "\n".join(
        f"- {d['domain']}: {d['regulation_count']} регл., {d['total_hits']} совпадений"
        for d in domain_spectrum
    )

    # Краткий system prompt — qwen2.5:7b на M2 Air платит ~50 tok/s за
    # prompt-eval. 1000 токенов сист.промпта = 20 сек ожидания до первого
    # output-токена. Чем короче — тем быстрее старт генерации.
    system_prompt = (
        "Ты — аналитик нормативной базы. По данным retrieval'а напиши связный "
        "абзац 3-5 предложений: какие темы документа пересекаются с корпусом, "
        "2-3 наиболее релевантных регламента по имени, есть ли явные пробелы. "
        "Без списков и markdown."
    )

    user_prompt = f"""Документ: "{filename}"

Фрагменты:
{chunks_text}

Связанные регламенты:
{regs_text}

Распределение по доменам:
{domain_summary}"""

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            base_url=settings.openai_base_url or None,
            api_key=settings.openai_api_key or "ollama",
            timeout=180.0,
        )
        resp = await client.chat.completions.create(
            model=settings.ragu_llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            # 220 tokens ≈ 4-5 предложений. На 6 tok/s (qwen2.5:7b/M2 Air)
            # ~35 сек генерации, плюс ~20 сек prompt-eval. Раньше было 500
            # → почти минута генерации, что и вызывало «бесконечную» загрузку.
            max_tokens=220,
            temperature=0.2,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text or _build_summary_fallback(filename, regulations, domain_spectrum)
    except Exception as e:
        return (
            f"⚠️ LLM недоступна ({type(e).__name__}). Структурированный отчёт:\n\n"
            + _build_summary_fallback(filename, regulations, domain_spectrum)
        )


def _build_summary_fallback(
    filename: str,
    regulations: list[dict[str, Any]],
    domain_spectrum: list[dict[str, Any]],
) -> str:
    """Структурированный summary без LLM (для mock-режима / fallback)."""
    if not regulations:
        return (
            f"Документ «{filename}» не содержит фрагментов, пересекающихся с регламентами "
            f"в корпусе. Возможно тема документа выходит за рамки оцифрованной нормативной базы."
        )
    parts = [
        f"Документ «{filename}» содержит фрагменты, пересекающиеся с {len(regulations)} "
        f"регламентами по {len(domain_spectrum)} доменам."
    ]
    if domain_spectrum:
        top_domain = domain_spectrum[0]
        parts.append(
            f"Основной домен пересечения — {top_domain['domain']} "
            f"({top_domain['regulation_count']} регламентов, "
            f"{top_domain['total_hits']} совпадений)."
        )
    if len(regulations) >= 1:
        top_reg = regulations[0]
        parts.append(
            f"Наиболее релевантный регламент: «{top_reg['name']}» "
            f"(совпало с {top_reg['hits']} фрагментами документа)."
        )
    return " ".join(parts)
