"""Domain ↔ RDF/Turtle conversion.

Upstream хранит регламенты как сырой Turtle. На примере Rules-Management.pdf
схема такая (default-namespace `<http://regulations.local/ontology#>`):

    :Regulation a owl:Class .
    :pressure          a owl:DatatypeProperty ; rdfs:range xsd:decimal .
    :pressureDeviation a owl:DatatypeProperty ; rdfs:range xsd:decimal .
    :diameter ... :diameterDeviation ... :name ... :date ... :recommendation ...

    :PressureAndDiameterRegulation
        a                  :Regulation ;
        :name              "..." ;
        :date              "2023-10-01"^^xsd:date ;
        :pressure          20.5 ;
        :pressureDeviation 1.5 ;
        :diameter          5.0 ;
        :diameterDeviation 0.2 ;
        :recommendation    "..." .

Параметры — плоские scalar-свойства регламента (не отдельные сущности :Parameter).
Деффолтное значение `referenceValue` = scalar value, `deviationAllowed` —
сопряжённое свойство `<param>Deviation`. SHACL-форма (отдельный документ) даёт
`minInclusive`/`maxInclusive`/`minCount` через `sh:path :pressure`.
"""
from __future__ import annotations

import uuid

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import OWL, RDF, SH, XSD

from app.schemas.domain import Constraint, Parameter, Recommendation, Regulation

REG = Namespace("http://regulations.local/ontology#")

# Юнит-маппинг параметров (UI hint). Источник — Rules-Management.pdf:
#   "номинальный диаметр составляет 5.0 см", "давление … 20.5 атм".
PARAM_UNITS: dict[str, str] = {
    # pressure-diameter / heat-inlet-breach
    "pressure": "атм",
    "diameter": "см",
    "inletPressure": "атм",
    "inletTemperature": "°C",
    "pressureFallRate": "атм/мин",
    "walkerConfirmTime": "мин",
    "medicalAlertWindow": "мин",
    # generic / temperature
    "temperature": "°C",
    "temperatureRiseRate": "°C/ч",
    # roof-snow-fencing
    "snowDepth": "см",
    "iceLength": "см",
    "smsLeadHours": "ч",
    # thermal-incident-server
    "serverTemperature": "°C",
    "smokeConcentration": "ppm",
    "coolingFlowRate": "м³/ч",
    "confirmTimeMinutes": "мин",
    "escalationTimeMinutes": "мин",
    # dormitory-flood
    "waterLevel": "см",
    "stackFlowRate": "м³/ч",
    "nightModeStart": "ч",
    "commandantArrivalTime": "мин",
    "evacuationThresholdLevel": "см",
    # air-quality-smog-trap (environment)
    "windSpeed": "м/с",
    "pm25Concentration": "мкг/м³",
    "pm10Concentration": "мкг/м³",
    "pdkExceedanceHours": "ч/сутки",
    "notificationLeadHours": "ч",
    "emissionReductionPercent": "%",
    # generic catch-all
    "flow": "м³/ч",
    "voltage": "В",
    "current": "А",
}

# Свойства, которые относятся к самому регламенту, а не к параметрам
META_PROPS = {"name", "date", "recommendation", "version", "status"}


# ---- Serializers ------------------------------------------------------


