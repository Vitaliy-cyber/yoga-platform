"""CSV import/export hardening helpers."""

from __future__ import annotations

import unicodedata
from typing import Optional

# Formula trigger characters used by spreadsheet apps.
CSV_INJECTION_CHARS = ("=", "+", "-", "@")


def sanitize_csv_field(value: Optional[str]) -> str:
    """
    Sanitize a CSV field to prevent formula injection.

    Values that start with formula triggers are prefixed with an apostrophe.
    """
    if value is None:
        return ""

    normalized = "".join(
        " "
        if unicodedata.category(ch) in ("Cc", "Zl", "Zp")
        else ch
        for ch in str(value)
    )

    idx = 0
    while idx < len(normalized):
        ch = normalized[idx]
        if ch.isspace() or unicodedata.category(ch) == "Cf":
            idx += 1
            continue
        break

    if idx < len(normalized):
        first = normalized[idx]
        if first in CSV_INJECTION_CHARS:
            return "'" + normalized
        if first == "'":
            j = idx + 1
            while j < len(normalized):
                ch = normalized[j]
                if ch.isspace() or unicodedata.category(ch) == "Cf":
                    j += 1
                    continue
                break
            if j < len(normalized) and normalized[j] in CSV_INJECTION_CHARS:
                return "'" + normalized

    return normalized


def strip_csv_formula_guard(value: str) -> str:
    """
    Undo export-time formula guard when safe.

    Export prefixes dangerous values with an apostrophe. On import we remove one
    guard apostrophe if it directly protects a formula-triggering prefix.
    """
    if not isinstance(value, str) or not value.startswith("'"):
        return value

    if value.startswith("''"):
        idx = 2
        while idx < len(value):
            ch = value[idx]
            if ch.isspace() or unicodedata.category(ch) == "Cf":
                idx += 1
                continue
            break
        if idx < len(value) and value[idx] in CSV_INJECTION_CHARS:
            return value[1:]

    idx = 1
    while idx < len(value):
        ch = value[idx]
        if ch.isspace() or unicodedata.category(ch) == "Cf":
            idx += 1
            continue
        break

    if idx < len(value) and value[idx] in CSV_INJECTION_CHARS:
        return value[1:]

    return value


def escape_muscle_name_for_csv(value: Optional[str]) -> str:
    """
    Escape compact muscles CSV token, preserving commas/colons/backslashes.
    """
    sanitized = sanitize_csv_field(value)
    return (
        sanitized.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(":", "\\:")
    )
