"""Граничные тесты Twin.wiring — где живут баги.

Покрываем кейсы которые «нормальные» тесты не ловят:
  • wiring ссылается на регламент НЕ из состава Twin'а
  • target_regulation == source_regulation (само-ссылка, цикл)
  • два wiring-entry на одну пару (target_reg, target_param) внутри Twin'а
  • удалили регламент из состава, но wiring на него остался
  • target_param_ref несуществующий параметр в target
  • partial wiring (пустые строки)
  • bilateral wiring A→B + B→A (две стороны цепочки в одном Twin'е)
  • mass save / unicode names

Если тест красный — это сигнал «надо добавить валидацию».
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(isolated_data_dir):
    from app.main import app
    with TestClient(app) as c:
        yield c


def _create_reg(client, *, domain: str = "heating", name: str = "R") -> str:
    r = client.post("/api/regulations", json={"domain": domain, "name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _flow_with_input(client, reg_id: str, param_ref: str) -> None:
    flow = {
        "rule_id": f"rule_{reg_id}",
        "regulation_id": reg_id,
        "nodes": [{"id": "n_in", "type": "input", "paramRef": param_ref, "label": param_ref}],
        "edges": [],
    }
    r = client.put(f"/api/regulations/{reg_id}/flow", json=flow)
    assert r.status_code == 200, r.text


def _post_twin(client, **kw) -> tuple[int, dict]:
    """POST /api/processes — возвращает (status, body) без assert внутри.

    Используется в тестах которые ожидают 4xx.
    """
    body = {"id": "", "name": kw.get("name", "T"), "description": None,
            "regulation_ids": kw.get("regulation_ids", []),
            "wiring": kw.get("wiring", [])}
    r = client.post("/api/processes", json=body)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"text": r.text}


# ── source/target не в составе Twin'а ──────────────────────────────────


def test_wiring_target_not_in_members_rejected(client):
    """target_regulation должен быть в regulation_ids двойника."""
    a = _create_reg(client, name="Внутри")
    outsider = _create_reg(client, name="Снаружи")
    _flow_with_input(client, outsider, "pressure")

    status, _ = _post_twin(client,
        name="t",
        regulation_ids=[a],  # outsider не в составе
        wiring=[{
            "target_regulation": outsider,
            "target_param_ref": "pressure",
            "source_regulation": a,
            "source_output": None,
        }],
    )
    assert status == 400, "wiring на регламент вне состава должен 400"


def test_wiring_source_not_in_members_rejected(client):
    """source_regulation должен быть в regulation_ids двойника."""
    a = _create_reg(client, name="Цель")
    outsider = _create_reg(client, name="Снаружи")
    _flow_with_input(client, a, "pressure")

    status, _ = _post_twin(client,
        regulation_ids=[a],
        wiring=[{
            "target_regulation": a,
            "target_param_ref": "pressure",
            "source_regulation": outsider,
            "source_output": None,
        }],
    )
    assert status == 400


def test_wiring_self_reference_rejected(client):
    """target_regulation == source_regulation — само-ссылка, нет смысла."""
    a = _create_reg(client, name="Сам")
    _flow_with_input(client, a, "pressure")
    status, _ = _post_twin(client,
        regulation_ids=[a],
        wiring=[{
            "target_regulation": a,
            "target_param_ref": "pressure",
            "source_regulation": a,
            "source_output": None,
        }],
    )
    assert status == 400


def test_wiring_duplicate_target_same_twin_rejected(client):
    """Две записи на (target_reg, target_param) внутри одного Twin'а — 400."""
    a = _create_reg(client, name="A")
    b1 = _create_reg(client, name="B1")
    b2 = _create_reg(client, name="B2")
    _flow_with_input(client, a, "pressure")
    status, _ = _post_twin(client,
        regulation_ids=[a, b1, b2],
        wiring=[
            {"target_regulation": a, "target_param_ref": "pressure",
             "source_regulation": b1, "source_output": None},
            {"target_regulation": a, "target_param_ref": "pressure",
             "source_regulation": b2, "source_output": None},
        ],
    )
    assert status == 400