def constraint_to_shacl_graph(constraint: Constraint) -> Graph:
    """Build a SHACL NodeShape for a single Constraint."""
    g = Graph()
    g.bind("sh", SH)
    g.bind("xsd", XSD)
    g.bind("reg", REG)

    shape = REG[f"Shape_{constraint.id}"]
    prop = REG[f"Prop_{constraint.id}"]

    g.add((shape, RDF.type, SH.NodeShape))
    g.add((shape, SH.targetClass, REG[constraint.targetClass]))
    g.add((shape, SH.property, prop))
    g.add((prop, SH.path, REG[constraint.path]))

    if constraint.datatype:
        g.add((prop, SH.datatype, XSD[constraint.datatype]))
    if constraint.minCount is not None:
        g.add((prop, SH.minCount, Literal(constraint.minCount, datatype=XSD.integer)))
    if constraint.maxCount is not None:
        g.add((prop, SH.maxCount, Literal(constraint.maxCount, datatype=XSD.integer)))
    if constraint.minInclusive is not None:
        g.add((prop, SH.minInclusive, Literal(constraint.minInclusive, datatype=XSD.decimal)))
    if constraint.maxInclusive is not None:
        g.add((prop, SH.maxInclusive, Literal(constraint.maxInclusive, datatype=XSD.decimal)))
    if constraint.pattern:
        g.add((prop, SH.pattern, Literal(constraint.pattern)))
    if constraint.message:
        g.add((prop, SH.message, Literal(constraint.message, lang="ru")))

    sev_map = {"violation": SH.Violation, "warning": SH.Warning, "info": SH.Info}
    g.add((prop, SH.severity, sev_map.get(constraint.severity, SH.Violation)))

    return g


def constraints_to_shacl_turtle(constraints: list[Constraint]) -> str:
    g = Graph()
    g.bind("sh", SH)
    g.bind("xsd", XSD)
    g.bind("reg", REG)
    for c in constraints:
        for triple in constraint_to_shacl_graph(c):
            g.add(triple)
    return g.serialize(format="turtle")


# ---- Regulation domain → Turtle (writeback) ---------------------------


def regulation_to_turtle(reg: Regulation) -> str:
    """Сериализовать `Regulation` обратно в Turtle, как в фикстурах.

    Формат повторяет онтологию из Rules-Management.pdf: для каждого параметра
    объявляем `owl:DatatypeProperty` + парное `<name>Deviation`, далее
    экземпляр `:<Name>Regulation` с плоскими scalar-свойствами.

    Идентификатор инстанса берём из `reg.id` — преобразуем в PascalCase,
    добавляем суффикс `Regulation`. Это даёт стабильный URI при редактировании.
    """
    from rdflib import Graph, Literal, Namespace
    from rdflib.namespace import OWL, RDF, RDFS, XSD

    g = Graph()
    REG_NS = Namespace("http://regulations.local/ontology#")
    g.bind("", REG_NS)
    g.bind("owl", OWL)
    g.bind("rdf", RDF)
    g.bind("rdfs", RDFS)
    g.bind("xsd", XSD)

    REG_CLASS = REG_NS["Regulation"]
    g.add((REG_CLASS, RDF.type, OWL.Class))

    # Стандартные мета-свойства. SIGMA-compliance поля (sourceDocument,
    # sourceClause, validFrom, validTo) — из ТЗ СИГМА §4.1.3: «каждое правило
    # должно быть связано с источником (нормативный акт + пункт), периодом
    # действия и историей изменений». Сериализуются всегда (чтобы shapes.ttl
    # их валидировал), значения проставляются только если в DuckDB есть.
    for prop_name, rng in (
        ("name", XSD.string),
        ("date", XSD.date),
        ("recommendation", XSD.string),
        ("sourceDocument", XSD.string),
        ("sourceClause", XSD.string),
        ("validFrom", XSD.date),
        ("validTo", XSD.date),
    ):
        pred = REG_NS[prop_name]
        g.add((pred, RDF.type, OWL.DatatypeProperty))
        g.add((pred, RDFS.domain, REG_CLASS))
        g.add((pred, RDFS.range, rng))

    # Параметры и их *Deviation — оба decimal
    for p in reg.parameters:
        for nm in (p.name, f"{p.name}Deviation"):
            pred = REG_NS[nm]
            g.add((pred, RDF.type, OWL.DatatypeProperty))
            g.add((pred, RDFS.domain, REG_CLASS))
            g.add((pred, RDFS.range, XSD.decimal))

    instance = REG_NS[_instance_local_name(reg.id)]
    g.add((instance, RDF.type, REG_CLASS))
    if reg.name:
        g.add((instance, REG_NS["name"], Literal(reg.name)))
    if reg.date:
        g.add((instance, REG_NS["date"], Literal(reg.date, datatype=XSD.date)))
    for p in reg.parameters:
        if p.referenceValue is not None:
            g.add((instance, REG_NS[p.name], Literal(float(p.referenceValue), datatype=XSD.decimal)))
        if p.deviationAllowed is not None:
            g.add(
                (
                    instance,
                    REG_NS[f"{p.name}Deviation"],
                    Literal(float(p.deviationAllowed), datatype=XSD.decimal),
                )
            )
    if reg.recommendations:
        text = reg.recommendations[0].text or ""
        if text:
            g.add((instance, REG_NS["recommendation"], Literal(text)))

    # SIGMA-compliance: source_document / source_clause / valid_from / valid_to.
    # Сериализуем только заполненные — иначе появятся пустые литералы которые
    # SHACL отвергнет как несоответствующие xsd:date/xsd:string.
    if reg.source_document:
        g.add((instance, REG_NS["sourceDocument"], Literal(reg.source_document)))
    if reg.source_clause:
        g.add((instance, REG_NS["sourceClause"], Literal(reg.source_clause)))
    if reg.valid_from:
        g.add((instance, REG_NS["validFrom"], Literal(reg.valid_from, datatype=XSD.date)))
    if reg.valid_to:
        g.add((instance, REG_NS["validTo"], Literal(reg.valid_to, datatype=XSD.date)))

    return g.serialize(format="turtle")


