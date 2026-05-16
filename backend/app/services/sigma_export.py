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


def build_regulation_bundle(source_id: str) -> bytes:
    """Собрать ZIP-bundle одного регламента: data.ttl + shapes.ttl + manifest.json.

    Возвращает байты ZIP — отдаются клиенту через FastAPI как `application/zip`.
    """
    reg = regulation_store.get(source_id)
    if reg is None:
        raise ValueError(f"Регламент {source_id} не найден")

    data_ttl = regulation_to_turtle(reg)
    shapes_ttl = regulation_to_shacl_shapes(reg)
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


def build_corpus_bundle(domain: str | None = None) -> tuple[bytes, dict[str, Any]]:
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
                shapes_ttl = regulation_to_shacl_shapes(reg)
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