def test_wiring_empty_strings_rejected(client):
    """Пустые строки в обязательных полях — 400 (а не «тихо проглатываем»)."""
    a = _create_reg(client, name="A")
    status, _ = _post_twin(client,
        regulation_ids=[a],
        wiring=[{
            "target_regulation": "",
            "target_param_ref": "",
            "source_regulation": "",
            "source_output": None,
        }],
    )
    assert status == 400


# ── Удаление регламента из состава ─────────────────────────────────────


def test_remove_member_with_wiring_cleans_wiring(client):
    """Если убрали регламент из состава — wiring-записи на него тоже удаляются.

    Иначе Twin содержит «висящие» ссылки, project_wiring записывает в
    регламент-сирота, путаница.
    """
    a = _create_reg(client, name="Цель")
    b = _create_reg(client, name="Источник")
    _flow_with_input(client, a, "pressure")
    twin = client.post("/api/processes", json={
        "id": "", "name": "t", "description": None,
        "regulation_ids": [a, b],
        "wiring": [{"target_regulation": a, "target_param_ref": "pressure",
                    "source_regulation": b, "source_output": None}],
    }).json()

    # Убираем источник из состава, wiring оставляем как есть.
    twin["regulation_ids"] = [a]
    r = client.put(f"/api/processes/{twin['id']}", json=twin)
    # Принимаем оба варианта: 200 с автоочисткой wiring или 400.
    # Бизнес-правило: «удалили из состава — wiring снимается».
    if r.status_code == 200:
        fresh = client.get(f"/api/processes/{twin['id']}").json()
        # Wiring должен быть пуст — источник снят.
        assert fresh["wiring"] == [], (
            "При удалении источника из состава wiring на него должен очищаться"
        )
    else:
        assert r.status_code == 400


# ── Bilateral wiring (двусторонняя цепочка) ───────────────────────────


def test_bilateral_wiring_a_b_and_b_a(client):
    """A.pressure ← B и B.flow ← A — допустимо если параметры разные."""
    a = _create_reg(client, name="A")
    b = _create_reg(client, name="B")
    _flow_with_input(client, a, "pressure")
    _flow_with_input(client, b, "flow")

    status, body = _post_twin(client,
        regulation_ids=[a, b],
        wiring=[
            {"target_regulation": a, "target_param_ref": "pressure",
             "source_regulation": b, "source_output": "verdict_b"},
            {"target_regulation": b, "target_param_ref": "flow",
             "source_regulation": a, "source_output": "verdict_a"},
        ],
    )
    # Bilateral допустим (это «обратная связь» — реальный сценарий теплосети).
    assert status == 201, body
    assert len(body["wiring"]) == 2


# ── Update Twin: меняем wiring + regulation_ids одновременно ──────────


def test_update_twin_replaces_wiring_and_members_together(client):
    """Можно одним save'ом поменять и состав и wiring (без 409 на собственное wiring)."""
    a = _create_reg(client, name="A")
    b = _create_reg(client, name="B")
    c = _create_reg(client, name="C")
    _flow_with_input(client, a, "pressure")

    twin = client.post("/api/processes", json={
        "id": "", "name": "t", "description": None,
        "regulation_ids": [a, b],
        "wiring": [{"target_regulation": a, "target_param_ref": "pressure",
                    "source_regulation": b, "source_output": None}],
    }).json()

    # Заменяем источник на C: добавляем C в состав + обновляем wiring.
    twin["regulation_ids"] = [a, c]
    twin["wiring"] = [{
        "target_regulation": a, "target_param_ref": "pressure",
        "source_regulation": c, "source_output": "v",
    }]
    r = client.put(f"/api/processes/{twin['id']}", json=twin)
    assert r.status_code == 200, r.text
    fresh = client.get(f"/api/processes/{twin['id']}").json()
    assert fresh["wiring"][0]["source_regulation"] == c


# ── Twin без регламентов с wiring ───────────────────────────────────────