def regulation_to_shacl_shapes(reg: Regulation) -> str:
    """Сгенерировать SHACL-форму валидации для конкретного регламента.

    Аналог `<reg>.shapes.ttl` из СИГМЫ (см. Rules-Management.pdf). Форма
    декларирует обязательные поля и типы данных под текущий состав параметров
    регламента. Используется в bundle-экспорте — СИГМА при загрузке валидирует
    data.ttl против этой формы.
    """
    from rdflib import BNode, Graph, Literal, Namespace
    from rdflib.namespace import RDF, SH, XSD

    g = Graph()
    REG_NS = Namespace("http://regulations.local/ontology#")
    g.bind("", REG_NS)
    g.bind("sh", SH)
    g.bind("xsd", XSD)
    g.bind("rdf", RDF)

    shape_uri = REG_NS["RegulationShape"]
    g.add((shape_uri, RDF.type, SH.NodeShape))
    g.add((shape_uri, SH.targetClass, REG_NS["Regulation"]))

    def add_property(
        path: str,
        datatype,
        *,
        min_count: int = 1,
        min_inclusive: float | None = None,
    ) -> None:
        # Each property — отдельный анонимный BNode под sh:property.
        prop = BNode()
        g.add((shape_uri, SH.property, prop))
        g.add((prop, SH.path, REG_NS[path]))
        g.add((prop, SH.datatype, datatype))
        g.add((prop, SH.minCount, Literal(min_count)))
        if min_inclusive is not None:
            g.add((prop, SH.minInclusive, Literal(float(min_inclusive))))

    # Обязательные мета-поля. name + date — присутствуют всегда.
    add_property("name", XSD.string)
    add_property("date", XSD.date)
    # Recommendation: SIGMA в фикстуре делает обязательным; делаем тоже.
    add_property("recommendation", XSD.string)

    # SIGMA-compliance — по ТЗ §4.1.3 должны быть. Делаем «soft required»
    # (min_count=0) чтобы старые регламенты без этих полей не падали при
    # экспорте. Когда заполнено — валидация на datatype отработает.
    for path, dt in (
        ("sourceDocument", XSD.string),
        ("sourceClause", XSD.string),
        ("validFrom", XSD.date),
        ("validTo", XSD.date),
    ):
        add_property(path, dt, min_count=0)

    # Параметры: каждый — decimal с min_inclusive=0 (нет отрицательных давлений),
    # парный *Deviation тоже decimal ≥ 0. Reusing Rules-Management.pdf convention.
    for p in reg.parameters:
        add_property(p.name, XSD.decimal, min_inclusive=0.0)
        add_property(f"{p.name}Deviation", XSD.decimal, min_inclusive=0.0)

    return g.serialize(format="turtle")


