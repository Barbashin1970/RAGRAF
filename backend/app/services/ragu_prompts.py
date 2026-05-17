"""Сервис для просмотра и переопределения RAGU-промптов.

RAGU 0.0.2 хранит 18 системных Jinja2-шаблонов в `ragu.common.prompts.default_templates`.
Каждый шаблон вытаскивается по имени через `RAGUInstruction` (текст + pydantic
схема ответа + описание). Класс `RaguGenerativeModule` (от которого наследуются
все extractors/search engines) предоставляет `update_prompt(name, instruction)`
— то есть **переопределение возможно в runtime без форка библиотеки**.

Этот модуль:
1. Перечисляет все 18 default-промптов (read-only из RAGU).
2. Извлекает Jinja2-переменные из шаблона (для подсказок в UI).
3. Хранит overrides в DuckDB (`ragu_prompt_overrides`).
4. Применяет overrides к данному engine через `apply_overrides(engine)`.

Lazy-import `ragu` — если пакет не установлен, перечисление прометит пустой
список, а API вернёт 503. Бэкенд не падает.
"""
from __future__ import annotations

import itertools
import re
from datetime import datetime, timezone
from typing import Any

from app.services import regulation_store

# Регексп для извлечения Jinja2-переменных {{ var }} / {% for x in ys %} и т.п.
# Не парсер — эвристика, нам достаточно собрать список «возможных» переменных,
# чтобы показать в UI «эти placeholders доступны».
_JINJA_VAR_RE = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_\.]*)")
_JINJA_FOR_RE = re.compile(r"{%-?\s*for\s+[a-zA-Z_]\w*\s+in\s+([a-zA-Z_][a-zA-Z0-9_\.]*)")


def _extract_variables(template: str) -> list[str]:
    """Вытащить уникальные Jinja2-переменные верхнего уровня из шаблона.

    Возвращает отсортированный список без дубликатов и без вложенных полей
    (`relation.subject_name` → `relation`). Это для UI-подсказки «вот какие
    placeholders доступны в этом промпте» — не для validation'а.
    """
    # Объединяем итераторы var/for-regex через itertools.chain в один
    # set-comprehension (sigma-audit P5: manual_set_build → set comprehension).
    found: set[str] = {
        m.group(1).split(".")[0]
        for m in itertools.chain(
            _JINJA_VAR_RE.finditer(template),
            _JINJA_FOR_RE.finditer(template),
        )
    }
    # Отфильтруем Jinja built-ins и keywords.
    excluded = {"loop", "not", "none", "true", "false", "if", "else", "endif", "endfor", "for"}
    return sorted(v for v in found if v.lower() not in excluded)


def _load_ragu_defaults() -> dict[str, dict[str, Any]] | None:
    """Перечислить все default-промпты RAGU. None если RAGU не установлен."""
    try:
        from ragu.common.prompts.prompt_storage import DEFAULT_PROMPT_TEMPLATES  # type: ignore
    except ImportError:
        return None

    out: dict[str, dict[str, Any]] = {}
    for name, instruction in DEFAULT_PROMPT_TEMPLATES.items():
        # Собираем все messages в один template-текст (с маркером роли).
        # У RAGU чаще всего 1 сообщение (UserMessage), иногда 2 (System + User).
        parts: list[tuple[str, str]] = []
        for msg in instruction.messages:
            role = msg.__class__.__name__.replace("Message", "").lower()  # User/System/AI
            parts.append((role, msg.content))
        # Конкатенируем content'ы — для редактирования удобнее видеть всё сразу.
        # Если ролей >1, оборачиваем разделителями, чтобы пользователь видел границу.
        if len(parts) == 1:
            template_text = parts[0][1]
            primary_role = parts[0][0]
        else:
            template_text = "\n\n---\n\n".join(c for _, c in parts)
            primary_role = parts[0][0]
        pyd = instruction.pydantic_model
        pyd_name = pyd.__name__ if hasattr(pyd, "__name__") else "str"
        out[name] = {
            "name": name,
            "description": instruction.description or "",
            "default_template": template_text,
            "role": primary_role,
            "pydantic_schema": pyd_name,
            "variables": _extract_variables(template_text),
            "message_count": len(parts),
        }
    return out


_DEFAULTS_CACHE: dict[str, dict[str, Any]] | None = None


def _defaults() -> dict[str, dict[str, Any]]:
    """Memoized default-templates. Один импорт RAGU за весь процесс."""
    global _DEFAULTS_CACHE
    if _DEFAULTS_CACHE is None:
        loaded = _load_ragu_defaults()
        _DEFAULTS_CACHE = loaded or {}
    return _DEFAULTS_CACHE


def is_available() -> bool:
    """RAGU установлен и default-промпты доступны?"""
    return bool(_defaults())


# ── Public API ──────────────────────────────────────────────────────────


def list_prompts() -> list[dict[str, Any]]:
    """Полный каталог промптов с признаком «есть ли override».

    Сортировка: алфавитная по name. UI группирует визуально по префиксу
    (artifact_*, global_*, ragu_lm_*, query_*).
    """
    defaults = _defaults()
    overrides = _load_all_overrides()
    items: list[dict[str, Any]] = []
    for name, meta in defaults.items():
        ov = overrides.get(name)
        items.append({
            **meta,
            "has_override": ov is not None,
            "override_updated_at": ov["updated_at"] if ov else None,
            "override_comment": ov["comment"] if ov else None,
        })
    items.sort(key=lambda x: x["name"])
    return items