def test_empty_twin_with_wiring_rejected(client):
    """Twin без regulation_ids но с wiring — нелогично, должно 400."""
    a = _create_reg(client, name="A")
    status, _ = _post_twin(client,
        regulation_ids=[],
        wiring=[{"target_regulation": a, "target_param_ref": "x",
                 "source_regulation": a, "source_output": None}],
    )
    assert status == 400


# ── Projection: target без flow.json ──────────────────────────────────


def test_projection_creates_minimal_flow_for_target_without_flow(client):
    """target.flow.json не существует — projection создаёт минимальный flow."""
    a = _create_reg(client, name="БезFlow")
    b = _create_reg(client, name="Источник")
    # НЕ вызываем _flow_with_input(a) — flow для a не создан явно.
    # POST regulation создаёт стартовый flow по шаблону, но он может не
    # содержать input с param_ref="custom_param". Используем имя из шаблона.
    reg_a = client.get(f"/api/regulations/{a}").json()
    assert reg_a["parameters"], "default template должен дать параметры"
    target_param = reg_a["parameters"][0]["id"]

    twin = client.post("/api/processes", json={
        "id": "", "name": "t", "description": None,
        "regulation_ids": [a, b],
        "wiring": [{"target_regulation": a, "target_param_ref": target_param,
                    "source_regulation": b, "source_output": None}],
    })
    assert twin.status_code == 201, twin.text

    # Flow стал доступен с regsource sensor.
    flow = client.get(f"/api/regulations/{a}/flow").json()
    regsource_sensors = [
        n for n in flow["nodes"]
        if n["type"] == "sensor" and (n.get("sourceKind") or "sensor") == "regulation"
    ]
    assert len(regsource_sensors) >= 1


# ── Unicode и спецсимволы ──────────────────────────────────────────────


def test_twin_name_unicode_persists(client):
    a = _create_reg(client, name="Регламент с тире и emoji 🛡")
    twin = client.post("/api/processes", json={
        "id": "", "name": "Двойник «Спецсимволы» №42",
        "description": "Тестируем — русский, ёлочка, кавычки, emoji 🔥",
        "regulation_ids": [a], "wiring": [],
    })
    assert twin.status_code == 201, twin.text
    fresh = client.get(f"/api/processes/{twin.json()['id']}").json()
    assert "Спецсимволы" in fresh["name"]
    assert "🔥" in (fresh["description"] or "")


# ── Migration idempotency ──────────────────────────────────────────────


def test_clear_regsource_migration_idempotent_on_clean_db(isolated_data_dir):
    """Миграция clear_regsource_to_twin_v1 не падает на пустой БД и не запускается дважды."""
    from app.services import regulation_store
    regulation_store.init_db()  # первый запуск — миграция применится
    # второй вызов — миграция помечена applied, не должна повторяться
    regulation_store.init_db()
    # Если повторно запустилась без ошибки — тест прошёл.


# ── Projection edge: missing input node ────────────────────────────────


def test_projection_creates_input_node_if_missing(client):
    """target_param_ref ещё не имеет input-ноды в flow → projection её создаёт."""
    a = _create_reg(client, name="ПустойFlow", domain="heating")
    b = _create_reg(client, name="Источник")
    # Стираем flow у a (записываем пустой).
    client.put(f"/api/regulations/{a}/flow", json={
        "rule_id": f"rule_{a}", "regulation_id": a, "nodes": [], "edges": [],
    })

    twin = client.post("/api/processes", json={
        "id": "", "name": "t", "description": None,
        "regulation_ids": [a, b],
        "wiring": [{"target_regulation": a, "target_param_ref": "ghost_param",
                    "source_regulation": b, "source_output": None}],
    })
    assert twin.status_code == 201, twin.text

    flow = client.get(f"/api/regulations/{a}/flow").json()
    inputs = [n for n in flow["nodes"] if n["type"] == "input"
              and n.get("paramRef") == "ghost_param"]
    assert len(inputs) == 1, "projection должна была создать input для ghost_param"
    sensors = [n for n in flow["nodes"] if n["type"] == "sensor"
               and (n.get("sourceKind") or "sensor") == "regulation"]
    assert len(sensors) == 1
    assert sensors[0]["bindsTo"] == inputs[0]["id"]
