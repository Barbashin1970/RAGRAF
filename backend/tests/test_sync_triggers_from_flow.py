"""Тесты Flow→Triggers sync.

Контракт «Flow ведёт — triggers зеркалит» (см. user feedback):
    Когда аналитик переключает sensor-пилюлю на канвасе в режим
    `sourceKind='regulation'` и сохраняет flow, backend материализует
    эту связь в regulation_triggers, чтобы reverse-lookup `/triggered-by`
    моментально видел композицию.

Эти тесты охватывают:
  - UPSERT: новый regulation-source sensor → создаётся регламент-триггер.
  - UPDATE: смена source_regulation / source_output → upsert по стабильному trigger_id.
  - DELETE: пользователь снёс sensor → trigger удаляется.
  - Switch back: переключение sensor → sensor mode → regulation-trigger удаляется.
  - Coexistence: physical-sensor triggers (вкладка «Триггеры») не трогаются.
  - Reverse-lookup: /triggered-by видит новую связь сразу после save_flow.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def _create(client, *, domain="heating", name="Reg"):
    r = client.post("/api/regulations", json={"domain": domain, "name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _flow_with_regsource_sensor(
    *, reg_id: str, source_reg_id: str, source_output: str | None = "verdict",
    param_ref: str = "pressure",
):
    """Builder минимального flow: 1 input + 1 sensor с sourceKind='regulation'.

    bindsTo указывает на input — это обязательно: sync без bindsTo не знает
    какой parameter триггер должен наполнять.
    """
    return {
        "rule_id": f"rule_{reg_id}",
        "regulation_id": reg_id,
        "nodes": [
            {"id": "n_in", "type": "input", "paramRef": param_ref},
            {
                "id": "n_sensor",
                "type": "sensor",
                "sourceKind": "regulation",
                "sourceRegulationId": source_reg_id,
                "sourceOutputAction": source_output,
                "bindsTo": "n_in",
            },
        ],
        "edges": [{"source": "n_sensor", "target": "n_in"}],
    }


def test_save_flow_creates_regulation_trigger(client):
    """После save_flow с regsource-sensor триггер появляется в DB."""
    consumer = _create(client, domain="heating", name="Потребитель")
    source = _create(client, domain="safety", name="Источник")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id=source)
    r = client.put(f"/api/regulations/{consumer}/flow", json=flow)
    assert r.status_code == 200, r.text

    # Триггер регламента появился — проверяем через GET regulation (он включает triggers)
    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc_triggers = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert len(regsrc_triggers) == 1
    t = regsrc_triggers[0]
    assert t["source_regulation"] == source
    assert t["source_output"] == "verdict"
    assert t["param_ref"] == "pressure"
    # sensor_subtype остаётся None — это «слушаю регламент», не датчик.
    assert t.get("sensor_subtype") is None


def test_reverse_lookup_sees_link_immediately(client):
    """`GET /triggered-by` источника видит композицию сразу после save_flow."""
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id=source)
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    r = client.get(f"/api/regulations/{source}/triggered-by")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 1
    listener = data["triggers"][0]
    assert listener["regulation_id"] == consumer
    assert listener["source_output"] == "verdict"


def test_change_source_output_upserts_same_trigger(client):
    """Смена sourceOutputAction в flow — UPSERT, не дубль (стабильный trigger_id)."""
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = _flow_with_regsource_sensor(
        reg_id=consumer, source_reg_id=source, source_output="action_a"
    )
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    flow["nodes"][1]["sourceOutputAction"] = "action_b"
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert len(regsrc) == 1, "должна остаться одна запись (UPSERT), а не две"
    assert regsrc[0]["source_output"] == "action_b"


def test_switch_back_to_sensor_mode_removes_trigger(client):
    """Переключение sensor → sensor mode (sourceKind=null) — триггер удаляется."""
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id=source)
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    # Возвращаем sensor в обычный режим — обнуляем sourceKind + sourceRegulationId.
    flow["nodes"][1]["sourceKind"] = "sensor"
    flow["nodes"][1]["sourceRegulationId"] = None
    flow["nodes"][1]["sourceOutputAction"] = None
    flow["nodes"][1]["sensorType"] = "p"
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert regsrc == [], "regsource триггер должен исчезнуть"

    # Reverse-lookup тоже пуст.
    r = client.get(f"/api/regulations/{source}/triggered-by")
    assert r.json()["count"] == 0


def test_delete_sensor_node_removes_trigger(client):
    """Полное удаление sensor-ноды из flow → триггер удаляется."""
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id=source)
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    # Сносим sensor-ноду и edge.
    flow["nodes"] = [n for n in flow["nodes"] if n["id"] != "n_sensor"]
    flow["edges"] = []
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert regsrc == []


def test_sensor_without_bindsTo_does_not_create_trigger(client):
    """sensor с sourceKind='regulation' но без bindsTo — невалиден; триггера нет.

    Контракт: без bindsTo мы не знаем какой parameter этот триггер должен
    наполнять. Сохраняем flow.json (UX: пользователь ещё настраивает), но
    в DB не материализуем — чтобы reverse-lookup не показывал «фантомные»
    связи.
    """
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = {
        "rule_id": f"rule_{consumer}",
        "regulation_id": consumer,
        "nodes": [
            {"id": "n_in", "type": "input", "paramRef": "pressure"},
            {
                "id": "n_sensor",
                "type": "sensor",
                "sourceKind": "regulation",
                "sourceRegulationId": source,
                "sourceOutputAction": "x",
                # bindsTo пропущен
            },
        ],
        "edges": [],
    }
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert regsrc == []


def test_orphan_regulation_save_does_not_clobber_flow_triggers(client):
    """После save_flow → save регламента физический-триггер на другой param.

    Регрессионный кейс: regulation_store.save() в своей UPSERT-логике обходит
    reg.triggers и удаляет всё что туда не входит. Если фронт прислал regulation
    без regsource-триггеров (он их не редактировал во вкладке «Триггеры»), они
    могут быть удалены сразу после save. Проверяем: после reload regulation +
    save (без правок) regsource-триггеры выживают.
    """
    consumer = _create(client, name="Потребитель")
    source = _create(client, name="Источник")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id=source)
    client.put(f"/api/regulations/{consumer}/flow", json=flow)

    # Эмулируем «загрузил → сохранил без правок» (включая triggers).
    reg = client.get(f"/api/regulations/{consumer}").json()
    r = client.put(f"/api/regulations/{consumer}", json=reg)
    assert r.status_code == 200

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert len(regsrc) == 1, "regsource триггер не должен потеряться при безправочном save"


def test_unknown_source_regulation_still_creates_trigger(client):
    """Триггер на несуществующий source_regulation — создаётся, не падает.

    Это типично «сломанная ссылка»: источник был удалён, потребитель
    застрял со ссылкой. Backend сохраняет — UI рисует красный badge.
    Удалять триггер автоматически было бы потерей пользовательского ввода
    (он мог планировать восстановить источник).
    """
    consumer = _create(client, name="Потребитель")

    flow = _flow_with_regsource_sensor(reg_id=consumer, source_reg_id="ghost-regulation")
    r = client.put(f"/api/regulations/{consumer}/flow", json=flow)
    assert r.status_code == 200

    reg_after = client.get(f"/api/regulations/{consumer}").json()
    regsrc = [t for t in (reg_after.get("triggers") or []) if t.get("source_regulation")]
    assert len(regsrc) == 1
    assert regsrc[0]["source_regulation"] == "ghost-regulation"
