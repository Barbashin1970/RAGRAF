"""Local fixture store — реальные данные из Rules-Management.pdf и доп. регламенты.

Используется как fallback когда upstream недоступен, либо как single source of
truth когда `USE_FIXTURES=true`. Файлы лежат в `backend/data/fixtures/`.

Каждый регламент привязан к **домену** — крупному смысловому кластеру
(Теплоснабжение, Управление ЖКХ, …), чтобы Graph View не сваливал в одну кашу
несвязанные между собой регламенты.
"""
from __future__ import annotations

from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "data" / "fixtures"


# --- Domains -----------------------------------------------------------

DOMAINS: dict[str, dict[str, str]] = {
    "heating": {
        "label": "Теплоснабжение",
        "hint":  "Тепловые узлы, давление, температура, аварийные перекрытия",
    },
    "housing": {
        "label": "Управление ЖКХ",
        "hint":  "ТСЖ, общежития, придомовая территория, сезонные риски",
    },
    "safety": {
        "label": "Безопасность кампуса",
        "hint":  "Серверные НГУ, эскалация в охрану / 01-101-112 / ЕДДС",
    },
    "environment": {
        "label": "Городская экология",
        "hint":  "Качество воздуха, PM2.5, НМУ, оповещение уязвимых групп",
    },
    "emergency_response": {
        "label": "Ситуационный центр",
        "hint":  "ЕДДС, приём 112, эскалация в ЦУКС, режимы повседневной/повышенной/ЧС",
    },
    "campus": {
        "label": "Кампус НГУ",
        "hint":  "Регламенты по Стандарту инновационной образовательной среды (Минобрнауки 28.02.2024) — СЦ, ИТ-отдел, СКД, эксплуатация, общежития, технопарк, ФОК, МФК",
    },
}


# --- Fixtures registry -------------------------------------------------

