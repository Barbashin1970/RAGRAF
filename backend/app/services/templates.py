"""Доменные шаблоны для нового регламента.

Каждый шаблон даёт:
  - название по умолчанию (легко перезаписать);
  - 3–5 типичных параметров с ref/dev/bounds — пользователь правит,
    добавляет, удаляет на вкладке «Поля» или «Слайдеры»;
  - текст рекомендации-скелет;
  - стартовый Rule DSL flow (input → threshold → compare → output цепочка)
    — пользователь дополняет в Flow Editor.

Цель: при «Создать регламент» получить **редактируемую заготовку**, а не
пустую форму. По наблюдениям пользователей это резко снижает порог
входа: достаточно поправить пару значений вместо создания всех узлов
с нуля.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from app.schemas.domain import (
    FlowEdge,
    FlowNode,
    Parameter,
    Recommendation,
    Regulation,
    RuleDSL,
)


# ── Slug helpers (shared between POST /regulations и sandbox create-from-params) ──

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(text: str, fallback: str = "regulation") -> str:
    """Имя → kebab-case ASCII slug. Кириллица → транслит, остальные не-ASCII выбрасываются."""
    s = (text or "").strip().lower()
    out: list[str] = []
    for ch in s:
        if ch in _TRANSLIT:
            out.append(_TRANSLIT[ch])
        elif ch.isascii() and (ch.isalnum() or ch in "-_ "):
            out.append(ch)
        elif ch.isspace():
            out.append(" ")
    s = "".join(out)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:60] or fallback


def ensure_unique_source_id(base: str) -> str:
    """Если slug уже занят в DuckDB или среди фикстур — добавляем uuid-суффикс."""
    from app.services import fixtures, regulation_store
    if not regulation_store.has(base) and not fixtures.has_fixture(base):
        return base
    return f"{base}-{uuid.uuid4().hex[:6]}"


def _param(
    pid: str,
    name: str,
    ref: float,
    dev: float,
    unit: str,
    min_inc: float | None = None,
    max_inc: float | None = None,
) -> Parameter:
    return Parameter(
        id=pid,
        name=name,
        datatype="decimal",
        referenceValue=ref,
        deviationAllowed=dev,
        unit=unit,
        minInclusive=min_inc,
        maxInclusive=max_inc,
    )


def _simple_flow(
    regulation_id: str,
    params: list[Parameter],
    output_text: str,
) -> RuleDSL:
    """Строит линейный flow: каждый параметр → threshold → compare → общий output.

    Для шаблона достаточно показать паттерн «как соединять узлы»; пользователь
    в FlowEditor добавит формулы, switch и SHACL-узлы по необходимости.
    """
    nodes: list[FlowNode] = []
    edges: list[FlowEdge] = []
    y_step = 140
    output_id = "n_output"

    for idx, p in enumerate(params):
        y = 60 + idx * y_step
        ref = p.referenceValue if p.referenceValue is not None else 0.0
        dev = p.deviationAllowed if p.deviationAllowed is not None else 1.0
        in_id = f"n_in_{p.id}"
        thr_id = f"n_thr_{p.id}"
        cmp_id = f"n_cmp_{p.id}"
        nodes.extend(
            [
                FlowNode(id=in_id, type="input", label=p.name, paramRef=p.id, position={"x": 60.0, "y": float(y)}),
                FlowNode(
                    id=thr_id,
                    type="threshold",
                    label=f"{ref} ± {dev} {p.unit or ''}".strip(),
                    refValue=ref,
                    deviation=dev,
                    unit=p.unit,
                    position={"x": 320.0, "y": float(y)},
                ),
                FlowNode(
                    id=cmp_id,
                    type="compare",
                    label="вне диапазона?",
                    operator="outside_range",
                    position={"x": 580.0, "y": float(y)},
                ),
            ]
        )
        edges.extend(
            [
                FlowEdge(source=in_id, target=thr_id),
                FlowEdge(source=thr_id, target=cmp_id),
                FlowEdge(source=cmp_id, target=output_id, condition="outside"),
            ]
        )

    middle_y = 60.0 + ((len(params) - 1) * y_step) / 2.0 if params else 60.0
    nodes.append(
        FlowNode(
            id=output_id,
            type="output",
            label="Рекомендация",
            action="recommendation",
            text=output_text,
            priority=1,
            position={"x": 880.0, "y": middle_y},
        )
    )

    return RuleDSL(
        rule_id=f"rule_{regulation_id}",
        regulation_id=regulation_id,
        nodes=nodes,
        edges=edges,
    )


# ── Templates per domain ───────────────────────────────────────────────


TEMPLATES: dict[str, dict[str, Any]] = {
    "heating": {
        "default_name": "Регламент эксплуатации тепловой системы",
        "parameters": [
            _param("temperature", "temperature", 70.0, 10.0, "°C", min_inc=0.0, max_inc=150.0),
            _param("pressure", "pressure", 4.0, 0.5, "атм", min_inc=0.0, max_inc=25.0),
            _param("flowRate", "flowRate", 1.5, 0.3, "м³/ч", min_inc=0.0, max_inc=50.0),
        ],
        "recommendation": (
            "При выходе одного из параметров за допустимые границы: "
            "1) Уведомить инженерную службу объекта и аварийную бригаду теплосетей. "
            "2) Подготовить плановую остановку контура для диагностики. "
            "3) При резком падении давления (> 0.2 атм/мин) или превышении температуры "
            "подачи — инициировать аварийное перекрытие через обходчика, координировать "
            "с ЕДДС, оповестить смежные критические потребители."
        ),
    },
    "housing": {
        "default_name": "Регламент эксплуатации жилого фонда",
        "parameters": [
            _param("roomTemperature", "roomTemperature", 22.0, 2.0, "°C", min_inc=10.0, max_inc=35.0),
            _param("humidity", "humidity", 50.0, 10.0, "%", min_inc=0.0, max_inc=100.0),
            _param("waterLeakLevel", "waterLeakLevel", 0.0, 0.5, "см", min_inc=0.0, max_inc=100.0),
            _param("responseTime", "responseTime", 15.0, 5.0, "мин", min_inc=1.0, max_inc=120.0),
        ],
        "recommendation": (
            "При отклонении эксплуатационных параметров жилого блока: "
            "1) Уведомить управляющую компанию / коменданта; время реакции — "
            "15 ± 5 минут. 2) В ночном режиме (22:00–06:00) минимизировать контакт "
            "с жильцами — эвакуация только при критическом уровне. 3) При протечке "
            "выше порогового уровня — автоматическое перекрытие стояка ПОСЛЕ "
            "подтверждения коменданта; параллельно подготовить временное размещение."
        ),
    },
    "safety": {
        "default_name": "Регламент реагирования на инцидент безопасности",
        "parameters": [
            _param("airTemperature", "airTemperature", 22.0, 4.0, "°C", min_inc=0.0, max_inc=60.0),
            _param("smokeConcentration", "smokeConcentration", 0.0, 50.0, "ppm", min_inc=0.0, max_inc=2000.0),
            _param("escalationTimeMinutes", "escalationTimeMinutes", 10.0, 3.0, "мин", min_inc=1.0, max_inc=60.0),
        ],
        "recommendation": (
            "При срабатывании датчиков безопасности: "
            "1) Немедленно уведомить дежурного оператора; параллельно — охрану и "
            "ИТ-службу объекта. 2) Подготовить ограничение доступа до подтверждения "
            "обстановки. 3) При переходе в critical (превышение температуры/дыма "
            "вдвое от deviation) — вызов 01/101/112 и эскалация в городской штаб "
            "ЕДДС в окне 10 ± 3 минут. 4) Автоматические действия (отключение "
            "питания, пуск тушения) — только после подтверждения старшего инженера."
        ),
    },
    "environment": {
        "default_name": "Регламент экологического мониторинга",
        "parameters": [
            _param("pm25Concentration", "pm25Concentration", 10.0, 10.0, "мкг/м³", min_inc=0.0, max_inc=1000.0),
            _param("windSpeed", "windSpeed", 3.0, 1.5, "м/с", min_inc=0.0, max_inc=50.0),
            _param("temperatureRiseRate", "temperatureRiseRate", 0.5, 0.5, "°C/ч", min_inc=0.0, max_inc=10.0),
            _param("notificationLeadHours", "notificationLeadHours", 6.0, 2.0, "ч", min_inc=0.5, max_inc=48.0),
        ],
        "recommendation": (
            "При превышении экологических порогов: "
            "1) Уведомить городскую службу экологии и метеоконтроль. "
            "2) За 6 ± 2 часа до прогнозируемого пика — SMS уязвимым группам "
            "(астма, ХОБЛ, дети, пожилые). "
            "3) При превышении ПДК ВОЗ по PM2.5 (> 35 мкг/м³) или штиле "
            "(< 1.5 м/с) при загрязнении — объявить режим НМУ, выпустить "
            "предписания предприятиям. 4) Задействовать систему экстренного "
            "оповещения, информировать школы и детские сады."
        ),
    },
}


def list_template_domains() -> list[str]:
    return sorted(TEMPLATES.keys())


def has_template(domain: str) -> bool:
    return domain in TEMPLATES


def build_regulation(
    source_id: str,
    domain: str,
    name: str | None = None,
    *,
    use_template: bool = True,
) -> tuple[Regulation, RuleDSL]:
    """Собирает Regulation + starter flow.

    - Если `use_template=True` и для домена есть шаблон — заполняет параметры,
      рекомендацию и flow по шаблону.
    - Если шаблона нет или `use_template=False` — пустая заготовка (только meta).
    """
    if use_template and has_template(domain):
        tmpl = TEMPLATES[domain]
        params = [p.model_copy(deep=True) for p in tmpl["parameters"]]
        rec_text = tmpl["recommendation"]
        reg_name = name or tmpl["default_name"]
        reg = Regulation(
            id=source_id,
            name=reg_name,
            domain=domain,
            date=None,
            version="0.1",
            status="draft",
            parameters=params,
            constraints=[],
            recommendations=[
                Recommendation(
                    id=f"rec_{source_id}",
                    text=rec_text,
                    priority=2,
                    linkedParameters=[p.id for p in params],
                )
            ],
        )
        flow = _simple_flow(source_id, params, rec_text)
        return reg, flow

    # пустая заготовка
    reg = Regulation(
        id=source_id,
        name=name or "Новый регламент",
        domain=domain,
        version="0.1",
        status="draft",
    )
    flow = RuleDSL(rule_id=f"rule_{source_id}", regulation_id=source_id, nodes=[], edges=[])
    return reg, flow


def build_regulation_from_params(
    source_id: str,
    domain: str,
    name: str,
    extracted: list[dict[str, Any]],
) -> tuple[Regulation, RuleDSL]:
    """Собрать Regulation + starter flow из извлечённых параметров (sandbox).

    Каждый элемент `extracted` ожидает: suggested_name, value, deviation?, unit?.
    ID параметра — `suggested_name`, при коллизии добавляется индекс.
    Рекомендация-скелет ссылается на список параметров и предлагает
    «уточнить пороги в Flow Editor».
    """
    params: list[Parameter] = []
    used_ids: set[str] = set()
    for e in extracted:
        base = (e.get("suggested_name") or "param").strip() or "param"
        pid = base
        i = 2
        while pid in used_ids:
            pid = f"{base}{i}"
            i += 1
        used_ids.add(pid)
        value = float(e.get("value", 0.0) or 0.0)
        dev_raw = e.get("deviation")
        params.append(
            Parameter(
                id=pid,
                name=pid,
                datatype="decimal",
                referenceValue=value,
                deviationAllowed=float(dev_raw) if dev_raw is not None else None,
                unit=(e.get("unit") or None),
                minInclusive=0.0 if value >= 0 else None,
            )
        )

    if not params:
        raise ValueError("extracted parameters list must not be empty")

    param_names = ", ".join(p.name for p in params)
    rec_text = (
        f"Регламент создан из текста с извлечёнными параметрами: {param_names}. "
        "При выходе любого из параметров за допустимое отклонение — уведомить "
        "ответственное лицо. Уточнить пороги, рекомендации и сценарии "
        "реагирования в Flow Editor."
    )

    reg = Regulation(
        id=source_id,
        name=name,
        domain=domain,
        version="0.1",
        status="draft",
        parameters=params,
        constraints=[],
        recommendations=[
            Recommendation(
                id=f"rec_{source_id}",
                text=rec_text,
                priority=2,
                linkedParameters=[p.id for p in params],
            )
        ],
    )
    flow = _simple_flow(source_id, params, rec_text)
    return reg, flow
