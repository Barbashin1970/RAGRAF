"""Filesystem-backed storage for Rule DSL drafts and immutable version snapshots.

Layout under DATA_DIR:

    data/
      flows/<regulation_id>.json           # current DSL
      versions/<regulation_id>/<ts>.json   # immutable snapshots
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.schemas.domain import FlowEdge, FlowNode, FlowVersion, Parameter, RuleDSL


def _data_root() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    (root / "flows").mkdir(exist_ok=True)
    (root / "versions").mkdir(exist_ok=True)
    return root


def _flow_path(regulation_id: str) -> Path:
    return _data_root() / "flows" / f"{regulation_id}.json"


def _versions_dir(regulation_id: str) -> Path:
    d = _data_root() / "versions" / regulation_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def delete_flow(regulation_id: str) -> bool:
    """Удалить flow + всю папку версий регламента. Idempotent — нет файла → ok."""
    import shutil
    p = _flow_path(regulation_id)
    deleted = False
    if p.exists():
        p.unlink()
        deleted = True
    versions_root = _data_root() / "versions" / regulation_id
    if versions_root.exists():
        shutil.rmtree(versions_root, ignore_errors=True)
        deleted = True
    return deleted


def load_flow(regulation_id: str) -> RuleDSL | None:
    p = _flow_path(regulation_id)
    if not p.exists():
        return None
    return RuleDSL.model_validate_json(p.read_text(encoding="utf-8"))


def save_flow(regulation_id: str, dsl: RuleDSL, author: str = "anonymous", comment: str | None = None) -> FlowVersion:
    p = _flow_path(regulation_id)
    p.write_text(dsl.model_dump_json(indent=2), encoding="utf-8")

    version_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    version = FlowVersion(
        version_id=version_id,
        regulation_id=regulation_id,
        created_at=created_at,
        author=author,
        comment=comment,
        dsl_snapshot=dsl,
        diff_summary=None,
    )
    (_versions_dir(regulation_id) / f"{version_id}.json").write_text(
        version.model_dump_json(indent=2), encoding="utf-8"
    )
    return version


def list_versions(regulation_id: str) -> list[FlowVersion]:
    d = _versions_dir(regulation_id)
    out: list[FlowVersion] = []
    for path in sorted(d.glob("*.json"), reverse=True):
        try:
            out.append(FlowVersion.model_validate_json(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
    return out


def get_version(regulation_id: str, version_id: str) -> FlowVersion | None:
    path = _versions_dir(regulation_id) / f"{version_id}.json"
    if not path.exists():
        return None
    return FlowVersion.model_validate_json(path.read_text(encoding="utf-8"))


def restore_version(regulation_id: str, version_id: str) -> FlowVersion | None:
    v = get_version(regulation_id, version_id)
    if not v:
        return None
    return save_flow(regulation_id, v.dsl_snapshot, comment=f"restore of {version_id}")


def reconcile_flow_with_params(
    regulation_id: str, parameters: list[Parameter]
) -> dict[str, list[str]]:
    """Sync Form → Flow: согласовать flow с актуальным списком параметров.

    Form-редактор — primary editor для tabular-полей параметров (имя, ref,
    deviation, unit). Flow-редактор — primary editor для логики (graph nodes).
    Чтобы они не расходились, при сохранении регламента:

    1) Удаляем orphan-цепочки (`input→threshold→compare→…`) у которых input
       ссылается на удалённый параметр. Прекращаем удалять на shared-узле
       (incoming > 1, типично `n_output`).
    2) Добавляем недостающие цепочки для новых параметров — по тому же паттерну
       что в templates._build_chain (input → threshold → compare → output).
       Новые ноды размещаются под существующими по вертикали.
    3) Обновляем threshold-ноды для существующих параметров — `refValue`,
       `deviation`, `unit` синхронизируются с Form'ом (последний save побеждает).

    Возвращает `{"removed", "added", "updated"}` — для логов / UI feedback.
    Если flow'а нет — `removed/updated` пустые, `added` тоже пустые
    (стартовый flow создаётся только при создании регламента).
    """
    flow = load_flow(regulation_id)
    if flow is None:
        return {"removed": [], "added": [], "updated": []}

    valid_param_ids = {p.id for p in parameters}
    params_by_id = {p.id: p for p in parameters}
    changed = False

    # ── (1) Удаление orphan-цепочек ────────────────────────────────────
    stale_inputs = [
        n for n in flow.nodes
        if n.type == "input" and n.paramRef and n.paramRef not in valid_param_ids
    ]
    removed_params: list[str] = []
    if stale_inputs:
        successors: dict[str, list[str]] = {}
        incoming: dict[str, int] = {}
        for e in flow.edges:
            successors.setdefault(e.source, []).append(e.target)
            incoming[e.target] = incoming.get(e.target, 0) + 1

        to_remove: set[str] = set()
        for inp in stale_inputs:
            cursor = inp.id
            while True:
                to_remove.add(cursor)
                succ = successors.get(cursor, [])
                if len(succ) != 1:
                    break
                next_id = succ[0]
                if incoming.get(next_id, 0) > 1:
                    break
                cursor = next_id

        flow.nodes = [n for n in flow.nodes if n.id not in to_remove]
        flow.edges = [e for e in flow.edges if e.source not in to_remove and e.target not in to_remove]
        removed_params = sorted({n.paramRef for n in stale_inputs if n.paramRef})
        changed = True

    # ── (2) Обновление threshold-нод для существующих параметров ──────
    updated_params: list[str] = []
    for node in flow.nodes:
        if node.type != "threshold":
            continue
        # Threshold принадлежит param'у если он непосредственный преемник input(paramRef=P).
        # Находим предка через edges (один шаг).
        preds = [e.source for e in flow.edges if e.target == node.id]
        if len(preds) != 1:
            continue
        # Найти input-предка по id
        pred_node = next((n for n in flow.nodes if n.id == preds[0]), None)
        if not pred_node or pred_node.type != "input" or not pred_node.paramRef:
            continue
        p = params_by_id.get(pred_node.paramRef)
        if p is None:
            continue
        new_ref = p.referenceValue if p.referenceValue is not None else 0.0
        new_dev = p.deviationAllowed if p.deviationAllowed is not None else 1.0
        new_unit = p.unit
        # Update label, refValue, deviation, unit — если что-то изменилось.
        if (
            node.refValue != new_ref
            or node.deviation != new_dev
            or node.unit != new_unit
        ):
            node.refValue = new_ref
            node.deviation = new_dev
            node.unit = new_unit
            node.label = f"{new_ref} ± {new_dev} {new_unit or ''}".strip()
            updated_params.append(p.id)
            changed = True
        # Также синхронизируем label у input-ноды (имя параметра).
        if pred_node.label != p.name:
            pred_node.label = p.name
            changed = True

    # ── (3) Добавление цепочек для новых параметров ───────────────────
    existing_param_ids_in_flow = {
        n.paramRef for n in flow.nodes if n.type == "input" and n.paramRef
    }
    missing_params = [p for p in parameters if p.id not in existing_param_ids_in_flow]
    added_params: list[str] = []
    if missing_params:
        # Найти output-ноду (для подключения compare). Если нет — создадим.
        output_node = next((n for n in flow.nodes if n.type == "output"), None)
        if output_node is None:
            output_node = FlowNode(
                id="n_output",
                type="output",
                label="Рекомендация",
                action="recommendation",
                text="Регламент: при выходе параметра за допустимое отклонение — уведомить ответственное лицо.",
                priority=1,
                position={"x": 880.0, "y": 60.0},
            )
            flow.nodes.append(output_node)
            changed = True

        # Определяем где разместить новые цепочки — под существующими по вертикали.
        max_y = max(
            (n.position.get("y", 0.0) for n in flow.nodes if n.position and n.type in ("input", "threshold", "compare")),
            default=-60.0,
        )
        y_cursor = max_y + 140.0

        for p in missing_params:
            ref = p.referenceValue if p.referenceValue is not None else 0.0
            dev = p.deviationAllowed if p.deviationAllowed is not None else 1.0
            in_id = _unique_node_id(flow.nodes, f"n_in_{p.id}")
            thr_id = _unique_node_id(flow.nodes, f"n_thr_{p.id}")
            cmp_id = _unique_node_id(flow.nodes, f"n_cmp_{p.id}")
            flow.nodes.extend([
                FlowNode(
                    id=in_id, type="input", label=p.name, paramRef=p.id,
                    position={"x": 60.0, "y": float(y_cursor)},
                ),
                FlowNode(
                    id=thr_id, type="threshold",
                    label=f"{ref} ± {dev} {p.unit or ''}".strip(),
                    refValue=ref, deviation=dev, unit=p.unit,
                    position={"x": 320.0, "y": float(y_cursor)},
                ),
                FlowNode(
                    id=cmp_id, type="compare", label="вне диапазона?",
                    operator="outside_range",
                    position={"x": 580.0, "y": float(y_cursor)},
                ),
            ])
            flow.edges.extend([
                FlowEdge(source=in_id, target=thr_id),
                FlowEdge(source=thr_id, target=cmp_id),
                FlowEdge(source=cmp_id, target=output_node.id, condition="outside"),
            ])
            added_params.append(p.id)
            y_cursor += 140.0
            changed = True

    if not changed:
        return {"removed": [], "added": [], "updated": []}

    summary_parts = []
    if removed_params:
        summary_parts.append(f"удалены {', '.join(removed_params)}")
    if added_params:
        summary_parts.append(f"добавлены {', '.join(added_params)}")
    if updated_params:
        summary_parts.append(f"обновлены {', '.join(updated_params)}")
    save_flow(
        regulation_id, flow, author="system",
        comment=f"Sync с регламентом: {'; '.join(summary_parts) if summary_parts else 'технические правки'}",
    )
    return {"removed": removed_params, "added": added_params, "updated": updated_params}


def _unique_node_id(existing_nodes: list[FlowNode], base: str) -> str:
    """Подобрать id, не пересекающийся с уже существующими — для случая когда
    параметр с таким же id когда-то был и его n_in_<id> остался от прошлой жизни."""
    existing_ids = {n.id for n in existing_nodes}
    if base not in existing_ids:
        return base
    suffix = 2
    while f"{base}_{suffix}" in existing_ids:
        suffix += 1
    return f"{base}_{suffix}"


def derive_params_from_flow(dsl: RuleDSL) -> list[Parameter]:
    """Sync Flow → Form: вытащить параметры из flow input + threshold нод.

    Convention: input-нода с заданным `paramRef` = «параметр». Параллельно
    идёт threshold-нода (непосредственный преемник по edge), её `refValue`,
    `deviation`, `unit` идут в Parameter.

    Если threshold-ноды нет — параметр всё равно создаётся (с дефолтными
    значениями), чтобы не терять данные. Дубликаты paramRef'а схлопываются —
    оставляется первая встретившаяся input-нода (UI-конвенция «один param =
    один input-узел»).
    """
    # Индекс edges: input.id → следующая нода (для пары input → threshold).
    next_by_source: dict[str, str] = {}
    for e in dsl.edges:
        # Может быть несколько преемников — берём первый, но обычно у input
        # один преемник (threshold).
        next_by_source.setdefault(e.source, e.target)
    nodes_by_id = {n.id: n for n in dsl.nodes}

    out: list[Parameter] = []
    seen: set[str] = set()
    for n in dsl.nodes:
        if n.type != "input" or not n.paramRef or n.paramRef in seen:
            continue
        seen.add(n.paramRef)
        # Найти threshold через single-step forward.
        next_id = next_by_source.get(n.id)
        thr = nodes_by_id.get(next_id) if next_id else None
        if thr is not None and thr.type != "threshold":
            thr = None
        # Имя — берём label с input'а, или paramRef как fallback (после
        # пользовательского переименования label обычно != paramRef).
        name = (n.label or n.paramRef).strip() or n.paramRef
        out.append(Parameter(
            id=n.paramRef,
            name=name,
            datatype="decimal",
            referenceValue=thr.refValue if thr else None,
            deviationAllowed=thr.deviation if thr else None,
            unit=thr.unit if thr else None,
        ))
    return out
