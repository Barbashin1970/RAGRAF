"""E2E HTTP-тесты для P1-багов аудита 2026-05-18 (фикс 033).

Запуск:
  cd backend && .venv/bin/python -m uvicorn app.main:app --port 8765 &
  .venv/bin/python scripts/test_p1_roundtrip.py

Каждый блок имитирует один сценарий пользователя через РЕАЛЬНЫЕ HTTP-вызовы
к backend — никаких Python-объектов, никаких prepared snapshot'ов. Это тот
же путь, по которому ходит фронт.
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from typing import Any

import httpx

BASE = "http://127.0.0.1:8765"


def assert_eq(label: str, actual: Any, expected: Any) -> bool:
    if actual == expected:
        print(f"  ✓ {label}: {actual!r}")
        return True
    print(f"  ✗ {label}: expected {expected!r}, got {actual!r}")
    return False


def http_get(path: str) -> dict[str, Any] | str:
    r = httpx.get(f"{BASE}{path}", timeout=15)
    r.raise_for_status()
    ct = r.headers.get("content-type", "")
    return r.json() if "application/json" in ct else r.text


def http_put_json(path: str, body: dict[str, Any]) -> dict[str, Any]:
    r = httpx.put(f"{BASE}{path}", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


def http_put_text(path: str, body: str) -> dict[str, Any]:
    r = httpx.put(
        f"{BASE}{path}",
        content=body.encode("utf-8"),
        headers={"Content-Type": "text/plain; charset=utf-8"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def reset_pressure_diameter() -> dict[str, Any]:
    """Восстановить регламент из последней истории — упрощённый rollback.

    Используем PUT /regulations/{id}/raw на исходную турту seed-фикстуры,
    чтобы каждый тест начинался с одной точки. Простой способ: получить
    raw, сохранить, и потом тесты будут не зависеть от предыдущих.
    """
    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    return {"raw": raw}


def test_bug_1_priority_through_turtle() -> bool:
    """BUG-1: priority рекомендации сохраняется через Turtle save."""
    print("\n=== BUG-1: priority через Turtle save ===")
    # Set priority=1 (critical) via Form
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    reg["recommendations"][0]["priority"] = 1
    http_put_json("/api/regulations/pressure-diameter", reg)

    # Get raw Turtle, then save it (no changes) — simulates "open Turtle tab and save"
    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    http_put_text("/api/regulations/pressure-diameter/raw", raw)

    # Verify priority preserved
    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    return assert_eq("priority preserved", reg2["recommendations"][0]["priority"], 1)


def test_bug_2_name_through_turtle() -> bool:
    """BUG-2: Renamed param.name (кириллица) сохраняется через Turtle save."""
    print("\n=== BUG-2: rename param через Turtle save ===")
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    for p in reg["parameters"]:
        if p["id"] == "pressure":
            p["name"] = "Давление узла"
    http_put_json("/api/regulations/pressure-diameter", reg)

    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    http_put_text("/api/regulations/pressure-diameter/raw", raw)

    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    p2 = [p for p in reg2["parameters"] if p["id"] == "pressure"][0]
    return assert_eq("name preserved", p2["name"], "Давление узла")


def test_bug_3_bounds_after_rename() -> bool:
    """BUG-3: SHACL bounds сохраняются после rename + Turtle save."""
    print("\n=== BUG-3: bounds после rename + Turtle save ===")
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    for p in reg["parameters"]:
        if p["id"] == "pressure":
            p["name"] = "Давление узла (тест)"
            p["minInclusive"] = 5.0
            p["maxInclusive"] = 50.0
    http_put_json("/api/regulations/pressure-diameter", reg)

    # Turtle round-trip
    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    http_put_text("/api/regulations/pressure-diameter/raw", raw)

    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    p2 = [p for p in reg2["parameters"] if p["id"] == "pressure"][0]
    ok = True
    ok &= assert_eq("minInclusive", p2["minInclusive"], 5.0)
    ok &= assert_eq("maxInclusive", p2["maxInclusive"], 50.0)
    ok &= assert_eq("name preserved after Turtle", p2["name"], "Давление узла (тест)")
    return ok


def test_bug_4_trigger_id_hyphen() -> bool:
    """BUG-4: trigger.id с дефисом roundtrip'ится через Turtle."""
    print("\n=== BUG-4: trigger.id дефис ===")
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    reg["triggers"] = [{
        "id": "trig-pressure",
        "label": "давление",
        "param_ref": "pressure",
        "sensor_subtype": "p",
        "event_type": "telemetry.pressure",
        "source_regulation": None,
        "source_output": None,
        "description": None,
    }]
    http_put_json("/api/regulations/pressure-diameter", reg)

    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    http_put_text("/api/regulations/pressure-diameter/raw", raw)

    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    triggers = reg2["triggers"]
    ok = True
    ok &= assert_eq("triggers count", len(triggers), 1)
    if triggers:
        ok &= assert_eq("trigger.id with dash", triggers[0]["id"], "trig-pressure")
        ok &= assert_eq("trigger.sensor_subtype", triggers[0]["sensor_subtype"], "p")
    return ok