def _instance_local_name(source_id: str) -> str:
    """source_id → PascalCase + 'Regulation'. `roof-snow-fencing` → `RoofSnowFencingRegulation`."""
    parts = [p for p in source_id.replace("_", "-").split("-") if p]
    pascal = "".join(p[:1].upper() + p[1:] for p in parts)
    if not pascal.endswith("Regulation"):
        pascal += "Regulation"
    return pascal


# ---- Parsers ----------------------------------------------------------


def parse_regulation_turtle(
    turtle: str,
    source_id: str,
    shapes_turtle: str = "",
) -> Regulation:
    """Парсит реальный Turtle регламента в `Regulation`.

    Args:
        turtle: текст с инстансом класса :Regulation
        source_id: ID для итогового Regulation.id
        shapes_turtle: опционально — SHACL shapes для подсасывания bounds в параметры

    Стратегия:
      1. Находим первый subject типа owl:Class :Regulation (или с типом, локальное имя
         которого = "Regulation").
      2. Собираем все его scalar datatype-свойства.
      3. Метапроперти (name, date, recommendation) идут в поля Regulation.
      4. Остальные числовые свойства считаем параметрами: имя = local name,
         referenceValue = значение. Если в графе есть `<name>Deviation` —
         используем как deviationAllowed.
      5. Если передан shapes_turtle — берём оттуда minInclusive/maxInclusive/minCount
         для каждого параметра.
    """
    g = Graph()
    if turtle.strip():
        try:
            g.parse(data=turtle, format="turtle")
        except Exception:
            return Regulation(id=source_id, name=source_id)

    # Найти инстанс типа :Regulation (по локальному имени класса)
    reg_subject: URIRef | None = None
    reg_class: URIRef | None = None
    for cls in g.subjects(RDF.type, OWL.Class):
        if _local_name(cls) == "Regulation":
            reg_class = cls  # type: ignore[assignment]
            break
    if reg_class is not None:
        for s in g.subjects(RDF.type, reg_class):
            reg_subject = s  # type: ignore[assignment]
            break
    # Fallback: любой subject с типом, локальное имя которого — "Regulation"
    if reg_subject is None:
        for s, _, o in g.triples((None, RDF.type, None)):
            if _local_name(o) == "Regulation":
                reg_subject = s  # type: ignore[assignment]
                break

    if reg_subject is None:
        return Regulation(id=source_id, name=source_id)

    # Группируем свойства по local name
    props: dict[str, str] = {}
    for _, p, o in g.triples((reg_subject, None, None)):
        if p == RDF.type:
            continue
        props[_local_name(p)] = str(o)

    # SHACL bounds (опционально)
    bounds_by_param: dict[str, dict] = _shacl_bounds_index(shapes_turtle)

    # Параметры — все числовые scalar-свойства, кроме метапропертей и кроме *Deviation
    parameters: list[Parameter] = []
    deviation_keys = {k for k in props if k.endswith("Deviation")}
    for key, raw in props.items():
        if key in META_PROPS or key in deviation_keys:
            continue
        ref = _to_float(raw)
        if ref is None:
            continue  # не численное — пропускаем
        dev = _to_float(props.get(f"{key}Deviation"))
        b = bounds_by_param.get(key, {})
        parameters.append(
            Parameter(
                id=key,
                name=key,
                datatype="decimal",
                referenceValue=ref,
                deviationAllowed=dev,
                minInclusive=b.get("minInclusive"),
                maxInclusive=b.get("maxInclusive"),
                unit=PARAM_UNITS.get(key),
            )
        )

    # Рекомендация (если есть)
    recommendations: list[Recommendation] = []
    rec_text = props.get("recommendation")
    if rec_text:
        recommendations.append(
            Recommendation(
                id=f"rec_{uuid.uuid5(uuid.NAMESPACE_URL, str(reg_subject)).hex[:8]}",
                text=rec_text,
                priority=1,
                linkedParameters=[p.id for p in parameters],
            )
        )

    return Regulation(
        id=source_id,
        name=props.get("name") or _local_name(reg_subject) or source_id,
        date=props.get("date"),
        version="1.0",
        status="active",
        parameters=parameters,
        constraints=parse_shapes_turtle(shapes_turtle) if shapes_turtle else [],
        recommendations=recommendations,
    )


