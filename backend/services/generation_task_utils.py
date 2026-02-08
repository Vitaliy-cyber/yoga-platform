"""Shared helpers for generation task payload normalization."""

from __future__ import annotations

import json
from typing import Iterable, Optional


VALID_GENERATE_STATUSES = frozenset({"pending", "processing", "completed", "failed"})


def clamp_progress(value: object) -> int:
    """Normalize arbitrary progress values to integer 0..100."""
    try:
        progress_int = int(value)  # type: ignore[arg-type]
    except Exception:
        return 0
    if progress_int < 0:
        return 0
    if progress_int > 100:
        return 100
    return progress_int


def clamp_activation_level(value: object, *, default: int = 50) -> int:
    """Normalize activation level to integer 0..100."""
    try:
        level_int = int(value)  # type: ignore[arg-type]
    except Exception:
        return default
    if level_int < 0:
        return 0
    if level_int > 100:
        return 100
    return level_int


def normalize_generate_status(value: object, *, default: str = "failed") -> str:
    """Normalize task status to a known public enum value."""
    status = value if isinstance(value, str) else default
    if status not in VALID_GENERATE_STATUSES:
        return default
    return status


def parse_analyzed_muscles_json(raw: object) -> Optional[list[dict[str, int]]]:
    """
    Parse stored analyzed-muscles payload and return sanitized items.

    Output format:
      [{"name": "<muscle>", "activation_level": 0..100}, ...]
    """
    if not raw:
        return None

    payload = raw
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except Exception:
            return None

    if not isinstance(payload, list):
        return None

    parsed: list[dict[str, int]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str):
            continue
        normalized_name = name.strip()
        if not normalized_name:
            continue
        parsed.append(
            {
                "name": normalized_name,
                "activation_level": clamp_activation_level(
                    item.get("activation_level", 50), default=50
                ),
            }
        )
    return parsed or None


def serialize_analyzed_muscles(analyzed_muscles: Optional[Iterable[object]]) -> Optional[str]:
    """Serialize analyzed muscles to canonical JSON for DB storage."""
    if not analyzed_muscles:
        return None

    payload: list[dict[str, int]] = []
    for item in analyzed_muscles:
        if isinstance(item, dict):
            raw_name = item.get("name")
            raw_level = item.get("activation_level", 50)
        else:
            raw_name = getattr(item, "name", None)
            raw_level = getattr(item, "activation_level", 50)

        if not isinstance(raw_name, str):
            continue
        name = raw_name.strip()
        if not name:
            continue
        payload.append(
            {
                "name": name,
                "activation_level": clamp_activation_level(raw_level, default=50),
            }
        )

    if not payload:
        return None
    return json.dumps(payload)