def get_prompt(name: str) -> dict[str, Any] | None:
    """Полная информация о конкретном промпте: default + override (если есть)."""
    meta = _defaults().get(name)
    if meta is None:
        return None
    ov = _load_override(name)
    return {
        **meta,
        "override_template": ov["template"] if ov else None,
        "override_role": ov["role"] if ov else None,
        "override_comment": ov["comment"] if ov else None,
        "override_updated_at": ov["updated_at"] if ov else None,
    }


def set_override(name: str, template: str, role: str = "user", comment: str | None = None) -> dict[str, Any]:
    """Сохранить override. `name` должен быть в default-каталоге.

    role — 'user' / 'system' / 'ai'. Влияет на то, как сообщение упаковывается
    в ChatMessages для RAGU. Большинство default'ов — UserMessage.
    """
    if name not in _defaults():
        raise ValueError(f"Промпт '{name}' не найден в каталоге RAGU")
    if role not in ("user", "system", "ai"):
        raise ValueError(f"role должен быть user/system/ai, не '{role}'")
    if not template.strip():
        raise ValueError("template не может быть пустым")
    now = datetime.now(timezone.utc)
    with regulation_store._LOCK:
        c = regulation_store._connection()
        c.execute(
            """
            INSERT INTO ragu_prompt_overrides (name, template, role, comment, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (name) DO UPDATE SET
                template = EXCLUDED.template,
                role = EXCLUDED.role,
                comment = EXCLUDED.comment,
                updated_at = EXCLUDED.updated_at
            """,
            [name, template, role, comment, now],
        )
    return _load_override(name) or {}


def delete_override(name: str) -> bool:
    """Удалить override — следующий запрос вернёт RAGU-default."""
    with regulation_store._LOCK:
        c = regulation_store._connection()
        before = c.execute(
            "SELECT 1 FROM ragu_prompt_overrides WHERE name = ?", [name]
        ).fetchone()
        if before is None:
            return False
        c.execute("DELETE FROM ragu_prompt_overrides WHERE name = ?", [name])
    return True


def _load_override(name: str) -> dict[str, Any] | None:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        row = c.execute(
            "SELECT name, template, role, comment, updated_at FROM ragu_prompt_overrides WHERE name = ?",
            [name],
        ).fetchone()
    if row is None:
        return None
    return {
        "name": row[0],
        "template": row[1],
        "role": row[2],
        "comment": row[3],
        "updated_at": row[4].isoformat() if hasattr(row[4], "isoformat") else str(row[4]),
    }


def _load_all_overrides() -> dict[str, dict[str, Any]]:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            "SELECT name, template, role, comment, updated_at FROM ragu_prompt_overrides"
        ).fetchall()
    return {
        r[0]: {
            "name": r[0],
            "template": r[1],
            "role": r[2],
            "comment": r[3],
            "updated_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]),
        }
        for r in rows
    }


def apply_overrides_to(engine: Any) -> list[str]:
    """Применить все актуальные overrides к данному RaguGenerativeModule.

    Engine — экземпляр RAGU класса, унаследованного от `RaguGenerativeModule`
    (любой SearchEngine, extractor, summarizer). Перебираем его `prompts`
    словарь, для каждого имени смотрим override → если есть, заменяем через
    `update_prompt`. Returns список применённых имён — для логирования / UI.

    Ошибки игнорируются (RAGU не установлен / engine не унаследован) — это
    best-effort слой, основная функциональность не должна падать.
    """
    if not hasattr(engine, "prompts") or not hasattr(engine, "update_prompt"):
        return []
    try:
        from ragu.common.prompts.messages import (  # type: ignore
            AIMessage,
            ChatMessages,
            SystemMessage,
            UserMessage,
        )
        from ragu.common.prompts.prompt_storage import RAGUInstruction  # type: ignore
    except ImportError:
        return []

    role_to_msg = {"user": UserMessage, "system": SystemMessage, "ai": AIMessage}
    overrides = _load_all_overrides()
    applied: list[str] = []
    for name in list(engine.prompts.keys()):
        ov = overrides.get(name)
        if ov is None:
            continue
        # Берём pydantic_model и description из default-instructions, чтобы
        # ответный схемный контракт не сбить случайной правкой template.
        default_inst = engine.prompts[name]
        MsgCls = role_to_msg.get(ov["role"], UserMessage)
        new_inst = RAGUInstruction(
            messages=ChatMessages.from_messages([MsgCls(content=ov["template"])]),
            pydantic_model=default_inst.pydantic_model,
            description=default_inst.description,
        )
        engine.update_prompt(name, new_inst)
        applied.append(name)
    return applied


def builder_config_snapshot() -> dict[str, Any]:
    """Read-only снепшот текущей BuilderArguments + Settings + моделей.

    Используется в UI «RAGU Studio» для debug-панели «какие сейчас параметры
    сборки графа». Не trigger'ит инициализацию RAGU (lazy — только дёргаем
    модули, которые уже импортированы).
    """
    from app.config import settings

    info: dict[str, Any] = {
        "ragu_enabled": settings.ragu_enabled,
        "llm_model": settings.ragu_llm_model,
        "embed_model": settings.ragu_embed_model,
        "base_url": settings.openai_base_url or None,
        "storage_folder": settings.ragu_storage_folder,
        "available": is_available(),
    }
    try:
        from ragu import BuilderArguments  # type: ignore
        from ragu.common.global_parameters import Settings as RaguSettings  # type: ignore
    except ImportError:
        info["builder_defaults"] = None
        info["language"] = None
        return info

    # BuilderArguments — dataclass, можно отрефлектить через __dataclass_fields__.
    ba = BuilderArguments()
    info["builder_defaults"] = {
        fname: getattr(ba, fname) for fname in ba.__dataclass_fields__
    }
    info["language"] = RaguSettings.language
    info["prompt_count"] = len(_defaults())
    return info
