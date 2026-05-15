"""CRUD-тесты DuckDB store. Защищают от регрессии в init/save/history/restore."""
from __future__ import annotations

import copy

from app.schemas.domain import Parameter, Regulation


def test_init_seeds_six_fixtures(store):
    items = store.list_all()
    ids = {r["id"] for r in items}
    # 6 фикстур из 4 доменов
    assert "pressure-diameter" in ids
    assert "roof-snow-fencing" in ids
    assert "thermal-incident-server" in ids
    assert "air-quality-smog-trap" in ids
    assert len(items) >= 6


def test_get_returns_full_regulation(store):
    reg = store.get("pressure-diameter")
    assert reg is not None
    assert reg.domain == "heating"
    assert len(reg.parameters) == 2
    assert reg.parameters[0].name in ("pressure", "diameter")


def test_save_then_get_roundtrip(store, sample_regulation):
    store.save(sample_regulation, comment="initial")
    reg = store.get("test-reg")
    assert reg.name == sample_regulation.name
    assert reg.parameters[0].referenceValue == 20.5


def test_save_replaces_parameters(store, sample_regulation):
    store.save(sample_regulation, comment="v1")
    modified = copy.deepcopy(sample_regulation)
    modified.parameters = modified.parameters[:1]  # удаляем второй
    store.save(modified, comment="v2")
    after = store.get("test-reg")
    assert len(after.parameters) == 1


def test_save_creates_history_snapshot(store, sample_regulation):
    store.save(sample_regulation, comment="first")
    hist = store.history("test-reg")
    assert len(hist) == 1
    assert hist[0]["comment"] == "first"
    # initial version — без diff
    assert hist[0]["diff_counts"].get("initial", 0) == 1


def test_history_includes_diff_summary(store, sample_regulation):
    store.save(sample_regulation, comment="v1")
    modified = copy.deepcopy(sample_regulation)
    modified.parameters[0].referenceValue = 25.0
    store.save(modified, comment="v2")
    hist = store.history("test-reg")
    assert len(hist) == 2
    # самая свежая идёт первой
    latest = hist[0]
    assert "25.0" in latest["diff_summary"] or "pressure" in latest["diff_summary"]
    assert latest["diff_counts"]["changed"] >= 1


def test_restore_creates_new_version(store, sample_regulation):
    store.save(sample_regulation, comment="v1")
    modified = copy.deepcopy(sample_regulation)
    modified.parameters[0].referenceValue = 99.0
    store.save(modified, comment="v2-broken")
    # восстанавливаем v1
    hist = store.history("test-reg")
    v1_id = hist[-1]["version_id"]  # самая старая
    restored = store.restore("test-reg", v1_id)
    assert restored is not None
    assert restored.parameters[0].referenceValue == 20.5
    # после restore должен быть третий snapshot
    new_hist = store.history("test-reg")
    assert len(new_hist) == 3


def test_get_unknown_returns_none(store):
    assert store.get("no-such-regulation") is None


def test_prev_snapshot_lookup(store, sample_regulation):
    store.save(sample_regulation, comment="v1")
    modified = copy.deepcopy(sample_regulation)
    modified.name = "Изменено"
    store.save(modified, comment="v2")
    hist = store.history("test-reg")
    latest_id = hist[0]["version_id"]
    prev = store.get_prev_snapshot("test-reg", latest_id)
    assert prev is not None
    assert prev["name"] == sample_regulation.name


def test_save_reconciles_flow_when_parameter_deleted(store, sample_regulation):
    """Удаление параметра в Form должно вычистить orphan-цепочку во Flow.

    Регрессия: Form и Flow могли расходиться (Form говорит «pressure удалён»,
    Flow Editor всё ещё показывает его input/threshold/compare).
    """
    from app.schemas.domain import FlowEdge, FlowNode, RuleDSL
    from app.services.flow_storage import load_flow, save_flow

    store.save(sample_regulation, comment="initial")

    # Создаём flow с двумя цепочками, share-узел n_output (incoming=2).
    flow = RuleDSL(
        rule_id="rule_test-reg",
        regulation_id="test-reg",
        nodes=[
            FlowNode(id="n_in_pressure", type="input", paramRef="pressure"),
            FlowNode(id="n_thr_pressure", type="threshold", refValue=20.5),
            FlowNode(id="n_cmp_pressure", type="compare", operator="outside_range"),
            FlowNode(id="n_in_diameter", type="input", paramRef="diameter"),
            FlowNode(id="n_thr_diameter", type="threshold", refValue=5.0),
            FlowNode(id="n_cmp_diameter", type="compare", operator="outside_range"),
            FlowNode(id="n_output", type="output", action="recommendation", text="Ок"),
        ],
        edges=[
            FlowEdge(source="n_in_pressure", target="n_thr_pressure"),
            FlowEdge(source="n_thr_pressure", target="n_cmp_pressure"),
            FlowEdge(source="n_cmp_pressure", target="n_output", condition="outside"),
            FlowEdge(source="n_in_diameter", target="n_thr_diameter"),
            FlowEdge(source="n_thr_diameter", target="n_cmp_diameter"),
            FlowEdge(source="n_cmp_diameter", target="n_output", condition="outside"),
        ],
    )
    save_flow("test-reg", flow, comment="seed")

    # Удаляем pressure через регламент → reconcile должен убрать только
    # цепочку pressure, оставить diameter и shared output.
    modified = copy.deepcopy(sample_regulation)
    modified.parameters = [p for p in modified.parameters if p.id != "pressure"]
    store.save(modified, comment="drop pressure")

    after = load_flow("test-reg")
    assert after is not None
    node_ids = {n.id for n in after.nodes}
    assert "n_in_pressure" not in node_ids
    assert "n_thr_pressure" not in node_ids
    assert "n_cmp_pressure" not in node_ids
    # diameter и shared output остались
    assert "n_in_diameter" in node_ids
    assert "n_output" in node_ids
    # Edge'и pressure тоже вычищены
    for e in after.edges:
        assert "pressure" not in e.source and "pressure" not in e.target


def test_save_does_not_touch_flow_without_orphans(store, sample_regulation):
    """Если все paramRef валидны, reconcile не меняет flow."""
    from app.schemas.domain import FlowEdge, FlowNode, RuleDSL
    from app.services.flow_storage import load_flow, save_flow

    store.save(sample_regulation, comment="initial")
    flow = RuleDSL(
        rule_id="rule_test-reg",
        regulation_id="test-reg",
        nodes=[
            FlowNode(id="n_in_pressure", type="input", paramRef="pressure"),
            FlowNode(id="n_output", type="output", action="recommendation", text="Ок"),
        ],
        edges=[FlowEdge(source="n_in_pressure", target="n_output")],
    )
    save_flow("test-reg", flow, comment="seed")

    store.save(sample_regulation, comment="resave")
    after = load_flow("test-reg")
    assert {n.id for n in after.nodes} == {"n_in_pressure", "n_output"}
