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


async def analyze_document(doc_id: str) -> dict[str, Any]:
    """Полный анализ: chunks → retrieval → spectrum → summary.

    Возвращает структуру для UI:
      {
        "doc_id": ...,
        "filename": ...,
        "domain_spectrum": [{domain, regulation_count, total_hits}, ...],
        "regulations": [{regulation_id, name, domain, hits, max_score}, ...],
        "summary": "LLM-generated text",
        "stats": {chunks_analyzed, regulations_matched, avg_hits_per_chunk}
      }
    """
    chunks_data = _load_document_chunks(doc_id)
    if not chunks_data:
        raise ValueError(f"Документ {doc_id} не найден или пуст")

    filename = chunks_data["filename"]
    chunks = chunks_data["chunks"]  # list of {chunk_id, text}
    if not chunks:
        return {
            "doc_id": doc_id,
            "filename": filename,
            "domain_spectrum": [],
            "regulations": [],
            "summary": "Документ не содержит фрагментов для анализа.",
            "stats": {"chunks_analyzed": 0, "regulations_matched": 0, "avg_hits_per_chunk": 0.0},
        }

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

    # LLM summary
    summary = await _generate_summary(filename, chunks, regulations, domain_spectrum)

    return {
        "doc_id": doc_id,
        "filename": filename,
        "domain_spectrum": domain_spectrum,
        "regulations": regulations,
        "summary": summary,
        "stats": {
            "chunks_analyzed": len(chunks),
            "regulations_matched": len(regulations),
            "avg_hits_per_chunk": round(
                sum(reg_hits.values()) / max(len(chunks), 1), 2
            ),
        },
    }


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

    # Sample top-3 chunks by length (длинные обычно более информативны)
    sampled = sorted(chunks, key=lambda c: len(c["text"]), reverse=True)[:3]
    chunks_text = "\n\n".join(f"[Фрагмент {i + 1}]\n{c['text']}" for i, c in enumerate(sampled))

    # Build regulation summary (top 8 по hits)
    regs_text = "\n".join(
        f"- {r['name']} (id={r['regulation_id']}, домен={r['domain']}, "
        f"совпадений с {r['hits']} фрагментами, max_score={r['max_score']})"
        for r in regulations[:8]
    )

    domain_summary = "\n".join(
        f"- {d['domain']}: {d['regulation_count']} регл., {d['total_hits']} совпадений"
        for d in domain_spectrum
    )

    system_prompt = f"""Ты — аналитик нормативной базы. Проанализируй загруженный документ и его связи с корпусом цифровых регламентов системы.

ЗАДАЧА: Написать связный summary 4-6 предложений, который объясняет:
1. КАКИЕ ТЕМЫ затронуты в документе (по содержанию фрагментов).
2. КАК ОНИ ПЕРЕСЕКАЮТСЯ с доменами корпуса (теплоснабжение / ЖКХ / безопасность / экология).
3. КАКИЕ КОНКРЕТНЫЕ РЕГЛАМЕНТЫ наиболее релевантны (упомяни 2-3 имени).
4. ЕСТЬ ЛИ ПРОБЕЛЫ — темы документа без соответствующих регламентов (если видно).

ФОРМАТ: связный абзац без списков и markdown. Без вступления «Этот документ…» — сразу по сути."""

    user_prompt = f"""Документ: "{filename}"

=== ПРЕДСТАВИТЕЛЬНЫЕ ФРАГМЕНТЫ ДОКУМЕНТА ===
{chunks_text}

=== СВЯЗАННЫЕ РЕГЛАМЕНТЫ (отсортированы по числу совпадений) ===
{regs_text}

=== РАСПРЕДЕЛЕНИЕ ПО ДОМЕНАМ ===
{domain_summary}

Напиши summary."""

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            base_url=settings.openai_base_url or None,
            api_key=settings.openai_api_key or "ollama",
            timeout=120.0,
        )
        resp = await client.chat.completions.create(
            model=settings.ragu_llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=500,
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
