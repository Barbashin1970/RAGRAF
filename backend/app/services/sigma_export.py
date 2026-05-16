"""Экспорт регламентов в формате, готовом для загрузки в большую СИГМУ.

СИГМА хранит регламенты как Apache Jena граф (RDF/OWL/SHACL). Каждый регламент
= пара файлов: `<id>.data.ttl` (OWL-инстанс) + `<id>.shapes.ttl` (SHACL-форма
валидации). При загрузке СИГМА автоматически проверяет data.ttl против shapes.ttl
— см. Rules-Management.pdf и ТЗ СИГМА §4.1.3.

RAGRAF уже хранит данные в семантически совместимом виде (DuckDB + Turtle
конвертер), поэтому экспорт = сериализация в Turtle через `turtle_bridge` плюс
упаковка в ZIP с manifest.json для трассировки.

Структура bundle одного регламента:
    <source_id>/
        data.ttl       — OWL-инстанс + property declarations
        shapes.ttl     — SHACL-форма валидации под состав параметров
        manifest.json  — RAGRAF-метадата (версия, история, домен)

Batch-экспорт = архив с папкой на каждый регламент.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any

from app.services import regulation_store
from app.services.regulation_client import client
from app.services.turtle_bridge import regulation_to_shacl_shapes, regulation_to_turtle

# Версия формата экспорта. Поднимать когда меняется структура bundle —
# в СИГМЕ при импорте можно будет различать поколения.
EXPORT_FORMAT_VERSION = "1.0"


def _build_manifest(source_id: str, ragraf_version: str = "0.0.2") -> dict[str, Any]:
    """Метадата регламента для трассировки в СИГМЕ + round-trip обратно в RAGRAF.

    Не часть онтологии (в Turtle не поместим, СИГМА не парсит), но даёт
    инженеру СИГМЫ контекст: версию формата, кто экспортировал, сколько
    параметров и история редакций в RAGRAF.
    """
    reg = regulation_store.get(source_id)
    if reg is None:
        raise ValueError(f"Регламент {source_id} не найден")

    try:
        history = regulation_store.history(source_id)
    except Exception:
        history = []

    return {
        "source_id": source_id,
        "name": reg.name,
        "domain": reg.domain,
        "format_version": EXPORT_FORMAT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "exported_by": f"ragraf-{ragraf_version}",
        "parameter_count": len(reg.parameters),
        "constraint_count": len(reg.constraints) if reg.constraints else 0,
        "recommendation_present": bool(reg.recommendations),
        "regulation_history_versions": len(history),
        # SIGMA-compliance: ТЗ §4.1.3 требует период действия и источник.
        # Выносим в manifest даже если поле пустое — чтобы инженер СИГМЫ
        # видел что в RAGRAF его не заполнили (можно вернуть аналитику).
        "sigma_compliance": {
            "source_document": reg.source_document,
            "source_clause": reg.source_clause,
            "valid_from": reg.valid_from,
            "valid_to": reg.valid_to,
        },
        # Не отдаём в СИГМУ flow.json (наш проприетарный Rule DSL). Только
        # помечаем для самопроверки при re-import.
        "ragraf_only_files": ["flow.json (не экспортируется в СИГМУ)"],
    }


async def _resolve_shapes_ttl(source_id: str, reg) -> str:
    """Достать актуальные SHACL для регламента.

    `client.get_shapes()` уже умеет цепочку fallback'ов:
        фикстура → upstream → derived из параметров.
    Поэтому здесь только обёртка с защитой от исключений + последний резервный
    derived (страховка если регламент пришёл не из store).

    Гарантия: возвращаем непустой `RegulationShape` для любого регламента
    у которого есть параметры — bundle всегда валидируется в СИГМЕ.
    """
    try:
        ttl = await client.get_shapes(source_id)
    except Exception:
        ttl = ""
    if ttl and ttl.strip():
        return ttl
    return regulation_to_shacl_shapes(reg)


async def build_regulation_bundle(source_id: str) -> bytes:
    """Собрать ZIP-bundle одного регламента: data.ttl + shapes.ttl + manifest.json.

    Возвращает байты ZIP — отдаются клиенту через FastAPI как `application/zip`.
    """
    reg = regulation_store.get(source_id)
    if reg is None:
        raise ValueError(f"Регламент {source_id} не найден")

    data_ttl = regulation_to_turtle(reg)
    shapes_ttl = await _resolve_shapes_ttl(source_id, reg)
    manifest = _build_manifest(source_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Внутри ZIP — папка с именем source_id. Так несколько bundle'ов
        # можно положить рядом без коллизий имён.
        zf.writestr(f"{source_id}/data.ttl", data_ttl)
        zf.writestr(f"{source_id}/shapes.ttl", shapes_ttl)
        zf.writestr(
            f"{source_id}/manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )
    return buf.getvalue()


async def build_corpus_bundle(domain: str | None = None) -> tuple[bytes, dict[str, Any]]:
    """Batch-экспорт всего корпуса (или одного домена) в один ZIP.

    Каждый регламент — своя папка внутри. На корневом уровне `corpus_manifest.json`
    с общим перечнем что попало в архив.

    Возвращает `(zip_bytes, corpus_manifest)`. Manifest также пишется в JSON-файл
    в архив, но возвращается отдельно для логирования.
    """
    items = regulation_store.list_all()
    if domain:
        items = [it for it in items if it.get("domain") == domain]

    included: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for it in items:
            sid = it["id"]
            try:
                reg = regulation_store.get(sid)
                if reg is None:
                    failed.append({"source_id": sid, "reason": "not_found"})
                    continue
                data_ttl = regulation_to_turtle(reg)
                shapes_ttl = await _resolve_shapes_ttl(sid, reg)
                manifest = _build_manifest(sid)
                zf.writestr(f"{sid}/data.ttl", data_ttl)
                zf.writestr(f"{sid}/shapes.ttl", shapes_ttl)
                zf.writestr(
                    f"{sid}/manifest.json",
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                )
                included.append({
                    "source_id": sid,
                    "name": reg.name,
                    "domain": reg.domain,
                    "parameter_count": len(reg.parameters),
                })
            except Exception as e:
                failed.append({"source_id": sid, "reason": f"{type(e).__name__}: {e}"})

        corpus_manifest = {
            "format_version": EXPORT_FORMAT_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "domain_filter": domain,
            "total_included": len(included),
            "total_failed": len(failed),
            "included": included,
            "failed": failed,
        }
        zf.writestr(
            "corpus_manifest.json",
            json.dumps(corpus_manifest, ensure_ascii=False, indent=2),
        )

    return buf.getvalue(), corpus_manifest


# ── Import (round-trip from SIGMA back into RAGRAF) ──────────────────────


def _parse_bundle_zip(zip_bytes: bytes) -> dict[str, dict[str, Any]]:
    """Распаковать ZIP в {source_id: {data_ttl, shapes_ttl, manifest}}.

    Поддерживает оба формата:
      - Single bundle: `<source_id>/data.ttl`, `<source_id>/shapes.ttl`,
        `<source_id>/manifest.json` (без `corpus_manifest.json`)
      - Corpus bundle: несколько таких папок + `corpus_manifest.json` на корне

    Идентификатор регламента = имя папки внутри ZIP (предсказуемо и читаемо),
    а не из manifest.json — manifest может отсутствовать или быть от другой
    системы. Если папок нет (плоский ZIP с data.ttl на корне) — используем
    fallback `_root_` как ключ; вызывающая сторона решит как именовать.
    """
    bundles: dict[str, dict[str, Any]] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            parts = info.filename.split("/")
            if len(parts) == 1:
                # Корневой файл (corpus_manifest.json или плоский bundle)
                if parts[0] == "corpus_manifest.json":
                    continue  # informational, не нужен для импорта
                folder = "_root_"
                fname = parts[0]
            else:
                folder = parts[0]
                fname = parts[-1]
            if folder == "_root_" and fname not in ("data.ttl", "shapes.ttl", "manifest.json"):
                continue
            entry = bundles.setdefault(folder, {})
            try:
                content = zf.read(info).decode("utf-8", errors="ignore")
            except Exception:
                continue
            if fname == "data.ttl":
                entry["data_ttl"] = content
            elif fname == "shapes.ttl":
                entry["shapes_ttl"] = content
            elif fname == "manifest.json":
                try:
                    entry["manifest"] = json.loads(content)
                except Exception:
                    entry["manifest"] = {}
    return bundles


async def import_bundle(zip_bytes: bytes, *, push_shapes: bool = True) -> dict[str, Any]:
    """Импортировать SIGMA-bundle (single или corpus) обратно в RAGRAF.

    Регламенты пишутся в DuckDB как обычные правки (через `regulation_store.save`),
    SHACL пушится в upstream через `client.update_shapes` если `push_shapes=True`
    и upstream доступен (мягкий failure — не валим импорт целиком).

    Возвращает отчёт: `{imported, skipped, failed}` со списком source_id в каждой
    категории + причина для failed/skipped.
    """
    from app.services.turtle_bridge import parse_regulation_turtle

    bundles = _parse_bundle_zip(zip_bytes)
    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for folder, files in bundles.items():
        data_ttl = files.get("data_ttl", "")
        shapes_ttl = files.get("shapes_ttl", "")
        manifest = files.get("manifest", {})

        if not data_ttl:
            skipped.append({"source_id": folder, "reason": "missing data.ttl"})
            continue

        # source_id: предпочитаем manifest.source_id (если он от RAGRAF),
        # иначе берём имя папки. Это устойчиво к тому что СИГМА могла
        # переименовать папку.
        source_id = manifest.get("source_id") or folder
        if source_id == "_root_":
            skipped.append({"source_id": folder, "reason": "no source_id in manifest"})
            continue

        try:
            reg = parse_regulation_turtle(data_ttl, source_id=source_id, shapes_turtle=shapes_ttl)
        except Exception as e:
            failed.append({"source_id": source_id, "reason": f"parse_regulation: {e}"})
            continue

        # Сохраняем в DuckDB как обычную правку. Комментарий идёт в history —
        # сразу видно что версия пришла из импорта.
        try:
            regulation_store.save(reg, author="sigma-import", comment="Импорт SIGMA-bundle")
        except Exception as e:
            failed.append({"source_id": source_id, "reason": f"save: {e}"})
            continue

        shapes_pushed = False
        shapes_error: str | None = None
        if push_shapes and shapes_ttl.strip():
            try:
                await client.update_shapes(source_id, shapes_ttl)
                shapes_pushed = True
            except Exception as e:
                # Мягкий failure: регламент уже в DuckDB, SHACL можно дослать
                # позже через UI «Импорт SHACL».
                shapes_error = str(e)

        imported.append({
            "source_id": source_id,
            "name": reg.name,
            "parameter_count": len(reg.parameters),
            "shapes_pushed": shapes_pushed,
            "shapes_error": shapes_error,
        })

    return {
        "format_version": EXPORT_FORMAT_VERSION,
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "total_imported": len(imported),
        "total_skipped": len(skipped),
        "total_failed": len(failed),
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
    }