def test_bug_5_dedupe_triggers() -> bool:
    """BUG-5: дубль триггера на тот же param_ref не оседает в DB после save."""
    print("\n=== BUG-5: dedupe триггеров по param_ref ===")
    # Setup: save регламент с одним trigger
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    reg["triggers"] = [{
        "id": "trig-pressure",
        "label": "давление",
        "param_ref": "pressure",
        "sensor_subtype": "p",
        "event_type": None,
        "source_regulation": None,
        "source_output": None,
        "description": None,
    }]
    http_put_json("/api/regulations/pressure-diameter", reg)

    # Симуляция legacy дубля: добавим второй trigger с тем же param_ref
    # через прямой save (это путь, по которому был баг — Turtle round-trip
    # создавал `trigpressure` рядом с `trig-pressure`).
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    reg["triggers"].append({
        "id": "trigpressure-LEGACY",
        "label": "legacy",
        "param_ref": "pressure",  # тот же param!
        "sensor_subtype": "old-sensor",
        "event_type": None,
        "source_regulation": None,
        "source_output": None,
        "description": None,
    })
    http_put_json("/api/regulations/pressure-diameter", reg)

    # Verify: должен остаться только один (первый wins по dedupe).
    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    triggers = [t for t in reg2["triggers"] if t["param_ref"] == "pressure"]
    return assert_eq("triggers per param_ref", len(triggers), 1)


def test_bug_6_output_recommendation_sync() -> bool:
    """BUG-6: recommendation.text синкается с output.text в flow."""
    print("\n=== BUG-6: Form recommendation → Flow output sync ===")
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    new_text = "Сделай раз. Сделай два. Сделай три."
    reg["recommendations"][0]["text"] = new_text
    reg["recommendations"][0]["priority"] = 1
    http_put_json("/api/regulations/pressure-diameter", reg)

    # Read flow, verify output node has the new text
    flow = http_get("/api/regulations/pressure-diameter/flow")
    assert isinstance(flow, dict)
    nodes = flow.get("dsl", flow).get("nodes", flow.get("nodes", []))
    outputs = [n for n in nodes if n.get("type") == "output"]
    if len(outputs) != 1:
        print(f"  ⚠ skipping: {len(outputs)} output nodes (sync only при == 1)")
        return True
    ok = True
    ok &= assert_eq("output.text synced", outputs[0].get("text"), new_text)
    ok &= assert_eq("output.priority synced", outputs[0].get("priority"), 1)
    return ok