REGISTRY: dict[str, dict[str, str]] = {
    "pressure-diameter": {
        "name":   "Регламент на допустимые параметры давления и диаметра для трубопроводов водоснабжения",
        "domain": "heating",
    },
    "heat-inlet-breach": {
        "name":   "Регламент при прорыве теплового ввода (smart-valve, обходчик, оповещение медблока)",
        "domain": "heating",
    },
    "roof-snow-fencing": {
        "name":   "Регламент огораживания придомовой территории и оповещения ответственных при риске падения сосулек и схода снега с кровли (ТСЖ)",
        "domain": "housing",
    },
    "dormitory-flood": {
        "name":   "Регламент при ночной протечке в жилом блоке общежития (отсекатель стояка, комендант, эвакуация в холл)",
        "domain": "housing",
    },
    "thermal-incident-server": {
        "name":   "Регламент при термическом инциденте в серверной НГУ (перегрев / задымление, эскалация в ЕДДС и 01/101/112)",
        "domain": "safety",
    },
    "air-quality-smog-trap": {
        "name":   "Регламент при экологической ловушке: безветрие + загрязнение PM2.5 (НМУ, оповещение уязвимых групп, предписания предприятиям)",
        "domain": "environment",
    },
    "nsu-parking-anpr": {
        "name":   "Регламент контроля доступа на парковку НГУ (ANPR + фолбэк звонком, лимит стоянки, месячный отчёт)",
        "domain": "safety",
    },

    # ── Ситуационный центр / ЕДДС р.п. Кольцово (МКУ «СВЕТОЧ») ─────────
    # Источник: «Положение о ЕДДС МКУ "СВЕТОЧ"» — Приложение 1 к приказу № 15
    # от 04.12.2020. Регламенты вырезаны из §4-6 (основные задачи, режимы
    # функционирования, порядок работы при поступлении вызова 112).
    "koltsovo-edds-call-112": {
        "name":   "Регламент приёма вызова на единый номер 112 (ЕДДС р.п. Кольцово, МКУ «СВЕТОЧ»)",
        "domain": "emergency_response",
    },
    "koltsovo-edds-mode-escalation": {
        "name":   "Регламент перевода ЕДДС р.п. Кольцово в режимы повышенной готовности и чрезвычайной ситуации",
        "domain": "emergency_response",
    },
    "koltsovo-edds-cuks-report": {
        "name":   "Регламент доклада в ЦУКС ГУ МЧС России по НСО при ЧС выше локального характера",
        "domain": "emergency_response",
    },
    "koltsovo-edds-adpi-monitoring": {
        "name":   "Регламент мониторинга автономных дымовых пожарных извещателей АДПИ GSM (ЕДДС р.п. Кольцово)",
        "domain": "emergency_response",
    },

    # ── Кампус НГУ (Стандарт Минобрнауки 28.02.2024) ────────────────────
    # 10 регламентов сгенерированы скриптом scripts/gen_campus_fixtures.py
    # из CAMPUS-NSU-REGULATIONS.md. Каждый = роль → ответственная служба.
    "nsu-campus-situational-center": {
        "name":   "Регламент работы ситуационного центра кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-access-control": {
        "name":   "Регламент контроля доступа и пропускной системы кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-digital-identity": {
        "name":   "Регламент единого профиля кампуса (SSO) НГУ",
        "domain": "campus",
    },
    "nsu-campus-engineering-ops": {
        "name":   "Регламент эксплуатации инженерных сетей и ЦИМ кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-dormitory-standard": {
        "name":   "Регламент общежития кампуса НГУ (стандарт проживания)",
        "domain": "campus",
    },
    "nsu-campus-edu-lab-complex": {
        "name":   "Регламент учебно-лабораторного комплекса кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-technopark": {
        "name":   "Регламент технопарка кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-physical-fitness": {
        "name":   "Регламент физкультурно-оздоровительного корпуса (ФОК) кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-multifunctional": {
        "name":   "Регламент многофункционального комплекса (МФК) кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-antiterrorism": {
        "name":   "Регламент антитеррористической защищённости кампуса НГУ",
        "domain": "campus",
    },
    "nsu-campus-fire-action": {
        "name":   "Регламент действий при пожаре на объектах кампуса НГУ",
        "domain": "campus",
    },
}


def list_domains() -> list[dict[str, str]]:
    return [
        {"id": did, "label": v["label"], "hint": v["hint"]}
        for did, v in DOMAINS.items()
    ]


def list_fixtures() -> list[dict[str, object]]:
    """Список регламентов, обогащённый параметрами и ограничениями для UI.

    Счётчики вычисляются на лету из локальных Turtle-файлов (это копеечная
    операция — RDF-парсинг небольших фикстур). Если фикстура битая —
    счётчики просто опускаются.
    """
    # Импорт внутри функции: turtle_bridge сам не зависит от fixtures, цикла нет,
    # но импорт в теле позволяет приложению грузиться даже если rdflib временно
    # сбоит на старте (в тестах, при минимальном venv).
    from app.services.turtle_bridge import parse_regulation_turtle, parse_shapes_turtle

    out: list[dict[str, object]] = []
    for sid, meta in REGISTRY.items():
        item: dict[str, object] = {
            "id":        sid,
            "source_id": sid,
            "name":      meta["name"],
            "domain":    meta["domain"],
        }
        try:
            data = read_data(sid)
            shapes = read_shapes(sid)
            reg = parse_regulation_turtle(data, sid, shapes_turtle=shapes)
            constraints = parse_shapes_turtle(shapes)
            item["parameters_count"] = len(reg.parameters)
            item["constraints_count"] = len(constraints)
            if reg.recommendations:
                item["recommendations_count"] = len(reg.recommendations)
        except Exception:
            pass
        out.append(item)
    return out


def list_fixtures_in_domain(domain: str) -> list[dict[str, object]]:
    return [f for f in list_fixtures() if f.get("domain") == domain]


def has_fixture(source_id: str) -> bool:
    return source_id in REGISTRY


def get_domain(source_id: str) -> str | None:
    meta = REGISTRY.get(source_id)
    return meta["domain"] if meta else None


def read_data(source_id: str) -> str:
    p = FIXTURES_DIR / f"{source_id}.data.ttl"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def read_shapes(source_id: str) -> str:
    p = FIXTURES_DIR / f"{source_id}.shapes.ttl"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def read_flow(source_id: str) -> str:
    """Стартовый Rule DSL для регламента (если есть)."""
    p = FIXTURES_DIR / f"{source_id}.flow.json"
    return p.read_text(encoding="utf-8") if p.exists() else ""
