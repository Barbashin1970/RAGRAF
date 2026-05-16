"""Round-trip тесты SIGMA-bundle export / import.

Сценарий аналитика: правит регламент в RAGRAF → экспортирует bundle для
СИГМЫ → СИГМА что-то поправила → импортирует обратно. Должен получить
тот же регламент с теми же параметрами.
"""
from __future__ import annotations

import io
import json
import zipfile

import pytest

from app.schemas.domain import Parameter, Recommendation, Regulation
from app.services import sigma_export


@pytest.fixture
def heat_reg() -> Regulation:
    return Regulation(
        id="heat-inlet-breach",
        name="Регламент при прорыве теплового ввода",
        domain="heating",
        date="2024-09-10",
        version="1.0",
        status="active",
        source_document="СП 124.13330.2012",
        source_clause="§5.10",
        valid_from="2024-09-10",
        valid_to=None,
        parameters=[
            Parameter(
                id="pressure",
                name="pressure",
                datatype="decimal",
                referenceValue=20.5,
                deviationAllowed=1.5,
                unit="атм",
                minInclusive=0.0,
            ),
            Parameter(
                id="diameter",
                name="diameter",
                datatype="decimal",
                referenceValue=5.0,
                deviationAllowed=0.2,
                unit="см",
                minInclusive=0.0,
            ),
        ],
        constraints=[],
        recommendations=[
            Recommendation(
                id="rec1",
                text="Перекройте подачу, проверьте герметичность",
                priority=1,
                linkedParameters=["pressure", "diameter"],
            )
        ],
    )


async def test_build_bundle_has_data_shapes_and_manifest(store, heat_reg):
    """Smoke-проверка структуры bundle."""
    store.save(heat_reg)
    zip_bytes = await sigma_export.build_regulation_bundle("heat-inlet-breach")

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = {info.filename for info in zf.infolist()}
        assert "heat-inlet-breach/data.ttl" in names
        assert "heat-inlet-breach/shapes.ttl" in names
        assert "heat-inlet-breach/manifest.json" in names

        manifest = json.loads(zf.read("heat-inlet-breach/manifest.json"))
        assert manifest["source_id"] == "heat-inlet-breach"
        assert manifest["parameter_count"] == 2
        assert manifest["sigma_compliance"]["source_document"] == "СП 124.13330.2012"


async def test_round_trip_preserves_parameters(store, heat_reg):
    """Export → удалить из store → import → должны вернуться те же параметры."""
    store.save(heat_reg)
    zip_bytes = await sigma_export.build_regulation_bundle("heat-inlet-breach")

    # Удаляем регламент из локального store, чтобы импорт реально создавал заново.
    store.delete("heat-inlet-breach")
    assert store.get("heat-inlet-breach") is None

    report = await sigma_export.import_bundle(zip_bytes)
    assert report["total_failed"] == 0
    assert report["total_imported"] == 1
    assert report["imported"][0]["source_id"] == "heat-inlet-breach"

    restored = store.get("heat-inlet-breach")
    assert restored is not None
    assert restored.name == "Регламент при прорыве теплового ввода"
    assert len(restored.parameters) == 2

    by_name = {p.name: p for p in restored.parameters}
    assert by_name["pressure"].referenceValue == 20.5
    assert by_name["pressure"].deviationAllowed == 1.5
    assert by_name["diameter"].referenceValue == 5.0