def parse_shapes_turtle(turtle: str) -> list[Constraint]:
    """Распарсить SHACL Turtle в список Constraint.

    Поддерживает blank-node `sh:property [ ... ]` инлайн-форму (так PDF и пишет).
    """
    g = Graph()
    if not turtle.strip():
        return []
    try:
        g.parse(data=turtle, format="turtle")
    except Exception:
        return []

    constraints: list[Constraint] = []
    for shape in g.subjects(RDF.type, SH.NodeShape):
        target = _first_node(g, shape, SH.targetClass)
        target_class = _local_name(target) if target else "Regulation"
        for prop in g.objects(shape, SH.property):
            path = _first_node(g, prop, SH.path)
            path_name = _local_name(path) if path else ""
            cid = f"{target_class}_{path_name}" if path_name else f"shape_{_local_name(shape)}"
            constraints.append(
                Constraint(
                    id=cid,
                    targetClass=target_class,
                    path=path_name,
                    datatype=_local_name(_first_node(g, prop, SH.datatype)) or None,
                    minCount=_first_int(g, prop, SH.minCount),
                    maxCount=_first_int(g, prop, SH.maxCount),
                    minInclusive=_first_float(g, prop, SH.minInclusive),
                    maxInclusive=_first_float(g, prop, SH.maxInclusive),
                    pattern=_first_str(g, prop, SH.pattern),
                    message=_first_str(g, prop, SH.message),
                    severity=_severity_from(g, prop),
                )
            )
    return constraints


# ---- Helpers ----------------------------------------------------------


def _shacl_bounds_index(shapes_turtle: str) -> dict[str, dict]:
    """Распарсить shapes_turtle и вернуть {param_name: {minInclusive, maxInclusive, minCount}}."""
    if not shapes_turtle.strip():
        return {}
    out: dict[str, dict] = {}
    g = Graph()
    try:
        g.parse(data=shapes_turtle, format="turtle")
    except Exception:
        return {}
    for shape in g.subjects(RDF.type, SH.NodeShape):
        for prop in g.objects(shape, SH.property):
            path = _first_node(g, prop, SH.path)
            name = _local_name(path) if path else ""
            if not name:
                continue
            out[name] = {
                "minInclusive": _first_float(g, prop, SH.minInclusive),
                "maxInclusive": _first_float(g, prop, SH.maxInclusive),
                "minCount": _first_int(g, prop, SH.minCount),
            }
    return out


def _local_name(node) -> str:
    if node is None:
        return ""
    s = str(node)
    for sep in ("#", "/"):
        if sep in s:
            return s.rsplit(sep, 1)[-1]
    return s


def _first_str(g: Graph, s, p) -> str | None:
    for _, _, o in g.triples((s, p, None)):
        return str(o)
    return None


def _first_node(g: Graph, s, p):
    for _, _, o in g.triples((s, p, None)):
        return o
    return None


def _first_float(g: Graph, s, p) -> float | None:
    return _to_float(_first_str(g, s, p))


def _first_int(g: Graph, s, p) -> int | None:
    v = _first_str(g, s, p)
    if v is None:
        return None
    try:
        return int(v)
    except ValueError:
        try:
            return int(float(v))
        except ValueError:
            return None


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _severity_from(g: Graph, prop) -> str:
    sev = _first_str(g, prop, SH.severity) or ""
    if "Warning" in sev:
        return "warning"
    if "Info" in sev:
        return "info"
    return "violation"
