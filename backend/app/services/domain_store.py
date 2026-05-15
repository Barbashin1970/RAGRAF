"""Слой над DuckDB для пользовательских доменов.

Зачем отдельный store: `fixtures.DOMAINS` — seed-карта 4 базовых доменов, она
жёстко зашита в код и используется как fallback / seed для регламентов. Но
аналитику нужно создавать новые домены из UI — в т.ч. в bootstrap-сценарии
«загрузили документ для новой темы, корпуса нет, создаём домен прямо отсюда».

API: `list_all()` объединяет seed + пользовательские, `create()` добавляет,
`exists()` проверяет — потребляется валидацией `regulations.py` и
`sandbox.py` (вместо прежнего `fixtures.list_domains()`).
"""
from __future__ import annotations

import re
from typing import Any

from app.services import fixtures, regulation_store


def _normalize_id(raw: str) -> str:
    """Слаг для id домена: lower-kebab, ASCII-only, max 40 символов."""
    s = raw.strip().lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:40]


def list_all() -> list[dict[str, str]]:
    """Объединённый список: seed-домены (фикстуры) + созданные аналитиком.

    Сначала идут seed-домены в порядке их объявления (heating → housing → …),
    затем пользовательские в порядке создания. Дубликатов по id не бывает —
    `create()` отвергает столкновения.
    """
    seed = fixtures.list_domains()
    seed_ids = {d["id"] for d in seed}
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            "SELECT id, label, hint FROM user_domains ORDER BY created_at"
        ).fetchall()
    user = [
        {"id": r[0], "label": r[1], "hint": r[2] or ""}
        for r in rows
        if r[0] not in seed_ids
    ]
    return [*seed, *user]


def exists(domain_id: str) -> bool:
    """Есть ли домен (seed или пользовательский)."""
    if any(d["id"] == domain_id for d in fixtures.list_domains()):
        return True
    with regulation_store._LOCK:
        c = regulation_store._connection()
        row = c.execute(
            "SELECT 1 FROM user_domains WHERE id = ?", [domain_id]
        ).fetchone()
    return row is not None


def create(label: str, hint: str = "", suggested_id: str | None = None) -> dict[str, Any]:
    """Создать новый пользовательский домен.

    - `label`: видимое название (РУС, до 80 символов).
    - `hint`: подсказка для UI (карточки доменов и т.п.), опционально.
    - `suggested_id`: если задан — нормализуется и проверяется на уникальность;
      иначе слаг строится из label.

    Возвращает финальную запись `{id, label, hint}`. Бросает `ValueError`
    при пустом label, дубликате id или коллизии с seed-доменом.
    """
    label_clean = label.strip()
    if not label_clean:
        raise ValueError("Название домена не может быть пустым")
    if len(label_clean) > 80:
        raise ValueError("Название домена не должно превышать 80 символов")

    base = _normalize_id(suggested_id or label_clean)
    if not base:
        # Полностью не-латинское имя (всё в Unicode → нечего нормализовывать).
        # Подставим простой transliteration fallback: «domain-N» по порядковому.
        with regulation_store._LOCK:
            c = regulation_store._connection()
            n = c.execute("SELECT COUNT(*) FROM user_domains").fetchone()[0]
        base = f"domain-{int(n) + 1}"

    # Уникальность id: если занят (seed или user) — добавляем суффикс -2, -3, …
    candidate = base
    suffix = 2
    while exists(candidate):
        candidate = f"{base}-{suffix}"
        suffix += 1

    hint_clean = (hint or "").strip()[:200]
    with regulation_store._LOCK:
        c = regulation_store._connection()
        c.execute(
            "INSERT INTO user_domains (id, label, hint) VALUES (?, ?, ?)",
            [candidate, label_clean, hint_clean],
        )

    return {"id": candidate, "label": label_clean, "hint": hint_clean}


def delete(domain_id: str) -> bool:
    """Удалить пользовательский домен. Seed-домены защищены — вернёт False.

    Если на этот домен ссылаются регламенты — они остаются с тем же
    `domain`-значением (orphan); считаем что это редкая операция и аналитик
    сначала перенесёт регламенты вручную. Удаление regulations отдельно.
    """
    if any(d["id"] == domain_id for d in fixtures.list_domains()):
        return False
    with regulation_store._LOCK:
        c = regulation_store._connection()
        before = c.execute(
            "SELECT 1 FROM user_domains WHERE id = ?", [domain_id]
        ).fetchone()
        if before is None:
            return False
        c.execute("DELETE FROM user_domains WHERE id = ?", [domain_id])
    return True
