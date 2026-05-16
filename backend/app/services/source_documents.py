"""Хранилище документов-оснований для цифровых регламентов.

Сценарий аналитика: оцифровал бумажный приказ → хочет иметь PDF под рукой
для самопроверки «откуда взялись 20.5 атм». Вариант B (см. README §Документ-
основание): URL + цитата + локальный кэш файла + SHA-256.

Файлы хранятся в `<DATA_DIR>/source_documents/<source_id>/<filename>`.
Папка-в-папке чтобы было видно «1 регламент = 1 директория»; чистка при
удалении регламента — `rm -rf` всей папки.

Хеш SHA-256 нужен для:
  1. Поймать подмену оригинала (analyst заменил PDF — хеш изменился, видно в diff'е).
  2. Сверки при re-import bundle'а: если в новой версии bundle прислан тот же
     файл — хеш совпал, можно не перезагружать.
"""
from __future__ import annotations

import hashlib
import mimetypes
import shutil
from pathlib import Path

from app.config import settings

# Лимит на размер загружаемого источника. PDF-приказы обычно 1-5 МБ,
# скан-копии до 20 МБ. Ставим 25 МБ как страховку от случайной загрузки
# образа диска или видеозаписи совещания. Выше — пусть кладут в внешний DMS,
# а в RAGRAF только URL + цитата.
MAX_BYTES = 25 * 1024 * 1024


def _root() -> Path:
    """Корневая папка `<DATA_DIR>/source_documents/`. Создаётся on-demand."""
    p = Path(settings.data_dir) / "source_documents"
    p.mkdir(parents=True, exist_ok=True)
    return p


def regulation_dir(source_id: str) -> Path:
    """Папка одного регламента; создаётся если не было."""
    p = _root() / source_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_upload(source_id: str, filename: str, content: bytes) -> dict:
    """Сохранить загруженный файл и вернуть metadata для записи в Regulation.

    Если у регламента уже был кэш — удаляем (один регламент = один источник).
    Это упрощает UI и хранение; если нужны множественные приложения, выносим
    их в отдельную таблицу (пока сценария нет).

    Returns: `{path, checksum, mime_type, size}` — поля для записи в DuckDB:
      - `path` — относительный путь от `<DATA_DIR>` (чтобы не хранить абсолютные
        пути в БД и переезд `data/` не ломал ссылки).
      - `checksum` — `sha256:<hex>` (префикс — для удобства миграции на другие
        алгоритмы хеширования в будущем).
      - `mime_type` — определяется по расширению (browser сам пришлёт точный
        тип, но мы оставляем fallback).
    """
    if len(content) > MAX_BYTES:
        raise ValueError(
            f"Файл слишком большой ({len(content)} байт > {MAX_BYTES}). "
            "Положите его во внешний DMS / Яндекс Диск и сохраните только URL."
        )

    # Защита от path traversal: режем имя до basename и убираем опасные символы.
    # Файл может прийти как "../../etc/passwd" из недоверенного клиента.
    safe_name = Path(filename).name.replace("\x00", "")
    if not safe_name:
        safe_name = "source.bin"

    # Чистим папку — переписываем источник целиком. Старый файл уходит, новый
    # становится единственным attachment'ом регламента.
    d = regulation_dir(source_id)
    for existing in d.iterdir():
        if existing.is_file():
            existing.unlink()

    target = d / safe_name
    target.write_bytes(content)

    digest = hashlib.sha256(content).hexdigest()
    mime, _ = mimetypes.guess_type(safe_name)

    # Относительный путь — от DATA_DIR. Так в БД не лежат абсолютные пути,
    # перенос RAGRAF между машинами не ломает ссылки.
    rel = target.relative_to(Path(settings.data_dir)).as_posix()
    return {
        "path": rel,
        "checksum": f"sha256:{digest}",
        "mime_type": mime or "application/octet-stream",
        "size": len(content),
        "filename": safe_name,
    }


def resolve_path(rel_path: str) -> Path | None:
    """Развернуть относительный путь из БД в абсолютный, с проверкой что он
    не вылез за DATA_DIR (защита от подсунутого `../../...` в БД).

    Возвращает None если файл не существует или путь вне DATA_DIR.
    """
    if not rel_path:
        return None
    root = Path(settings.data_dir).resolve()
    full = (root / rel_path).resolve()
    try:
        full.relative_to(root)
    except ValueError:
        return None
    return full if full.is_file() else None


def delete_for_regulation(source_id: str) -> bool:
    """Удалить всю папку источников регламента. Возвращает True если что-то было."""
    d = _root() / source_id
    if not d.exists():
        return False
    shutil.rmtree(d, ignore_errors=True)
    return True


def verify_checksum(rel_path: str, expected: str | None) -> bool:
    """Сверить хеш локального файла с записанным в БД.

    Используется UI-кнопкой «Сверить с оригиналом» — если кто-то заменил PDF
    в `data/source_documents/` снаружи, аналитик увидит расхождение.
    """
    if not expected:
        return False
    path = resolve_path(rel_path)
    if path is None:
        return False
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    expected_hex = expected.removeprefix("sha256:")
    return actual == expected_hex
