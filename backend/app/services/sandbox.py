"""Sandbox-сервисы — демо RAGU-подобных возможностей без обязательной
зависимости от LLM-ключей.

Сейчас реализованы два сценария:
  1. `semantic_search` — поиск по регламентам на естественном языке.
     Mock-режим: TF-IDF-подобный keyword scoring по названию + рекомендации
     + именам параметров. Без LLM, работает out-of-the-box.
     RAGU-режим (когда `settings.ragu_enabled=True` и установлен graph_ragu):
     перевести вызов на `LocalSearchEngine`/`MixSearchEngine` — см.
     [`external/RAGU/examples/`](external/RAGU/examples/) как референс.

  2. `extract_parameters` — извлечение числовых параметров из произвольного
     текста регламента. Mock-режим: regex по числам с единицами + словарь
     контекстных слов (русск.) → camelCase имена. Хорошо работает на
     текстах со стандартными формулировками ("давление 20.5 атм").
     RAGU-режим: `ArtifactsExtractorLLM` / `TwoStageArtifactsExtractorLLM`.

Sandbox изолирован: нет правок DuckDB, нет затрагивания основных эндпоинтов.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from app.config import settings
from app.schemas.domain import Regulation
from app.services import regulation_store


# ── Semantic search ────────────────────────────────────────────────────


def _tokenize(text: str) -> list[str]:
    """Простая токенизация русского + латиницы. Lower-case, удаляем спецсимволы."""
    return [t for t in re.split(r"[^\w]+", (text or "").lower()) if len(t) >= 3]


def _stem(token: str) -> str:
    """Минималистичный стемминг русского: берём корень-префикс ~5 символов
    (отсекаем окончания вроде -ия / -ение / -ий / -ам / -ов и т.п.).
    Не lemmatizer-grade, но решает 90% русско-морфологических ложных промахов
    в keyword-поиске («давление» ↔ «давления», «трубопровод» ↔ «трубопроводов»).
    """
    if len(token) <= 5:
        return token
    return token[:5]


def _stem_set(tokens: set[str]) -> set[str]:
    return {_stem(t) for t in tokens}


def _score_regulation(query_tokens: set[str], reg: Regulation) -> tuple[float, list[str]]:
    """Возвращает (score, matched_terms) для регламента.

    Веса (эмпирически разумные):
      - имя домена и регламента — самые важные (×3)
      - имена параметров — важные (×2)
      - текст рекомендации — обзорный (×1)
    """
    matched: set[str] = set()
    score = 0.0
    # Сравниваем по стемам — иначе «давление» (query) не матчит «давления» (text).
    q_stems = _stem_set(query_tokens)

    def _check(text: str, weight: float) -> None:
        nonlocal score
        if not text:
            return
        text_tokens = set(_tokenize(text))
        text_stems_map: dict[str, str] = {_stem(t): t for t in text_tokens}
        common = q_stems & set(text_stems_map.keys())
        if common:
            score += weight * len(common)
            matched.update(text_stems_map[s] for s in common)

    _check(reg.name, weight=3.0)
    if reg.domain:
        _check(reg.domain, weight=2.0)
    for p in reg.parameters:
        _check(p.name, weight=2.0)
        if p.unit:
            _check(p.unit, weight=2.0)
    for r in reg.recommendations:
        _check(r.text, weight=1.0)

    return score, sorted(matched)


def _build_snippet(reg: Regulation, matched_terms: set[str], max_len: int = 220) -> str:
    """Возвращает короткий фрагмент рекомендации, в котором встречается ≥1 matched term."""
    if not reg.recommendations:
        return ""
    full_text = reg.recommendations[0].text
    if not matched_terms:
        return full_text[:max_len] + ("…" if len(full_text) > max_len else "")
    # Найдём первое предложение, где встречается любой matched-term
    sentences = re.split(r"(?<=[.!?])\s+", full_text)
    for s in sentences:
        s_lower = s.lower()
        if any(t in s_lower for t in matched_terms):
            return s.strip()[:max_len] + ("…" if len(s) > max_len else "")
    return full_text[:max_len] + ("…" if len(full_text) > max_len else "")


def semantic_search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Поиск регламентов по естественному языку.

    Mock-режим (по умолчанию). Когда `settings.ragu_enabled=True` —
    в будущем заменить на `LocalSearchEngine.search(query)` с обогащением.
    """
    if not (query or "").strip():
        return []
    qt = set(_tokenize(query))
    if not qt:
        return []

    results: list[dict[str, Any]] = []
    for item in regulation_store.list_all():
        reg = regulation_store.get(item["id"])
        if reg is None:
            continue
        score, matched = _score_regulation(qt, reg)
        if score <= 0:
            continue
        results.append(
            {
                "regulation_id": reg.id,
                "regulation_name": reg.name,
                "domain": reg.domain,
                "score": round(score, 2),
                "matched_terms": matched,
                "snippet": _build_snippet(reg, set(matched)),
                "parameters_count": len(reg.parameters),
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]


# ── Parameter extraction ──────────────────────────────────────────────


# Словарь контекстных слов (русск.) → camelCase parameter name.
# Используется чтобы для матча "давление 20.5 атм" вытащить name=pressure.
#
# Порядок не важен — `_guess_name` берёт стем с максимальным `rfind` (ближе к
# числу). Стемы могут быть многословные ("пик нагрузк") и пересекаться по
# подстрокам — это нормально, выигрывает ближайший к числу.
CONTEXT_NAMES: dict[str, str] = {
    # — Физические параметры
    "температур": "temperature",
    "давлен": "pressure",
    "диаметр": "diameter",
    "расход": "flowRate",
    "поток": "flowRate",
    "влажност": "humidity",
    "вентиляц": "ventilation",
    "ветер": "windSpeed",
    "скорости ветра": "windSpeed",
    "pm2.5": "pm25Concentration",
    "pm25": "pm25Concentration",
    "пдк": "pdkExceedanceHours",
    "задымлен": "smokeConcentration",
    "дым": "smokeConcentration",
    "концентрац": "smokeConcentration",
    "снег": "snowDepth",
    "сосульк": "iceLength",
    "влага": "waterLeakLevel",
    "проте": "waterLeakLevel",
    "время": "responseTime",
    "реакц": "responseTime",
    "приоритет": "priority",
    # — Оповещения / уведомления (Sigma 4.2.1)
    "уведомлен": "notificationLeadTime",
    "оповещен": "alertLeadTime",
    "оповещ": "alertLeadTime",
    "смс": "smsLeadTime",
    "sms": "smsLeadTime",
    "упрежда": "advanceLeadTime",
    "до прогноз": "forecastLeadTime",
    "до пика": "peakLoadLeadTime",
    "пик нагрузк": "peakLoadLeadTime",
    # — Регламенты режима / ремонт
    "очист": "cleaningInterval",
    "уборк": "cleaningInterval",
    "опорожн": "drainInterval",
    "штабел": "stockpileTemperature",
    "повтор": "repeatCount",
    "не менее одного раза": "minRepeatCount",
}

# Известные единицы — порядок имеет значение (длинные первыми).
KNOWN_UNITS = [
    "°C/ч", "°C",
    "атм/мин", "атм",
    "м³/ч", "м/с",
    "мкг/м³",
    "ч/сутки",
    "мин",
    "ппм", "ppm",
    "см", "мм",
    "%",
    "ч",
]
_UNIT_RE = "|".join(re.escape(u) for u in KNOWN_UNITS)

# `(число) [± (отклонение)] (единица)`
# Примеры: "20.5 атм", "20.5 ± 1.5 атм", "5 см", "−2 °C"
_PARAM_PATTERN = re.compile(
    r"([+−\-]?\s*\d+(?:[.,]\d+)?)\s*(?:±\s*([+−\-]?\s*\d+(?:[.,]\d+)?))?\s*(" + _UNIT_RE + r")",
    re.IGNORECASE,
)


def _to_float(s: str | None) -> float | None:
    if s is None:
        return None
    s = s.replace(",", ".").replace(" ", "").replace("−", "-")
    try:
        return float(s)
    except ValueError:
        return None


def _left_context(text: str, start: int, width: int = 80) -> str:
    """Левая окрестность матча. Имя параметра в русском всегда ПЕРЕД числом
    («давление 20.5 атм», «температура 70°C») — symmetric window даёт ложный
    матч с соседним параметром. Берём только лево, отрезаем по границам
    предложений и перечислений.

    Точка не считается разделителем сама по себе (иначе ловим "PM2.5" как
    конец предложения) — только `. ` (точка+пробел) или `.\n`.
    """
    lo = max(0, start - width)
    chunk = text[lo:start]
    # запятая / точка с запятой / перенос строки — однозначные разделители
    for sep in (",", ";", "\n"):
        idx = chunk.rfind(sep)
        if idx != -1:
            chunk = chunk[idx + 1 :]
    # точка-разделитель = точка + (пробел или newline). Иначе это десятичная.
    for sep in (". ", ".\t"):
        idx = chunk.rfind(sep)
        if idx != -1:
            chunk = chunk[idx + len(sep) :]
    return chunk


def _guess_name(window: str) -> str | None:
    """Ищем контекстное слово в окрестности матча.

    Выбираем стем с самым ПОЗДНИМ вхождением — оно ближе всего к числу
    (наиболее релевантное). Это важно для случаев «...температура 70°C,
    давление 4 атм» где надо привязать «4» к «давление», а не к «температура».
    """
    w = window.lower()
    best: tuple[int, str] | None = None
    for stem, name in CONTEXT_NAMES.items():
        idx = w.rfind(stem)
        if idx != -1 and (best is None or idx > best[0]):
            best = (idx, name)
    return best[1] if best else None


def _guess_name_with_fallback(text: str, match_start: int, match_end: int) -> str | None:
    """Многоуровневый поиск имени параметра.

    Раньше использовали только окно 80 символов слева — это не работает на
    текстах где ключевое слово стоит в начале абзаца, а само число — в конце
    длинного предложения. Пример из реального регламента:
      "SMS-уведомления уязвимым группам потребителей, а также ответственным
       лицам объектов социальной инфраструктуры отправляются за 6 ± 2 часа..."
    Слово «уведомления» — за пределами 80-char окна, поэтому extract возвращал
    `param_1` вместо `notificationLeadTime`.

    Стратегия (от ближнего к дальнему контексту):
      1. Окно 80 символов слева — самый сильный сигнал (proximity).
      2. Если не нашли — целое предложение, в котором лежит число.
      3. Если всё ещё нет — предыдущее предложение (часто заголовок абзаца).
    Возвращаем None если ничего не подошло (вызывающая сторона ставит
    русско-язычный плейсхолдер).
    """
    # 1. Узкое окно слева — приоритет proximity
    near = _left_context(text, match_start, width=80)
    name = _guess_name(near)
    if name:
        return name

    # 2. Целое предложение вокруг матча
    sentence = _enclosing_sentence(text, match_start, match_end)
    name = _guess_name(sentence)
    if name:
        return name

    # 3. Предыдущее предложение (для конструкций «Заголовок: ... 6 ± 2 ч ...»)
    prev_chunk = text[max(0, match_start - 400) : match_start]
    last_sent_break = max(
        prev_chunk.rfind(". "),
        prev_chunk.rfind(".\n"),
        prev_chunk.rfind(": "),
        prev_chunk.rfind(":\n"),
    )
    if last_sent_break != -1:
        prev_chunk = prev_chunk[: last_sent_break + 1]
    return _guess_name(prev_chunk)


def _enclosing_sentence(text: str, start: int, end: int) -> str:
    """Возвращает целое предложение, в котором лежит match."""
    sent_start = max(text.rfind(".", 0, start), text.rfind(";", 0, start), text.rfind("\n", 0, start))
    sent_end_candidates = [text.find(".", end), text.find(";", end), text.find("\n", end)]
    sent_end = min((c for c in sent_end_candidates if c != -1), default=len(text))
    return text[sent_start + 1 : sent_end + 1].strip()


def extract_parameters(text: str) -> list[dict[str, Any]]:
    """Найти все «число (± deviation) единица» паттерны и предложить имена.

    Returns:
      [
        {
          "id": "...",  # клиент использует как React key
          "suggested_name": "pressure",
          "value": 20.5,
          "deviation": 1.5,
          "unit": "атм",
          "source_text": "...",       # предложение целиком
          "confidence": 0.85,         # 0..1, выше = больше уверенность в имени
        },
        ...
      ]
    """
    if not (text or "").strip():
        return []

    found: list[dict[str, Any]] = []
    for m in _PARAM_PATTERN.finditer(text):
        raw_value, raw_dev, unit = m.group(1), m.group(2), m.group(3)
        value = _to_float(raw_value)
        deviation = _to_float(raw_dev)
        if value is None:
            continue

        # Многоуровневый поиск имени: окно 80 → предложение → предыдущее
        # предложение. Подробнее см. `_guess_name_with_fallback`.
        suggested = _guess_name_with_fallback(text, m.start(), m.end())
        confidence = 0.85 if suggested else 0.4
        # Слегка повышаем confidence если есть симметричное deviation —
        # это сильно похоже на наш формат "ref ± dev unit".
        if deviation is not None:
            confidence = min(1.0, confidence + 0.1)

        sentence = _enclosing_sentence(text, m.start(), m.end())

        # Если имя не угадали — даём осмысленный русский плейсхолдер
        # (не "param_N" — не путаем аналитика английским литералом, плюс
        # явно сигналим «надо переименовать вручную»).
        if not suggested:
            suggested = f"параметр_{len(found) + 1}"

        found.append(
            {
                "id": f"ext_{uuid.uuid4().hex[:8]}",
                "suggested_name": suggested,
                "value": value,
                "deviation": deviation,
                "unit": unit,
                "source_text": sentence or text[max(0, m.start() - 30) : m.end() + 30].strip(),
                "confidence": round(confidence, 2),
                # auto-derived bounds (для удобного импорта в редактор)
                "min_inclusive": 0.0 if value >= 0 else None,
            }
        )
    return found


# ── RAGU-aware switching ──────────────────────────────────────────────


def is_real_ragu_available() -> bool:
    """Доступна ли реальная RAGU-имплементация (флаг + установлен graph_ragu)."""
    if not settings.ragu_enabled:
        return False
    try:
        import ragu  # noqa: F401
        return True
    except ImportError:
        return False


def backend_mode() -> str:
    """`real` / `mock` — для UI индикатора."""
    return "real" if is_real_ragu_available() else "mock"


# ── Conversational Q&A над регламентами ──────────────────────────────


def _build_regulation_context(hits: list[dict[str, Any]], max_regs: int = 4) -> str:
    """Собрать компактный контекст из top-N регламентов для LLM-prompt'а.

    Каждый регламент даёт: имя, ID, домен, параметры (name=ref±dev unit) и текст
    рекомендации. Этого хватает чтобы phi3-class модель сгенерировала осмысленный
    ответ с цитатами, не уходя в галлюцинации.
    """
    parts: list[str] = []
    for h in hits[:max_regs]:
        reg = regulation_store.get(h["regulation_id"])
        if reg is None:
            continue
        params_str = ", ".join(
            f"{p.name}={p.referenceValue}±{p.deviationAllowed or 0}{(' ' + p.unit) if p.unit else ''}"
            for p in reg.parameters
        ) if reg.parameters else "(параметры не заданы)"
        rec_text = reg.recommendations[0].text if reg.recommendations else "(рекомендация не задана)"
        parts.append(
            f"### {reg.name}\n"
            f"ID: {reg.id} · Домен: {reg.domain or '—'}\n"
            f"Параметры: {params_str}\n"
            f"Рекомендация: {rec_text}"
        )
    return "\n\n".join(parts)


def _mock_chat_answer(question: str, hits: list[dict[str, Any]]) -> str:
    """Fallback-ответ без LLM — просто компонуем найденные регламенты."""
    if not hits:
        return (
            f"По запросу «{question}» подходящих регламентов не нашлось. "
            "Попробуй переформулировать или уточнить домен (теплоснабжение / ЖКХ / безопасность / экология)."
        )
    lines = [f"По запросу «{question}» нашлось {len(hits)} релевантных регламентов:\n"]
    for h in hits[:4]:
        lines.append(f"• **{h['regulation_name']}** (`{h['regulation_id']}`)")
        if h.get("snippet"):
            lines.append(f"  {h['snippet']}")
    lines.append(
        "\n_Это mock-режим: совпадение по ключевым словам. Включи RAGU_ENABLED=true "
        "+ локальную Ollama для генеративного ответа._"
    )
    return "\n".join(lines)


async def chat(
    messages: list[dict[str, str]],
    top_k: int = 4,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Conversational Q&A: retrieval (mock TF-IDF) → LLM-grounded answer (Ollama).

    Логика:
      1. Берём последнее user-сообщение как retrieval query.
      2. semantic_search ищет top-N релевантных регламентов.
      3. Если RAGU включён И Ollama достижима → инжектируем регламенты в
         system-prompt и зовём LLM с полной историей (поддерживает follow-up'ы).
      4. Иначе — текстовый fallback со списком найденного (mock-режим).
    """
    if not messages:
        return {"answer": "Нет сообщений в истории.", "sources": [], "mode": backend_mode()}

    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    if not last_user or not (last_user.get("content") or "").strip():
        return {"answer": "Пустой запрос. Задай вопрос про регламенты.", "sources": [], "mode": backend_mode()}

    query = last_user["content"].strip()

    if not is_real_ragu_available():
        # Mock-режим — используем TF-IDF, embeddings требуют Ollama.
        hits = semantic_search(query, top_k=top_k)
        return {"answer": _mock_chat_answer(query, hits), "sources": hits, "mode": "mock"}

    # Real-режим: семантический retrieval через bge-m3 embeddings. Это
    # принципиально лучше TF-IDF на русских формулировках с синонимами
    # («наводнение» ↔ «протечка» ↔ «вода»), и не ловит общие предлоги
    # вроде «при» / «и» / «в» которые TF-IDF матчит на каждом регламенте.
    try:
        from app.services.embedding_index import semantic_search_embeddings
        hits = await semantic_search_embeddings(query, top_k=top_k)
    except Exception:
        # Если embeddings отвалились (Ollama офлайн) — fallback на TF-IDF.
        hits = semantic_search(query, top_k=top_k)

    context = _build_regulation_context(hits) if hits else "(подходящих регламентов в базе не найдено)"

    # NotebookLM-style: если аналитик включил в контекст загруженные документы
    # (PDF/DOCX), достаём релевантные chunks через bge-m3 и добавляем рядом с
    # регламентами. Каждый chunk идёт с filename — LLM может цитировать
    # «по такому-то файлу: ...».
    doc_chunks: list[dict[str, Any]] = []
    try:
        from app.services import document_store
        if document_store.count_enabled() > 0:
            doc_chunks = await document_store.retrieve_relevant_chunks(query, top_k=4)
    except Exception:
        doc_chunks = []

    doc_context_block = ""
    if doc_chunks:
        doc_blocks = [
            f"[{i + 1}] Файл: {c['filename']} (score={c['score']})\n{c['text']}"
            for i, c in enumerate(doc_chunks)
        ]
        doc_context_block = (
            "\n\n=== ДОКУМЕНТЫ АНАЛИТИКА (включены в контекст) ===\n"
            + "\n\n".join(doc_blocks)
            + "\n=== КОНЕЦ ДОКУМЕНТОВ ===\n"
        )

    # Detect: list-запрос («какие/перечисли/список регламентов по X»)
    # отличается от specific-запроса («какое давление в зимнюю норму»).
    # LLM-ответ должен быть структурно другим: список vs цитата с числами.
    query_lower = query.lower()
    is_list_query = any(
        marker in query_lower
        for marker in (
            "какие есть", "какие регламент", "перечисли", "список регламент",
            "что есть про", "что в базе", "что у тебя", "какие у тебя",
        )
    )

    # Карта доменов — помогает LLM распознать что «трубопровод», «тепловой ввод»,
    # «отопление» — это всё heating-домен, а не разные несвязанные темы.
    domain_hints = """
ДОМЕНЫ В БАЗЕ (для понимания контекста запроса):
  - heating (теплоснабжение): отопление, тепловые сети, трубопроводы водо- и
    теплоснабжения, тепловые узлы, давление, температура подачи, обходчик.
  - housing (ЖКХ): кровли, сосульки, снег на крышах, ТСЖ, протечки в жилых
    помещениях, общежития, отсекатели стояков.
  - safety (безопасность): пожар, задымление, перегрев оборудования,
    серверные, ЕДДС, эскалация 01/101/112.
  - environment (экология): качество воздуха, PM2.5, шум, безветрие,
    оповещение уязвимых групп, НМУ.
"""

    list_rules = """
ВОПРОС ПОЛЬЗОВАТЕЛЯ — list-запрос («какие регламенты есть про X»).
ТВОЯ ЗАДАЧА: вывести КОРОТКИЙ СПИСОК подходящих регламентов из базы. БЕЗ комментариев типа «однако это не относится к X» — просто перечисли что нашлось из релевантного домена.

ФОРМАТ (строго, без вступлений):
• <имя регламента> (`id`) — <1 строка о чём, с ключевыми параметрами>
• <имя регламента> (`id`) — <1 строка о чём, с ключевыми параметрами>

Если регламент НЕ относится к спрашиваемому домену — НЕ упоминай его вообще, не пиши «это не подходит». Молча отфильтруй.
В конце добавь одну строку: «Всего в базе по теме «<тема>»: N регламентов.»
"""

    specific_rules = """
ВОПРОС ПОЛЬЗОВАТЕЛЯ — specific-запрос (требует конкретного числа / порога / действия).
ТВОЯ ЗАДАЧА: дать прямой ответ с числами из «Параметры:».

ПРАВИЛА:
1. Если есть ПРЯМОЙ ответ — назови параметр, значение, единицу, регламент-источник.
2. Если прямого нет, но есть БЛИЗКОЕ — пометь: «Точного регламента нет, но близкое: <цитата с числами>».
3. Если совсем нет — кратко скажи и перечисли 2-3 имеющиеся темы.
4. Не выдумывай числа. Только то, что явно в «Параметры:» (формат `name=ref±dev unit`).
5. 1-3 коротких пункта + строка «Источник: <имя регламента> (id)».
"""

    # Усиленный промпт: явный антигаллюцинационный режим, структура, чёткий
    # анти-template отказ. Адаптируется под тип запроса.
    system_prompt = f"""Ты — ассистент по техническим регламентам ВУЗа, ТЭЦ и городской инфраструктуры. Цель — БЫТЬ ПОЛЕЗНЫМ, цитируя реальные данные из базы, но не выдумывая.

ОБЩИЕ ПРАВИЛА:
- Используй ТОЛЬКО предоставленные регламенты и документы аналитика. Не подмешивай данные из тренировки модели.
- Каждый новый вопрос разбирай заново — не копируй ответ предыдущего.
{domain_hints}
{list_rules if is_list_query else specific_rules}
=== ДОСТУПНЫЕ РЕГЛАМЕНТЫ (top-{top_k} по семантической близости) ===
{context}
=== КОНЕЦ КОНТЕКСТА ==={doc_context_block}"""

    llm_messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        llm_messages.append({"role": role, "content": content})

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url=settings.openai_base_url or None,
            api_key=settings.openai_api_key or "ollama",
            timeout=60.0,
        )
        # Дефолты подобраны под технические Q&A: temp=0.1 минимизирует галлюцинации,
        # 600 токенов хватает на структурированный ответ из 3-5 пунктов.
        # Клиент может переопределить через UI-слайдеры — клампы уже валидированы
        # в API-схеме (sandbox.py ChatRequest).
        resp = await client.chat.completions.create(
            model=settings.ragu_llm_model,
            messages=llm_messages,
            max_tokens=max_tokens if max_tokens is not None else 600,
            temperature=temperature if temperature is not None else 0.1,
        )
        answer = (resp.choices[0].message.content or "").strip()
        if not answer:
            answer = "(LLM вернула пустой ответ — попробуй переформулировать)"
        return {
            "answer": answer,
            "sources": hits,
            "document_sources": [
                {"doc_id": c["doc_id"], "filename": c["filename"], "score": c["score"]}
                for c in doc_chunks
            ],
            "mode": "real",
        }
    except Exception as e:
        # Fallback на mock при любом сбое LLM-вызова (Ollama офлайн, модель не загружена и т.п.)
        fallback = _mock_chat_answer(query, hits)
        return {
            "answer": f"_⚠️ LLM недоступна ({type(e).__name__}: {str(e)[:120]}), показываю mock-ответ._\n\n{fallback}",
            "sources": hits,
            "mode": "mock",
        }
