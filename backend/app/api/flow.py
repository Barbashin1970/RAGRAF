"""Rule DSL flow — load/save the visual rule for a regulation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas.domain import RuleDSL
from app.services import fixtures, regulation_store
from app.services.flow_executor import (
    ExecutionResult,
    SensorReading,
    execute_flow,
)
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
    """Сохранить flow + синхронизировать параметры и триггеры регламента.

    Sync Flow → Form: после сохранения DSL выводим параметры из input-нод
    flow'а (paramRef + парный threshold) и обновляем `regulations.parameters`
    в DuckDB. `sync_flow=False` в save() гасит обратный реконсил, чтобы не
    зациклиться — иначе Form-sync переписал бы только что сохранённый flow.

    Sync Flow → Triggers: вместе с параметрами пере-собираем триггеры через
    `reconcile_triggers_with_flow`. Это закрывает сцепку «нарисовал sensor
    в Flow → триггер декларирован в Turtle → виден в Edit + Sensor Library».
    Ручной ввод пользователя из секции «Триггеры» приоритетнее flow:
    переустановка sensor_subtype происходит только если в flow есть явная
    привязка sensor.bindsTo (см. `reconcile_triggers_with_flow` docstring).

    Возвращает версию + diff по параметрам и триггерам, чтобы UI мог показать
    тост «параметры и триггеры синхронизированы».
    """
    if dsl.regulation_id != regulation_id:
        raise HTTPException(status_code=400, detail="regulation_id в теле не совпадает с URL")
    version = save_flow(regulation_id, dsl)

    # Sync Flow → Form + Flow → Triggers (один общий save).
    params_diff: dict[str, list[str]] = {"added": [], "removed": [], "updated": []}
    triggers_diff: dict[str, list[str]] = {"added": [], "removed": [], "updated": []}
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

            # Триггеры: считаем что будет после reconcile. Diff'аем по param_ref —
            # это стабильный ключ (id триггера может меняться при rename param).
            from app.services.triggers import reconcile_triggers_with_flow

            params_for_reconcile = new_params if (
                params_diff["added"] or params_diff["removed"] or params_diff["updated"]
            ) else reg.parameters
            new_triggers = reconcile_triggers_with_flow(
                reg.triggers, dsl, params_for_reconcile,
            )
            old_trig_by_param = {t.param_ref: t for t in reg.triggers}
            new_trig_by_param = {t.param_ref: t for t in new_triggers}
            triggers_diff["added"] = sorted(set(new_trig_by_param) - set(old_trig_by_param))
            triggers_diff["removed"] = sorted(set(old_trig_by_param) - set(new_trig_by_param))
            updated_trig = []
            for param_ref, nt in new_trig_by_param.items():
                ot = old_trig_by_param.get(param_ref)
                if ot and (
                    ot.sensor_subtype != nt.sensor_subtype
                    or ot.event_type != nt.event_type
                    or ot.label != nt.label
                ):
                    updated_trig.append(param_ref)
            triggers_diff["updated"] = sorted(updated_trig)

            params_changed = bool(
                params_diff["added"] or params_diff["removed"] or params_diff["updated"]
            )
            triggers_changed = bool(
                triggers_diff["added"] or triggers_diff["removed"] or triggers_diff["updated"]
            )

            # Sync Flow output → recommendation. Раньше output-нода Flow и
            # `Regulation.recommendations[0]` были двумя независимыми
            # сущностями — текст рекомендации в Form и текст в output
            # ноде могли расходиться. Теперь: первая output-нода Flow с
            # непустым text/action диктует recommendation.text (и priority
            # если задан в ноде). Это даёт единый источник правды для
            # «что рекомендуем оператору».
            #
            # Стратегия — диктатура primary output: берём первый output
            # node с text. Если в Flow несколько output'ов (например по
            # severity), мерджим в нумерованный список. Каждая строка
            # начинается с action как заголовка.
            rec_changed = False
            output_nodes = [n for n in dsl.nodes if n.type == "output"]
            if output_nodes:
                # Сортируем по позиции для стабильности.
                output_nodes.sort(key=lambda n: (
                    n.position.get("y", 0) if n.position else 0,
                    n.position.get("x", 0) if n.position else 0,
                ))
                # Собираем мульти-output в один текст. Если только одна
                # output-нода — используем её text как есть.
                if len(output_nodes) == 1:
                    new_text = output_nodes[0].text or ""
                    new_priority = output_nodes[0].priority or 2
                else:
                    parts = []
                    for n in output_nodes:
                        if not n.text:
                            continue
                        if n.label and n.label.strip():
                            parts.append(f"• [{n.label}] {n.text}")
                        else:
                            parts.append(f"• {n.text}")
                    new_text = "\n".join(parts)
                    # При мульти-output приоритет = max severity (наивысший = 1).
                    new_priority = min(
                        (n.priority for n in output_nodes if n.priority),
                        default=2,
                    )
                if new_text:
                    old_text = reg.recommendations[0].text if reg.recommendations else ""
                    old_priority = reg.recommendations[0].priority if reg.recommendations else 2
                    if new_text != old_text or new_priority != old_priority:
                        from app.schemas.domain import Recommendation
                        existing_rec = reg.recommendations[0] if reg.recommendations else None
                        reg.recommendations = [Recommendation(
                            id=existing_rec.id if existing_rec else f"rec_{regulation_id}",
                            text=new_text,
                            priority=new_priority,  # type: ignore[arg-type]
                            linkedParameters=existing_rec.linkedParameters if existing_rec
                                else [p.id for p in (new_params if params_changed else reg.parameters)],
                        )]
                        rec_changed = True

            # Применяем только если есть реальные изменения — иначе не плодим
            # лишних версий в regulation_history на каждый flow-save.
            if params_changed or triggers_changed or rec_changed:
                if params_changed:
                    reg.parameters = new_params
                reg.triggers = new_triggers
                comment_parts = []
                if params_changed:
                    comment_parts.append(
                        "params: " + ", ".join(
                            f"{k}={v}" for k, v in params_diff.items() if v
                        )
                    )
                if triggers_changed:
                    comment_parts.append(
                        "triggers: " + ", ".join(
                            f"{k}={v}" for k, v in triggers_diff.items() if v
                        )
                    )
                if rec_changed:
                    comment_parts.append("recommendation: text/priority из output-ноды")
                regulation_store.save(
                    reg, author="flow-sync",
                    comment="Sync с Flow — " + "; ".join(comment_parts),
                    sync_flow=False,
                )
    except Exception:
        # Sync — best-effort: если упал, flow всё равно сохранён.
        pass

    return {
        "ok": "true",
        "version": version.version_id,
        "params_sync": params_diff,
        "triggers_sync": triggers_diff,
    }


# ── Режим «Исполнение» (Execute) ────────────────────────────────────────────
#
# Боевой endpoint для СИГМЫ: ETL прислал данные с датчика → SPARQL выбрал
# regulation_id → одним POST'ом сюда забираем вердикт {level, recommendation}.
# Тот же endpoint используется UI «Запустить» для симуляции аналитиком.
#
# Тело — list[SensorReading] (см. flow_executor.py). Опционально можно
# передать `dsl`, чтобы исполнить НЕ сохранённый поток (live draft из
# редактора, чтобы аналитик прогонял изменения без сохранения).
class ExecuteRequest(BaseModel):
    readings: list[SensorReading] = Field(default_factory=list)
    dsl: RuleDSL | None = None  # если задан — исполняем его вместо сохранённого


@router.post("/regulations/{regulation_id}/execute")
def execute_regulation(regulation_id: str, payload: ExecuteRequest) -> ExecutionResult:
    """Прогнать flow с конкретными значениями. Возвращает level/recommendation/trace.

    404 — регламент не найден; 409 — flow не сохранён и не передан в payload.
    """
    reg = regulation_store.get(regulation_id)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Регламент {regulation_id} не найден")
    dsl = payload.dsl or load_flow(regulation_id)
    if dsl is None:
        # Stub-flow из фикстуры — для нетронутых регламентов даёт читаемый
        # ответ «нет потока» вместо 500.
        raise HTTPException(
            status_code=409,
            detail="Для регламента нет сохранённого flow — откройте Редактор Потока и сохраните",
        )
    return execute_flow(dsl, reg, payload.readings)
