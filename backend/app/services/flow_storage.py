"""Filesystem-backed storage for Rule DSL drafts and immutable version snapshots.

Layout under DATA_DIR:

    data/
      flows/<regulation_id>.json           # current DSL
      versions/<regulation_id>/<ts>.json   # immutable snapshots
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.schemas.domain import FlowVersion, RuleDSL


def _data_root() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    (root / "flows").mkdir(exist_ok=True)
    (root / "versions").mkdir(exist_ok=True)
    return root


def _flow_path(regulation_id: str) -> Path:
    return _data_root() / "flows" / f"{regulation_id}.json"


def _versions_dir(regulation_id: str) -> Path:
    d = _data_root() / "versions" / regulation_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def delete_flow(regulation_id: str) -> bool:
    """Удалить flow + всю папку версий регламента. Idempotent — нет файла → ok."""
    import shutil
    p = _flow_path(regulation_id)
    deleted = False
    if p.exists():
        p.unlink()
        deleted = True
    versions_root = _data_root() / "versions" / regulation_id
    if versions_root.exists():
        shutil.rmtree(versions_root, ignore_errors=True)
        deleted = True
    return deleted


def load_flow(regulation_id: str) -> RuleDSL | None:
    p = _flow_path(regulation_id)
    if not p.exists():
        return None
    return RuleDSL.model_validate_json(p.read_text(encoding="utf-8"))


def save_flow(regulation_id: str, dsl: RuleDSL, author: str = "anonymous", comment: str | None = None) -> FlowVersion:
    p = _flow_path(regulation_id)
    p.write_text(dsl.model_dump_json(indent=2), encoding="utf-8")

    version_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    version = FlowVersion(
        version_id=version_id,
        regulation_id=regulation_id,
        created_at=created_at,
        author=author,
        comment=comment,
        dsl_snapshot=dsl,
        diff_summary=None,
    )
    (_versions_dir(regulation_id) / f"{version_id}.json").write_text(
        version.model_dump_json(indent=2), encoding="utf-8"
    )
    return version


def list_versions(regulation_id: str) -> list[FlowVersion]:
    d = _versions_dir(regulation_id)
    out: list[FlowVersion] = []
    for path in sorted(d.glob("*.json"), reverse=True):
        try:
            out.append(FlowVersion.model_validate_json(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValueError):
            continue
    return out


def get_version(regulation_id: str, version_id: str) -> FlowVersion | None:
    path = _versions_dir(regulation_id) / f"{version_id}.json"
    if not path.exists():
        return None
    return FlowVersion.model_validate_json(path.read_text(encoding="utf-8"))


def restore_version(regulation_id: str, version_id: str) -> FlowVersion | None:
    v = get_version(regulation_id, version_id)
    if not v:
        return None
    return save_flow(regulation_id, v.dsl_snapshot, comment=f"restore of {version_id}")