async def test_corpus_bundle_round_trip(store, heat_reg):
    """Corpus-bundle (несколько регламентов в одном ZIP) импортируется корректно.

    Не проверяем точное количество (store засеян фикстурами), но требуем что:
      - в bundle попали оба сохранённых нами регламента
      - corpus_manifest.json лежит на корне
      - после re-import оба восстановились из ZIP
    """
    other = heat_reg.model_copy(update={"id": "second-reg", "name": "Второй регламент"})
    store.save(heat_reg)
    store.save(other)

    zip_bytes, _manifest = await sigma_export.build_corpus_bundle()

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = {i.filename for i in zf.infolist()}
        assert "corpus_manifest.json" in names
        assert "heat-inlet-breach/data.ttl" in names
        assert "second-reg/data.ttl" in names

    store.delete("heat-inlet-breach")
    store.delete("second-reg")
    assert store.get("heat-inlet-breach") is None
    assert store.get("second-reg") is None

    report = await sigma_export.import_bundle(zip_bytes)
    imported_ids = {r["source_id"] for r in report["imported"]}
    assert "heat-inlet-breach" in imported_ids
    assert "second-reg" in imported_ids
    assert report["total_failed"] == 0

    assert store.get("heat-inlet-breach") is not None
    assert store.get("second-reg") is not None


async def test_import_rejects_zip_without_data_ttl(store):
    """ZIP без data.ttl должен попасть в skipped, не валить весь импорт."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("garbage/shapes.ttl", "@prefix sh: <http://www.w3.org/ns/shacl#> .")

    report = await sigma_export.import_bundle(buf.getvalue())
    assert report["total_imported"] == 0
    assert report["total_skipped"] == 1
    assert report["skipped"][0]["reason"] == "missing data.ttl"


async def test_every_seeded_regulation_has_validation_shape(store):
    """Гарантия из ТЗ СИГМА §4.1.3 + Rules-Management.pdf: у любого регламента
    из store должна быть `:RegulationShape` с обязательными свойствами и
    типизацией параметров. Иначе СИГМА не сможет валидировать data.ttl.

    Проверяем все seed-фикстуры — каждая должна экспортироваться в bundle
    с непустым shapes.ttl содержащим RegulationShape и хотя бы 1 sh:property.
    """
    from app.services.regulation_client import client
    from app.services.turtle_bridge import parse_shapes_turtle

    items = store.list_all()
    assert len(items) > 0, "Store должен быть засеян фикстурами для этого теста"

    for it in items:
        sid = it["id"]
        shapes = await client.get_shapes(sid)
        assert shapes.strip(), f"У регламента {sid} пустые shapes — нарушение ТЗ СИГМА"
        # Парсится и содержит хотя бы 1 constraint
        constraints = parse_shapes_turtle(shapes)
        assert len(constraints) >= 1, f"У {sid} нет ни одного sh:property"
        # И в bundle оно попадает
        zip_bytes = await sigma_export.build_regulation_bundle(sid)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            ttl = zf.read(f"{sid}/shapes.ttl").decode()
            assert "RegulationShape" in ttl or "NodeShape" in ttl
            assert "sh:property" in ttl


async def test_bundle_export_uses_real_shapes_when_available(store, heat_reg, monkeypatch):
    """Если upstream/fixture отдаёт SHACL — он попадает в bundle as-is.

    Это и есть смысл фикса: пользовательские правки в «Ограничения» больше
    не подменяются голым derived-шаблоном.
    """
    store.save(heat_reg)

    custom_shapes = """@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix : <http://regulations.local/ontology#> .

:CustomShape a sh:NodeShape ;
    sh:targetClass :Regulation ;
    sh:property [
        sh:path :pressure ;
        sh:datatype xsd:decimal ;
        sh:minInclusive 5.0 ;
        sh:maxInclusive 50.0 ;
        sh:message "Custom pressure constraint"@ru ;
    ] .
"""

    async def fake_get_shapes(self, source_id):
        return custom_shapes

    from app.services.regulation_client import RegulationClient
    monkeypatch.setattr(RegulationClient, "get_shapes", fake_get_shapes)

    zip_bytes = await sigma_export.build_regulation_bundle("heat-inlet-breach")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        shapes = zf.read("heat-inlet-breach/shapes.ttl").decode()
        assert "Custom pressure constraint" in shapes
        assert "sh:minInclusive 5.0" in shapes or "sh:minInclusive 5" in shapes
