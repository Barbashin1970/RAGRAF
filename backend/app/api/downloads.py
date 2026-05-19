"""Download endpoints for local installers (Windows / macOS).

Раздаёт ZIP с installer-скриптами для скачивания с landing-страницы.
Каждое скачивание инкрементит persistent счётчик (на Railway — на Volume).
Назначение — телеметрия популярности платформ для маркетинг-решений и
визуальная социалка на сайте («N людей уже скачали»).

Файлы installer'ов лежат в репо `installer/`:
  - macOS: `start-ragraf.command` + `ragraf-mac.sh`
  - Windows: `start-ragraf.bat` + `ragraf.ps1`

ZIP формируется на лету (in-memory, <10kB) — без кеша, проще чем поддерживать
артефакты сборки. Если кому-то нужно скачать без увеличения счётчика —
есть прямой `GET /installer/<file>` через StaticFiles.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services import download_counter

router = APIRouter()

# Корень репо: `backend/app/api/downloads.py` → 3 parents = repo root.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_INSTALLER_DIR = _REPO_ROOT / "installer"

# Что входит в каждый ZIP. Имена внутри архива — те же что в репо,
# user распакует и кликнет на entry-файл.
_PLATFORM_FILES: dict[str, list[str]] = {
    "macos": ["start-ragraf.command", "ragraf-mac.sh", "INSTALL-MACOS.md"],
    "windows": ["start-ragraf.bat", "ragraf.ps1", "INSTALL-WINDOWS.md"],
}


@router.get("/download/stats")
def download_stats() -> dict[str, int]:
    """Публичные счётчики скачиваний по платформам. Используется в footer
    landing'а для социалки «N человек уже скачали»."""
    return download_counter.get_counts()


@router.get("/download/installer/{platform}")
def download_installer(platform: Literal["macos", "windows"]) -> Response:
    """Отдаёт ZIP с installer-файлами для платформы + инкрементит счётчик.

    Файлы строятся в памяти (~6-10kB ZIP), без записи на диск. Имя файла
    в Content-Disposition включает платформу, чтобы пользователь сразу
    видел что скачал.
    """
    if platform not in _PLATFORM_FILES:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

    files = _PLATFORM_FILES[platform]

    # Собираем ZIP в памяти. Compression=DEFLATED — installer-скрипты текстовые,
    # хорошо сжимаются (10kB → ~3kB).
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in files:
            src = _INSTALLER_DIR / name
            if not src.exists():
                # На Railway image содержит installer/, на dev — тоже. Если
                # нет — лучше явная 500 чем тихо пустой ZIP.
                raise HTTPException(
                    status_code=500,
                    detail=f"Installer file missing: {name}",
                )
            zf.write(src, arcname=name)

    # Bump счётчик только после успешной сборки ZIP — чтобы счётчик не
    # инкрементился на ошибках.
    download_counter.bump(platform)

    suffix = "macos" if platform == "macos" else "windows"
    filename = f"ragraf-installer-{suffix}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
