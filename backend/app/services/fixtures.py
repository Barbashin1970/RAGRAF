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

DOMAINS: dict[str, str] = {
    "heating":     "Теплоснабжение",
    "housing":     "Управление ЖКХ",
    "safety":      "Безопасность кампуса",
    "environment": "Городская экология",
    # будущие: "industrial", "transport", ...
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
}


def list_domains() -> list[dict[str, str]]:
    return [{"id": did, "label": label} for did, label in DOMAINS.items()]


def list_fixtures() -> list[dict[str, str]]:
    return [
        {"id": sid, "source_id": sid, "name": meta["name"], "domain": meta["domain"]}
        for sid, meta in REGISTRY.items()
    ]


def list_fixtures_in_domain(domain: str) -> list[dict[str, str]]:
    return [f for f in list_fixtures() if f["domain"] == domain]


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
