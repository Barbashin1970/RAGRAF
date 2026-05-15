"""Rule DSL flow — load/save the visual rule for a regulation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.domain import RuleDSL
from app.services import fixtures, regulation_store
from app.services.flow_storage import derive_params_from_flow, load_flow, save_flow

router = APIRouter()


@router.get("/regulations/{regulation_id}/flow")
def get_flow(regulation_id: str) -> RuleDSL:
    """Загрузить сохранённый flow; если нет — отдать стартовый из фикстуры
    (когда для регламента есть `.flow.json`); иначе — пустой каркас.

    Sync `def`: внутри только sync I/O (filesystem + json). FastAPI выполнит
    в thread-pool — корректное P8-поведение.
    """
    dsl = load_flow(regulation_id)
    if dsl is not None:
        return dsl
    starter = fixtures.read_flow(regulation_id)
    if starter:
        return RuleDSL.model_validate_json(starter)
    return RuleDSL(rule_id=f"rule_{regulation_id}", regulation_id=regulation_id)


@router.put("/regulations/{regulation_id}/flow")
def put_flow(regulation_id: str, dsl: RuleDSL) -> dict[str, object]:
    """Сохранить flow + синхронизировать параметры регламента из input-нод.

    Sync Flow → Form: после сохранения DSL выводим параметры из input-нод
    flow'а (paramRef + парный threshold) и обновляем `regulations.parameters`
    в DuckDB. `sync_flow=False` в save() гасит обратный реконсил, чтобы не
    зациклиться — иначе Form-sync переписал бы только что сохранённый flow.

    Возвращает версию + diff по параметрам, чтобы UI мог показать тост
    «параметры в регламенте синхронизированы».
    """
    if dsl.regulation_id != regulation_id:
        raise HTTPException(status_code=400, detail="regulation_id в теле не совпадает с URL")
    version = save_flow(regulation_id, dsl)

    # Sync Flow → Form: производим параметры из flow.
    params_diff: dict[str, list[str]] = {"added": [], "removed": [], "updated": []}
    try:
        reg = regulation_store.get(regulation_id)
        if reg is not None:
            new_params = derive_params_from_flow(dsl)
            old_ids = {p.id for p in reg.parameters}
            new_ids = {p.id for p in new_params}
            params_diff["added"] = sorted(new_ids - old_ids)
            params_diff["removed"] = sorted(old_ids - new_ids)
            # «Updated» — параметры с теми же id, но другими refValue/deviation/unit/name.
            old_by_id = {p.id: p for p in reg.parameters}
            updated = []
            for np in new_params:
                op = old_by_id.get(np.id)
                if op and (
                    op.referenceValue != np.referenceValue
                    or op.deviationAllowed != np.deviationAllowed
                    or op.unit != np.unit
                    or op.name != np.name
                ):
                    updated.append(np.id)
            params_diff["updated"] = sorted(updated)

            # Применяем только если есть реальные изменения — иначе не плодим
            # лишних версий в regulation_history на каждый flow-save.
            if params_diff["added"] or params_diff["removed"] or params_diff["updated"]:
                reg.parameters = new_params
                regulation_store.save(
                    reg, author="flow-sync",
                    comment="Sync с Flow: " + ", ".join(
                        f"{k}={v}" for k, v in params_diff.items() if v
                    ),
                    sync_flow=False,
                )
    except Exception:
        # Sync — best-effort: если упал, flow всё равно сохранён.
        pass

    return {"ok": "true", "version": version.version_id, "params_sync": params_diff}
