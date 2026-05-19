"""DuckDB-store для Process — цифрового двойника процесса управления.

Process объединяет N регламентов в одну операционную картину для:
  - визуализации (Cytoscape подграф только этих регламентов + их связей);
  - симуляции цепочки сценариев на нескольких регламентах сразу;
  - экспорта артефакта (Turtle / SIGMA-bundle ZIP).

Сами регламенты остаются authoritative в `regulations`. Process — это
**view-of-the-system**, denormalized listing, без отдельной M:N-таблицы
(regulation_ids хранятся JSON-массивом в одной строке). Это терпимо при
типичном размере процесса в 2-10 регламентов; при росте до 100+ — стоит
выделить `process_regulations` с position.

Connection sharing: используем regulation_store._connection() и
regulation_store._LOCK — один DuckDB-singleton на файл `regulations.duckdb`.
Вторая независимая связь с тем же файлом приводила к гонке WAL-flush'а —
цифровые двойники терялись после рестарта (фикс 051).

См. также:
  - app/schemas/domain.py:Process — Pydantic-модель;
  - app/api/processes.py — REST.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.schemas.domain import Process, ProcessWiringEntry
from app.services import regulation_store


# ── CRUD ───────────────────────────────────────────────────────────────


def list_all() -> list[Process]:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            """
            SELECT id, name, description, regulation_ids, wiring, created_at, updated_at
            FROM processes
            ORDER BY updated_at DESC, name
            """
        ).fetchall()
    return [
        Process(
            id=r[0],
            name=r[1],
            description=r[2],
            regulation_ids=_decode_ids(r[3]),
            wiring=_decode_wiring(r[4]),
            created_at=r[5].isoformat() if r[5] else None,
            updated_at=r[6].isoformat() if r[6] else None,
        )
        for r in rows
    ]


def get(process_id: str) -> Process | None:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        row = c.execute(
            """
            SELECT id, name, description, regulation_ids, wiring, created_at, updated_at
            FROM processes WHERE id = ?
            """,
            [process_id],
        ).fetchone()
    if row is None:
        return None
    return Process(
        id=row[0],
        name=row[1],
        description=row[2],
        regulation_ids=_decode_ids(row[3]),
        wiring=_decode_wiring(row[4]),
        created_at=row[5].isoformat() if row[5] else None,
        updated_at=row[6].isoformat() if row[6] else None,
    )


def save(p: Process) -> Process:
    """Upsert по id. Если id пустой — генерируем uuid.

    Возвращает сохранённый процесс с проставленными created_at / updated_at.

    Проекция wiring в flow.json членов — НЕ здесь, а в `project_wiring_to_flows`.
    Это сознательное разделение: store сохраняет только данные Twin'а; проекция
    (которая может упасть на orphan regulation) живёт уровнем выше, в API.
    """
    now = datetime.now(timezone.utc)
    new_id = p.id or uuid.uuid4().hex[:12]
    ids_json = json.dumps(p.regulation_ids or [], ensure_ascii=False)
    wiring_json = json.dumps(
        [w.model_dump() for w in (p.wiring or [])],
        ensure_ascii=False,
    )
    with regulation_store._LOCK:
        c = regulation_store._connection()
        c.execute(
            """
            INSERT INTO processes (id, name, description, regulation_ids, wiring, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                regulation_ids = EXCLUDED.regulation_ids,
                wiring = EXCLUDED.wiring,
                updated_at = EXCLUDED.updated_at
            """,
            [new_id, p.name, p.description, ids_json, wiring_json, now, now],
        )
    return get(new_id) or Process(
        id=new_id, name=p.name, description=p.description,
        regulation_ids=list(p.regulation_ids), wiring=list(p.wiring or []),
    )


def delete(process_id: str) -> bool:
    with regulation_store._LOCK:
        c = regulation_store._connection()
        existed = c.execute(
            "SELECT 1 FROM processes WHERE id = ?", [process_id],
        ).fetchone() is not None
        if not existed:
            return False
        c.execute("DELETE FROM processes WHERE id = ?", [process_id])
    return True


def list_in_twins(regulation_id: str) -> list[dict[str, Any]]:
    """Какие Twin'ы содержат данный регламент.

    Reverse-lookup для плашки в Edit регламента: «Атомарный / В Двойниках: …».
    DuckDB `list_contains` не работает напрямую с JSON-колонкой (нужно явный
    каст), поэтому делаем Python-side фильтрацию через _decode_ids — она
    толерантна к JSON/list-выдаче. N мало (типично десятки двойников).
    """
    with regulation_store._LOCK:
        c = regulation_store._connection()
        rows = c.execute(
            """
            SELECT id, name, description, regulation_ids
            FROM processes
            ORDER BY updated_at DESC, name
            """,
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        ids = _decode_ids(r[3])
        if regulation_id in ids:
            out.append({"id": r[0], "name": r[1], "description": r[2]})
    return out


def find_wiring_owners(target_regulation: str, target_param_ref: str) -> list[str]:
    """ID Twin'ов, у которых в wiring есть target (regulation, param_ref).

    Используется для конфликт-детекта при save Twin'а: если уже есть
    владелец wiring для этой пары — новый Twin не может выставить своё
    значение (см. soft refactor ограничение «1 регламент.param = 1 twin владеет»).

    Возвращает список Twin.id; пустой = свободно.
    """
    twins = list_all()
    owners: list[str] = []
    for t in twins:
        for w in (t.wiring or []):
            if w.target_regulation == target_regulation and w.target_param_ref == target_param_ref:
                owners.append(t.id)
                break
    return owners


def project_wiring_to_flows(
    process: Process, previous_wiring: list[ProcessWiringEntry] | None = None
) -> dict[str, list[str]]:
    """Спроецировать Twin.wiring в flow.json членов.

    Контракт «Двойник хранит wiring»:
      • Для каждой записи: находим target_regulation.flow.json. Среди sensor-
        нод с sourceKind='regulation' ищем ту, что bindsTo input с paramRef =
        target_param_ref. Если нет такого sensor'а — создаём + edge sensor→input.
      • Прописываем sourceRegulationId / sourceOutputAction.
      • Сохраняем flow → сработает Flow→Triggers sync (regulation_triggers).

    Снятие записи (была в previous_wiring, нет в текущем):
      • Sensor остаётся (пользователь мог его рисовать руками), но
        sourceRegulationId / sourceOutputAction обнуляются → пилюля
        превращается в placeholder.

    Возвращает diff `{"applied": [...], "cleared": [...]}` — для логов / тестов.
    """
    from app.schemas.domain import FlowEdge, FlowNode, RuleDSL
    from app.services.flow_storage import load_flow, save_flow

    diff: dict[str, list[str]] = {"applied": [], "cleared": []}
    current_keys = {(w.target_regulation, w.target_param_ref) for w in (process.wiring or [])}
    previous_keys = {
        (w.target_regulation, w.target_param_ref) for w in (previous_wiring or [])
    }

    # ── 1) Применить актуальные wiring-записи ──────────────────────────────
    for w in process.wiring or []:
        flow = load_flow(w.target_regulation)
        if flow is None:
            # Регламент существует в БД, но flow.json ещё не создан. Создаём
            # минимальный пустой DSL — следующий /api/regulations/{id}/flow
            # его дополнит. Не падаем: тогда wiring был бы сохранён, а
            # проекция отложена; пользователь бы запутался.
            flow = RuleDSL(
                rule_id=f"rule_{w.target_regulation}",
                regulation_id=w.target_regulation,
                nodes=[], edges=[],
            )

        # Ищем input-ноду с paramRef = target_param_ref.
        input_node = next(
            (n for n in flow.nodes if n.type == "input" and n.paramRef == w.target_param_ref),
            None,
        )
        if input_node is None:
            # input ещё не создан (regulation Form ещё не редактировался).
            # Создаём минимальную input-ноду — без неё sensor не к чему привязать.
            new_input_id = f"n_in_{w.target_param_ref}"
            # Дедуп: если такой id уже есть с другим назначением — добавим суффикс.
            existing_ids = {n.id for n in flow.nodes}
            counter = 1
            while new_input_id in existing_ids:
                new_input_id = f"n_in_{w.target_param_ref}_{counter}"
                counter += 1
            input_node = FlowNode(
                id=new_input_id,
                type="input",
                paramRef=w.target_param_ref,
                label=w.target_param_ref,
                position={"x": 0.0, "y": 0.0},
            )
            flow.nodes.append(input_node)

        # Ищем sensor с bindsTo=input_node.id (любого режима).
        sensor_node = next(
            (n for n in flow.nodes if n.type == "sensor" and n.bindsTo == input_node.id),
            None,
        )
        if sensor_node is None:
            new_sensor_id = f"n_sensor_regsrc_{w.target_param_ref}"
            existing_ids = {n.id for n in flow.nodes}
            counter = 1
            while new_sensor_id in existing_ids:
                new_sensor_id = f"n_sensor_regsrc_{w.target_param_ref}_{counter}"
                counter += 1
            input_pos = input_node.position or {"x": 0.0, "y": 0.0}
            sensor_node = FlowNode(
                id=new_sensor_id,
                type="sensor",
                bindsTo=input_node.id,
                sourceKind="regulation",
                sourceRegulationId=w.source_regulation,
                sourceOutputAction=w.source_output,
                label=f"← {w.source_regulation}",
                position={
                    "x": float(input_pos.get("x", 0.0)) - 220.0,
                    "y": float(input_pos.get("y", 0.0)),
                },
            )
            flow.nodes.append(sensor_node)
            # Visual edge — без него reactflow не рисует связь.
            flow.edges.append(FlowEdge(source=sensor_node.id, target=input_node.id))
        else:
            sensor_node.sourceKind = "regulation"
            sensor_node.sourceRegulationId = w.source_regulation
            sensor_node.sourceOutputAction = w.source_output
            # Чистим физико-датчиковые поля, чтобы canvas и executor не путались.
            sensor_node.sensorType = None
            sensor_node.sensorSubtype = None

        save_flow(w.target_regulation, flow, author="twin-project",
                  comment=f"Wiring от Twin '{process.id}': "
                          f"{w.source_regulation}/{w.source_output or '*'} → {w.target_param_ref}")
        diff["applied"].append(f"{w.target_regulation}/{w.target_param_ref}")

    # ── 2) Очистить wiring, которое было раньше, но больше нет ─────────────
    for stale in previous_keys - current_keys:
        target_reg, param_ref = stale
        flow = load_flow(target_reg)
        if flow is None:
            continue
        input_node = next(
            (n for n in flow.nodes if n.type == "input" and n.paramRef == param_ref),
            None,
        )
        if input_node is None:
            continue
        sensor_node = next(
            (n for n in flow.nodes
             if n.type == "sensor" and n.bindsTo == input_node.id
             and (n.sourceKind or "sensor") == "regulation"),
            None,
        )
        if sensor_node is None:
            continue
        # Не удаляем sensor — пользователь мог его двигать, добавить label.
        # Просто очищаем source-поля → пилюля становится placeholder'ом.
        sensor_node.sourceRegulationId = None
        sensor_node.sourceOutputAction = None
        save_flow(target_reg, flow, author="twin-project",
                  comment=f"Wiring снят при правке Twin '{process.id}'")
        diff["cleared"].append(f"{target_reg}/{param_ref}")

    return diff


# ── Helpers ────────────────────────────────────────────────────────────


def _decode_ids(raw: Any) -> list[str]:
    """DuckDB JSON-колонка отдаёт либо list (если decoded), либо str.

    Защищаемся от обоих вариантов.
    """
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return [str(x) for x in v] if isinstance(v, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _decode_wiring(raw: Any) -> list[ProcessWiringEntry]:
    """Раскодировать JSON-массив wiring-записей в Pydantic-модели.

    Толерантны к мусору: невалидные записи пропускаем, не валим Twin при
    рассинхроне схем (например, после миграции в которой убрали поле).
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    out: list[ProcessWiringEntry] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            out.append(ProcessWiringEntry.model_validate(item))
        except Exception:
            continue
    return out
