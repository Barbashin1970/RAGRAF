"""REST для Process — цифрового двойника процесса управления.

Process — именованная коллекция регламентов; страница «Цифровой двойник»
в UI собирает 2-N регламентов в одну операционную картину для просмотра
графа цепочки, симуляции и экспорта артефактов.

Endpoints:
  GET    /api/processes            — список всех двойников
  GET    /api/processes/{id}       — один двойник
  POST   /api/processes            — создать
  PUT    /api/processes/{id}       — обновить
  DELETE /api/processes/{id}       — удалить

Экспорт артефактов:
  GET    /api/processes/{id}/bundle.zip   — ZIP с N data.ttl + shapes.ttl + manifest
  GET    /api/processes/{id}/turtle       — объединённый Turtle всех регламентов
                                            в одном text/plain файле (для быстрого
                                            просмотра/копирования)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, Response

from app.schemas.domain import Process
from app.services import process_store, regulation_store, sigma_export
from app.services.turtle_bridge import regulation_to_turtle

router = APIRouter()


def _validate_wiring(payload: Process) -> None:
    """Жёсткая валидация Twin.wiring перед save'ом.

    Бизнес-инварианты (см. ProcessWiringEntry docstring):
      1. target_regulation и source_regulation — оба в regulation_ids Twin'а.
      2. target_regulation != source_regulation (само-ссылка запрещена).
      3. Ни одна пара (target_regulation, target_param_ref) не повторяется
         внутри wiring одного Twin'а — иначе projection в flow.json двойственна.
      4. Все строковые ID непустые.
      5. Если regulation_ids пуст — wiring должен быть пуст (нечем связывать).

    Конфликт-детект между разными Twin'ами — отдельной валидации, не здесь:
    она вызывается только в update_process (через find_wiring_owners).
    """
    members = set(payload.regulation_ids or [])

    if (payload.wiring or []) and not members:
        raise HTTPException(
            status_code=400,
            detail="Двойник без регламентов не может иметь связей. Добавьте регламенты в состав.",
        )

    seen_targets: set[tuple[str, str]] = set()
    for i, w in enumerate(payload.wiring or []):
        prefix = f"wiring[{i}]"
        # 4. non-empty.
        if not w.target_regulation or not w.target_param_ref or not w.source_regulation:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation, target_param_ref и source_regulation обязательны (непустые строки).",
            )
        # 1. members.
        if w.target_regulation not in members:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation '{w.target_regulation}' не входит в regulation_ids двойника.",
            )
        if w.source_regulation not in members:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: source_regulation '{w.source_regulation}' не входит в regulation_ids двойника.",
            )
        # 2. self-ref.
        if w.target_regulation == w.source_regulation:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: target_regulation == source_regulation ({w.target_regulation}). Само-ссылка не имеет смысла.",
            )
        # 3. unique target.
        key = (w.target_regulation, w.target_param_ref)
        if key in seen_targets:
            raise HTTPException(
                status_code=400,
                detail=f"{prefix}: дубликат связи на ({w.target_regulation}, {w.target_param_ref}). Один параметр = максимум один источник.",
            )
        seen_targets.add(key)


def _drop_orphan_wiring(payload: Process) -> None:
    """Авто-удаление wiring-записей, ссылающихся на регламенты, которых
    больше нет в regulation_ids.

    UX: пользователь убрал регламент из состава — wiring на него уже не
    имеет смысла. Не отклоняем save с 400, а тихо чистим (вызывается ДО
    _validate_wiring). Иначе аналитика бы заставляли два раза кликать:
    «убрать связь, потом убрать регламент».
    """
    members = set(payload.regulation_ids or [])
    payload.wiring = [
        w for w in (payload.wiring or [])
        if w.target_regulation in members and w.source_regulation in members
    ]


@router.get("/processes")
def list_processes() -> list[Process]:
    """Все двойники, последние правки сверху."""
    return process_store.list_all()


@router.get("/processes/{process_id}")
def get_process(process_id: str) -> Process:
    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    return p


@router.post("/processes", status_code=201)
def create_process(payload: Process) -> Process:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Имя двойника обязательно")
    _validate_wiring(payload)
    # Игнорируем входящий id для POST — генерим сами в store (uuid12).
    payload.id = ""
    saved = process_store.save(payload)
    if saved.wiring:
        try:
            process_store.project_wiring_to_flows(saved, previous_wiring=[])
        except Exception:
            pass
    return saved


@router.put("/processes/{process_id}")
def update_process(process_id: str, payload: Process) -> Process:
    existing = process_store.get(process_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    payload.id = process_id

    # PUT: тихо чистим wiring-записи, чьи регламенты пользователь снял из
    # состава. Это даёт «one-click remove member» в UI Twin Editor'а:
    # убираем регламент → wiring на него уходит вместе. Остальные ошибки
    # (новые записи на не-членов, дубликаты, self-ref) валидатор отбивает.
    _drop_orphan_wiring(payload)
    _validate_wiring(payload)

    # Конфликт-детект: проверяем что новый wiring не нарушает «1 регламент.param =
    # 1 twin владеет» (см. ProcessWiringEntry docstring). Если другой Twin уже
    # владеет той же парой (target_regulation, target_param_ref) — 409 Conflict.
    for w in payload.wiring or []:
        owners = process_store.find_wiring_owners(w.target_regulation, w.target_param_ref)
        # Текущий Twin сам себя видеть может (если поле было уже в его wiring) —
        # отфильтровываем. Если есть другие — конфликт.
        other_owners = [o for o in owners if o != process_id]
        if other_owners:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Регламент '{w.target_regulation}' (параметр '{w.target_param_ref}') "
                    f"уже подключён в другом Двойнике: {', '.join(other_owners)}. "
                    f"Удалите wiring там или используйте другой параметр."
                ),
            )

    previous = existing.wiring or []
    saved = process_store.save(payload)
    try:
        process_store.project_wiring_to_flows(saved, previous_wiring=previous)
    except Exception:
        pass
    return saved


@router.delete("/processes/{process_id}")
def delete_process(process_id: str) -> dict[str, Any]:
    # Перед удалением — снимаем проекцию wiring с flow.json членов, чтобы
    # «битые» source-ссылки не оставались висеть в регламентах.
    existing = process_store.get(process_id)
    if existing is not None and existing.wiring:
        cleared = Process(
            id=existing.id, name=existing.name, description=existing.description,
            regulation_ids=existing.regulation_ids, wiring=[],
        )
        try:
            process_store.project_wiring_to_flows(cleared, previous_wiring=existing.wiring)
        except Exception:
            pass
    deleted = process_store.delete(process_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    return {"ok": True, "process_id": process_id}


# ── Экспорт артефактов ────────────────────────────────────────────────


@router.get("/processes/{process_id}/bundle.zip")
async def export_process_bundle(process_id: str):
    """Экспорт двойника в SIGMA-bundle ZIP (N регламентов).

    Структура: одна папка на каждый regulation_id с data.ttl + shapes.ttl +
    manifest.json; на корне `corpus_manifest.json` с метой двойника.
    Переиспользует `sigma_export.build_corpus_bundle` с whitelist'ом.
    """
    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")
    if not p.regulation_ids:
        raise HTTPException(
            status_code=400,
            detail="Двойник пуст — добавьте хотя бы один регламент перед экспортом",
        )
    zip_bytes, _manifest = await sigma_export.build_corpus_bundle(
        regulation_ids=p.regulation_ids,
    )
    safe_name = (p.name or process_id).replace(" ", "-")[:80]
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="twin-{safe_name}.zip"',
        },
    )


@router.get("/processes/{process_id}/turtle", response_class=PlainTextResponse)
def export_process_turtle(process_id: str) -> str:
    """Объединённый Turtle всех регламентов двойника + Twin-блок с wiring.

    Структура файла:
      1. Twin-header block — `:Twin_<id> a :DigitalTwin` с метаданными
         (название, описание, regulation_ids) и явными wiring-триплами:
         `:wiring_N a :Wiring ; :sourceRegulation … ; :targetRegulation …`.
         Это закрывает критический gap: раньше Turtle двойника был просто
         «3 регламента подряд» без какой-либо связи — потребитель (SIGMA-
         ядро, Apache Jena, аналитик) не мог отличить артефакт двойника
         от случайного дампа.
      2. Каждый регламент-член — через `regulation_to_turtle`, с разделителем-
         комментарием для читаемости.

    Все IRI совпадают с теми, что генерит `regulation_to_turtle` —
    `_instance_local_name(reg.id)` гарантирует round-trip и SPARQL-доступ
    «найти все wiring, чей source = X» через стандартные `?wiring :sourceRegulation X`.
    """
    from app.services.turtle_bridge import _instance_local_name

    p = process_store.get(process_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Двойник '{process_id}' не найден")

    chunks: list[str] = []
    chunks.append(f"# Twin: {p.name}")
    if p.description:
        chunks.append(f"# {p.description}")
    chunks.append(f"# Регламентов: {len(p.regulation_ids)}")
    if p.wiring:
        chunks.append(f"# Связей: {len(p.wiring)}")
    chunks.append("#")
    chunks.append("# Этот Turtle-файл содержит ТОЛЬКО RDF-данные двойника + регламентов.")
    chunks.append("# Логика потоков (Rule DSL) выгружается отдельно — в bundle.zip есть")
    chunks.append("# flow.json для каждого регламента + regulation.json (Pydantic-дамп).")
    chunks.append("#")
    chunks.append("# Где проверить структуру:")
    chunks.append("#   • https://www.ldf.fi/service/rdf-grapher  — визуализация графа (paste & go).")
    chunks.append("#   • https://rdfshape.weso.es/                — валидатор Turtle + SPARQL.")
    chunks.append("#   • https://webprotege.stanford.edu/         — полноценный OWL-редактор.")
    chunks.append("")

    # ── Twin-header block ────────────────────────────────────────────────
    chunks.append("# ──────────── Цифровой двойник (Twin) ────────────")
    chunks.append("@prefix : <http://regulations.local/ontology#> .")
    chunks.append("@prefix owl: <http://www.w3.org/2002/07/owl#> .")
    chunks.append("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .")
    chunks.append("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .")
    chunks.append("")

    twin_iri = f":Twin_{p.id}"
    twin_block_lines: list[str] = []
    twin_block_lines.append(f"{twin_iri} a :DigitalTwin ;")
    twin_block_lines.append(f'    rdfs:label {_turtle_string(p.name)} ;')
    if p.description:
        twin_block_lines.append(f'    rdfs:comment {_turtle_string(p.description)} ;')
    twin_block_lines.append(
        f'    :memberCount "{len(p.regulation_ids)}"^^xsd:integer ;'
    )
    if p.created_at:
        twin_block_lines.append(
            f'    :createdAt "{p.created_at}"^^xsd:dateTime ;'
        )
    if p.updated_at:
        twin_block_lines.append(
            f'    :updatedAt "{p.updated_at}"^^xsd:dateTime ;'
        )
    # hasMember — список регламентов-членов как комбинированный triple-pattern.
    if p.regulation_ids:
        members_iris = [f":{_instance_local_name(rid)}" for rid in p.regulation_ids]
        twin_block_lines.append(
            "    :hasMember " + ", ".join(members_iris)
            + (" ;" if p.wiring else " .")
        )
    # hasWiring — список wiring-блоков. Сами блоки определим ниже.
    if p.wiring:
        wiring_iris = [f":wiring_{p.id}_{i}" for i in range(len(p.wiring))]
        twin_block_lines.append(
            "    :hasWiring " + ", ".join(wiring_iris) + " ."
        )
    if not p.regulation_ids and not p.wiring:
        # Пустой Twin — закрываем точкой.
        twin_block_lines[-1] = twin_block_lines[-1].rstrip(";").rstrip() + " ."
    chunks.append("\n".join(twin_block_lines))
    chunks.append("")

    # ── Wiring-блоки ─────────────────────────────────────────────────────
    if p.wiring:
        chunks.append("# ──────────── Связи (Wiring) ────────────")
        for i, w in enumerate(p.wiring):
            w_iri = f":wiring_{p.id}_{i}"
            src_iri = f":{_instance_local_name(w.source_regulation)}"
            tgt_iri = f":{_instance_local_name(w.target_regulation)}"
            block = [
                f"{w_iri} a :Wiring ;",
                f"    :sourceRegulation {src_iri} ;",
            ]
            if w.source_output:
                block.append(f'    :sourceOutput {_turtle_string(w.source_output)} ;')
            block.append(f"    :targetRegulation {tgt_iri} ;")
            block.append(f'    :targetInput {_turtle_string(w.target_param_ref)} .')
            chunks.append("\n".join(block))
        chunks.append("")
        # Класс :Wiring + properties — декларация типов для OWL-парсера.
        chunks.append(":DigitalTwin a owl:Class .")
        chunks.append(":Wiring a owl:Class .")
        chunks.append(":hasMember a owl:ObjectProperty ;")
        chunks.append("    rdfs:domain :DigitalTwin ;")
        chunks.append("    rdfs:range :Regulation .")
        chunks.append(":hasWiring a owl:ObjectProperty ;")
        chunks.append("    rdfs:domain :DigitalTwin ;")
        chunks.append("    rdfs:range :Wiring .")
        chunks.append(":sourceRegulation a owl:ObjectProperty ;")
        chunks.append("    rdfs:domain :Wiring ;")
        chunks.append("    rdfs:range :Regulation .")
        chunks.append(":targetRegulation a owl:ObjectProperty ;")
        chunks.append("    rdfs:domain :Wiring ;")
        chunks.append("    rdfs:range :Regulation .")
        chunks.append(":sourceOutput a owl:DatatypeProperty ;")
        chunks.append("    rdfs:domain :Wiring ;")
        chunks.append("    rdfs:range xsd:string .")
        chunks.append(":targetInput a owl:DatatypeProperty ;")
        chunks.append("    rdfs:domain :Wiring ;")
        chunks.append("    rdfs:range xsd:string .")
        chunks.append("")

    # ── Регламенты-члены ─────────────────────────────────────────────────
    for rid in p.regulation_ids:
        reg = regulation_store.get(rid)
        if reg is None:
            chunks.append(f"# !! Регламент '{rid}' не найден, пропущен")
            continue
        chunks.append(f"# ──────────── {rid} ────────────")
        chunks.append(regulation_to_turtle(reg))
        chunks.append("")
    return "\n".join(chunks)


def _turtle_string(s: str) -> str:
    """Сериализовать строку для Turtle как quoted-literal.

    Возвращает строку в формате `"..."` с экранированными `\\` и `"`,
    плюс заменой переноса строки на `\\n` (multi-line литералы в Turtle
    требуют тройных кавычек — здесь используем одинарные для простоты).
    """
    escaped = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")
    return f'"{escaped}"'