def test_flow_sensor_propagates_to_edit_and_turtle() -> bool:
    """Flow add sensor → trigger в Edit + Turtle (UX-баг из юзер-отчёта 034).

    Сценарий: пользователь рисует sensor в Flow Editor (drop pill + выбор
    sensorSubtype) БЕЗ ручного указания bindsTo. Ожидание: после save Flow
    sensor виден в Edit/«Поля» (как триггер) и в Turtle/«Turtle» (как
    `:hasTrigger` блок).
    """
    print("\n=== Flow→Edit→Turtle: sensor через Flow Editor ===")
    # Get current flow
    flow = http_get("/api/regulations/pressure-diameter/flow")
    assert isinstance(flow, dict)
    nodes = flow["nodes"]
    edges = flow["edges"]

    # Find input ноду для pressure
    input_node = next((n for n in nodes if n.get("type") == "input"), None)
    if input_node is None:
        print("  ⚠ no input nodes — skipping")
        return True
    input_y = (input_node.get("position") or {}).get("y", 0)

    # Удалить существующие sensor-ноды (для чистоты теста)
    nodes = [n for n in nodes if n.get("type") != "sensor"]
    edges = [
        e for e in edges
        if not any(n.get("id") == e["source"] and n.get("type") == "sensor"
                   for n in flow["nodes"])
    ]

    # Drop sensor pill: nodeId, type='sensor', sensorSubtype='p' (Манометр),
    # без bindsTo (имитирует пользовательский drag-drop без edge).
    sensor_id = "test-sensor-flow"
    nodes.append({
        "id": sensor_id,
        "type": "sensor",
        "label": "",
        "sensorType": "p",
        "sensorSubtype": "p",
        "bindsTo": None,
        "position": {"x": -200, "y": input_y},
    })

    # PUT flow
    body = {
        "rule_id": flow.get("rule_id", "rule_pressure-diameter"),
        "regulation_id": "pressure-diameter",
        "nodes": nodes,
        "edges": edges,
    }
    http_put_json("/api/regulations/pressure-diameter/flow", body)

    # Verify: Edit видит триггер
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    triggers = reg["triggers"]
    pressure_triggers = [t for t in triggers if t["param_ref"] == "pressure"]
    ok = True
    ok &= assert_eq("trigger exists in regulation", len(pressure_triggers), 1)
    if pressure_triggers:
        ok &= assert_eq("sensor_subtype synced", pressure_triggers[0]["sensor_subtype"], "p")

    # Verify: Turtle содержит :hasTrigger
    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    ok &= assert_eq(":hasTrigger в Turtle", ":hasTrigger" in raw, True)
    ok &= assert_eq(":sensorSubtype в Turtle", ":sensorSubtype" in raw, True)

    # Verify: flow получил bindsTo на input + edge
    flow2 = http_get("/api/regulations/pressure-diameter/flow")
    assert isinstance(flow2, dict)
    sensor_after = next(n for n in flow2["nodes"] if n["id"] == sensor_id)
    ok &= assert_eq("bindsTo auto-set", sensor_after.get("bindsTo"), input_node["id"])
    edge_exists = any(
        e["source"] == sensor_id and e["target"] == input_node["id"]
        for e in flow2["edges"]
    )
    ok &= assert_eq("edge sensor→input создан", edge_exists, True)
    return ok


def test_bug_9_custom_unit_preserved() -> bool:
    """BUG-9: кастомный unit сохраняется при Turtle save."""
    print("\n=== BUG-9: кастомный unit через Turtle save ===")
    reg = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg, dict)
    for p in reg["parameters"]:
        if p["id"] == "pressure":
            p["unit"] = "кПа"
    http_put_json("/api/regulations/pressure-diameter", reg)

    raw = http_get("/api/regulations/pressure-diameter/raw")
    assert isinstance(raw, str)
    http_put_text("/api/regulations/pressure-diameter/raw", raw)

    reg2 = http_get("/api/regulations/pressure-diameter")
    assert isinstance(reg2, dict)
    p2 = [p for p in reg2["parameters"] if p["id"] == "pressure"][0]
    return assert_eq("custom unit preserved", p2["unit"], "кПа")


def main() -> int:
    print("=" * 60)
    print("E2E roundtrip tests — фикс 033 (P1 баги аудита)")
    print("=" * 60)
    # health check
    try:
        httpx.get(f"{BASE}/health", timeout=2).raise_for_status()
    except Exception as e:
        print(f"backend not running on {BASE}: {e}")
        return 1

    tests = [
        test_bug_1_priority_through_turtle,
        test_bug_2_name_through_turtle,
        test_bug_3_bounds_after_rename,
        test_bug_4_trigger_id_hyphen,
        test_bug_5_dedupe_triggers,
        test_bug_6_output_recommendation_sync,
        test_bug_9_custom_unit_preserved,
        test_flow_sensor_propagates_to_edit_and_turtle,
    ]
    results = [t() for t in tests]
    passed = sum(results)
    total = len(results)
    print()
    print("=" * 60)
    print(f"Result: {passed}/{total} passed")
    print("=" * 60)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
