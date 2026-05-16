"""SHACL constraints — read/write via upstream `/shapes`, plus import/export Turtle."""
from __future__ import annotations

import io
import zipfile

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from app.schemas.domain import Constraint
from app.services.regulation_client import client
from app.services.turtle_bridge import constraints_to_shacl_turtle, parse_shapes_turtle

router = APIRouter()


def _extract_shapes_from_zip(zip_bytes: bytes) -> str:
    """Из SIGMA-bundle ZIP вытащить shapes.ttl.

    Bundle от RAGRAF имеет структуру `<source_id>/shapes.ttl`. Берём первый
    найденный `shapes.ttl` на любой глубине. Если в ZIP несколько регламентов
    (corpus bundle) — берём первый; для корпусного импорта надо использовать
    `/api/sigma-import/bundle`, не /shacl/import.
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if info.filename.endswith("shapes.ttl") or info.filename == "shapes.ttl":
                return zf.read(info).decode("utf-8", errors="ignore")
    return ""


@router.get("/regulations/{regulation_id}/constraints")
async def get_constraints(regulation_id: str) -> list[Constraint]:
    try:
        turtle = await client.get_shapes(regulation_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    return parse_shapes_turtle(turtle)


@router.put("/regulations/{regulation_id}/constraints")
async def put_constraints(regulation_id: str, constraints: list[Constraint]) -> dict[str, int]:
    turtle = constraints_to_shacl_turtle(constraints)
    try:
        await client.update_shapes(regulation_id, turtle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e
    return {"count": len(constraints)}


@router.get(
    "/regulations/{regulation_id}/shacl/export",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/turtle": {}}}},
)
async def export_shacl(regulation_id: str) -> str:
    try:
        return await client.get_shapes(regulation_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e


@router.post("/regulations/{regulation_id}/shacl/import")
async def import_shacl(regulation_id: str, file: UploadFile = File(...)) -> dict:
    """Импорт SHACL: парсим, мерджим с текущими, возвращаем conflict-репорт.

    Поддерживаемые форматы файла:
      - `.ttl` (Turtle) — напрямую парсится как SHACL shapes.
      - `.zip` (SIGMA-bundle) — внутри ищем `shapes.ttl`. Это позволяет
        аналитику выгрузить bundle через «Экспорт в СИГМУ», поправить shapes
        в самой СИГМЕ или внешнем редакторе и вернуть тот же ZIP обратно
        без распаковки руками. Если хочется импортировать ВСЁ из bundle
        (включая data.ttl) — есть отдельный `/api/sigma-import/bundle`.
    """
    raw = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith(".zip") or raw[:4] == b"PK\x03\x04":
        # ZIP-магия `PK\x03\x04` — fallback если имя файла без расширения.
        body = _extract_shapes_from_zip(raw)
        if not body.strip():
            raise HTTPException(
                status_code=400,
                detail="В ZIP не найден shapes.ttl. Ожидался SIGMA-bundle с папкой <source_id>/shapes.ttl.",
            )
    else:
        body = raw.decode("utf-8", errors="ignore")
    incoming = parse_shapes_turtle(body)

    try:
        current_turtle = await client.get_shapes(regulation_id)
    except Exception:
        current_turtle = ""
    current = parse_shapes_turtle(current_turtle)

    by_id = {c.id: c for c in current}
    conflicts: list[dict] = []
    for c in incoming:
        if c.id in by_id and by_id[c.id] != c:
            conflicts.append({"id": c.id, "existing": by_id[c.id].model_dump(), "incoming": c.model_dump()})
        by_id[c.id] = c  # last-write-wins; conflicts reported

    merged = list(by_id.values())
    turtle = constraints_to_shacl_turtle(merged)
    try:
        await client.update_shapes(regulation_id, turtle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream: {e}") from e

    return {"merged_constraints": len(merged), "conflicts": conflicts}
