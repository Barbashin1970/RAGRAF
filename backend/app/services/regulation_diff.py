"""Structured diff between two регламент-snapshot'ами.

Используется при выводе истории правок: для каждой версии — человекочитаемая
строка `diff_summary` («pressure: 20.5 → 22.0; рекомендация») плюс полный
список структурных изменений для разворачивания в UI.

Поля сравнения:
  - name, date, version, status
  - parameters (added / removed / changed по id)
  - recommendation (text + priority)
"""
from __future__ import annotations

from typing import Any

from app.schemas.domain import Parameter, Regulation


def _param_fields() -> tuple[str, ...]:
    return ("name", "datatype", "referenceValue", "deviationAllowed", "unit", "minInclusive", "maxInclusive")


def _short_value(v: Any) -> str:
    if v is None:
        return "—"
    if isinstance(v, str):
        s = v.replace("\n", " ")
        return s if len(s) <= 60 else (s[:57] + "…")
    return str(v)


def compute_diff(old: Regulation | None, new: Regulation) -> dict[str, Any]:
    """Сравнить два состояния регламента и вернуть структурированный diff.

    Returns:
      {
        "summary": "pressure: 20.5 → 22.0; recommendation",
        "changes": [
          {"op": "changed", "path": "param.pressure.referenceValue", "before": 20.5, "after": 22.0, "label": "..."},
          {"op": "added",   "path": "param.snowDepth",                "before": null,  "after": {...}},
          ...
        ],
        "counts": {"changed": 2, "added": 1, "removed": 0}
      }
    """
    if old is None:
        return {
            "summary": "Регламент создан",
            "changes": [],
            "counts": {"changed": 0, "added": 0, "removed": 0, "initial": 1},
        }

    changes: list[dict[str, Any]] = []

    # --- метаполя ---
    for field, label in (
        ("name", "название"),
        ("date", "дата"),
        ("version", "версия"),
        ("status", "статус"),
        ("domain", "домен"),
    ):
        ov = getattr(old, field)
        nv = getattr(new, field)
        if ov != nv:
            changes.append(
                {
                    "op": "changed",
                    "path": field,
                    "label": label,
                    "before": _short_value(ov),
                    "after": _short_value(nv),
                }
            )

    # --- параметры ---
    old_params: dict[str, Parameter] = {p.id: p for p in old.parameters}
    new_params: dict[str, Parameter] = {p.id: p for p in new.parameters}

    for pid, op_obj in old_params.items():
        if pid not in new_params:
            changes.append(
                {
                    "op": "removed",
                    "path": f"param.{pid}",
                    "label": f"параметр {op_obj.name}",
                    "before": op_obj.model_dump(),
                    "after": None,
                }
            )

    for pid, np_obj in new_params.items():
        op_obj = old_params.get(pid)
        if op_obj is None:
            changes.append(
                {
                    "op": "added",
                    "path": f"param.{pid}",
                    "label": f"параметр {np_obj.name}",
                    "before": None,
                    "after": np_obj.model_dump(),
                }
            )
            continue
        # сравнение полей параметра
        for f in _param_fields():
            ov = getattr(op_obj, f)
            nv = getattr(np_obj, f)
            if ov != nv:
                changes.append(
                    {
                        "op": "changed",
                        "path": f"param.{pid}.{f}",
                        "label": f"{np_obj.name}.{f}",
                        "before": _short_value(ov),
                        "after": _short_value(nv),
                    }
                )

    # --- рекомендация ---
    old_rec = old.recommendations[0] if old.recommendations else None
    new_rec = new.recommendations[0] if new.recommendations else None
    if (old_rec is None) != (new_rec is None):
        if new_rec and not old_rec:
            changes.append({"op": "added", "path": "recommendation", "label": "рекомендация", "before": None, "after": _short_value(new_rec.text)})
        elif old_rec and not new_rec:
            changes.append({"op": "removed", "path": "recommendation", "label": "рекомендация", "before": _short_value(old_rec.text), "after": None})
    elif old_rec and new_rec:
        if old_rec.text != new_rec.text:
            changes.append(
                {
                    "op": "changed",
                    "path": "recommendation.text",
                    "label": "текст рекомендации",
                    "before": _short_value(old_rec.text),
                    "after": _short_value(new_rec.text),
                }
            )
        if old_rec.priority != new_rec.priority:
            changes.append(
                {
                    "op": "changed",
                    "path": "recommendation.priority",
                    "label": "приоритет рекомендации",
                    "before": _short_value(old_rec.priority),
                    "after": _short_value(new_rec.priority),
                }
            )

    counts = {"changed": 0, "added": 0, "removed": 0, "initial": 0}
    for c in changes:
        counts[c["op"]] = counts.get(c["op"], 0) + 1

    return {"summary": _build_summary(changes, counts), "changes": changes, "counts": counts}


def _build_summary(changes: list[dict[str, Any]], counts: dict[str, int]) -> str:
    if not changes:
        return "Без изменений"
    # Если 1-2 правки — перечисляем коротко
    if len(changes) <= 2:
        parts: list[str] = []
        for c in changes:
            label = c.get("label", c["path"])
            if c["op"] == "changed":
                parts.append(f"{label}: {c['before']} → {c['after']}")
            elif c["op"] == "added":
                parts.append(f"+ {label}")
            elif c["op"] == "removed":
                parts.append(f"− {label}")
        return "; ".join(parts)
    # 3+ — агрегированно
    parts = []
    if counts.get("added"):
        parts.append(f"+{counts['added']}")
    if counts.get("removed"):
        parts.append(f"−{counts['removed']}")
    if counts.get("changed"):
        parts.append(f"~{counts['changed']}")
    bucket = ", ".join(parts)
    # покажем имена 2-3 изменённых полей чтобы было понятно
    changed_labels = [c.get("label", c["path"]) for c in changes if c["op"] == "changed"]
    if changed_labels:
        head = ", ".join(changed_labels[:3])
        if len(changed_labels) > 3:
            head += f" и ещё {len(changed_labels) - 3}"
        return f"{bucket} · {head}"
    return f"{bucket} ({len(changes)} правок)"
