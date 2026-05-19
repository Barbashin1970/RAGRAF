"""Счётчик скачиваний installer'ов (Windows / macOS).

Хранится в `$DATA_DIR/download_counters.json` — на Railway это persistent
Volume, переживает редеплои. Локально на dev-машине файл лежит в
`~/RAGRAF/data/download_counters.json`.

Простой JSON `{"macos": N, "windows": M}`, RLock защищает от race-condition
при параллельных запросах. Атомарная запись через tmp + rename.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Literal

from app.config import settings

Platform = Literal["macos", "windows"]

_LOCK = threading.RLock()


def _counters_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "download_counters.json"


def _load() -> dict[str, int]:
    """Прочитать счётчики из файла. На ошибки парсинга — стартуем с нуля
    (файл может быть повреждён или впервые отсутствует)."""
    path = _counters_path()
    if not path.exists():
        return {"macos": 0, "windows": 0}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "macos": int(data.get("macos", 0)),
            "windows": int(data.get("windows", 0)),
        }
    except (json.JSONDecodeError, ValueError, OSError):
        return {"macos": 0, "windows": 0}


def _save(counters: dict[str, int]) -> None:
    """Атомарная запись: пишем во временный файл, потом rename.
    Защищает от обрыва записи на середине (kill -9 / power loss)."""
    path = _counters_path()
    # tempfile в той же папке чтобы rename был атомарным (на одном FS).
    fd, tmp_path = tempfile.mkstemp(prefix=".download_counters.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(counters, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        # Чистка tmp на ошибке; не глотаем — пусть caller увидит.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def get_counts() -> dict[str, int]:
    """Текущие счётчики. Для публичной /stats."""
    with _LOCK:
        return _load()


def bump(platform: Platform) -> int:
    """Увеличить счётчик +1, вернуть новое значение.
    Race-safe через RLock + атомарный replace."""
    with _LOCK:
        counters = _load()
        counters[platform] = counters.get(platform, 0) + 1
        _save(counters)
        return counters[platform]
