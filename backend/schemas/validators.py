"""Shared Pydantic validators.

Keep these small and dependency-free so schema modules can reuse them without
introducing import cycles.
"""

import re
import unicodedata
from typing import Any


HTML_TAG_PATTERN = re.compile(r"<[^>]+>")


def strip_html_tags(text: str) -> str:
    """Strip HTML tags from text to prevent XSS injection in free text fields."""
    if not isinstance(text, str):
        return text
    return HTML_TAG_PATTERN.sub("", text)


def strip_invisible_edges(value: str) -> str:
    """
    Strip leading/trailing whitespace and Unicode format characters (Cf).

    This prevents visually-identical names like "\\u200bYoga" or "\\ufeffYoga"
    from bypassing uniqueness checks and confusing users.
    """
    if not isinstance(value, str):
        return value
    start = 0
    end = len(value)
    while start < end and (
        value[start].isspace() or unicodedata.category(value[start]) == "Cf"
    ):
        start += 1
    while end > start and (
        value[end - 1].isspace() or unicodedata.category(value[end - 1]) == "Cf"
    ):
        end -= 1
    return value[start:end]


def ensure_utf8_encodable(value: str) -> str:
    """
    Reject strings that cannot be encoded to UTF-8 (e.g., unpaired surrogates).

    Unpaired surrogates can enter the system via JSON escape sequences like
    "\\uD800" and later crash JSON serialization (Starlette encodes responses
    as UTF-8).
    """
    if not isinstance(value, str):
        return value
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Text contains invalid Unicode characters")
    return value


def normalize_required_text(
    value: Any,
    *,
    field_name: str = "Field",
    strip_invisible: bool = False,
    strip_html: bool = False,
) -> Any:
    """Normalize required text fields: trim/sanitize, reject blank, enforce UTF-8."""
    if value is None or not isinstance(value, str):
        return value
    text = strip_html_tags(value) if strip_html else value
    text = strip_invisible_edges(text) if strip_invisible else text.strip()
    if not text:
        raise ValueError(f"{field_name} cannot be blank")
    return ensure_utf8_encodable(text)


def normalize_optional_text(
    value: Any,
    *,
    strip_invisible: bool = False,
    strip_html: bool = False,
) -> Any:
    """Normalize optional text fields: trim/sanitize, blank->None, enforce UTF-8."""
    if value is None or not isinstance(value, str):
        return value
    text = strip_html_tags(value) if strip_html else value
    text = strip_invisible_edges(text) if strip_invisible else text.strip()
    if not text:
        return None
    return ensure_utf8_encodable(text)


def ensure_utf8_encodable_deep(value: object, *, max_depth: int = 200) -> None:
    """
    Validate nested JSON-like data for UTF-8 encodability and safe nesting depth.

    Raises ValueError on invalid unicode or excessive nesting depth.
    """
    stack: list[tuple[object, int]] = [(value, 0)]
    while stack:
        cur, depth = stack.pop()
        if depth > max_depth:
            raise ValueError("JSON nesting too deep.")

        if cur is None or isinstance(cur, (int, float, bool)):
            continue
        if isinstance(cur, str):
            try:
                cur.encode("utf-8")
            except UnicodeEncodeError:
                raise ValueError("Invalid Unicode characters in JSON file.")
            continue
        if isinstance(cur, list):
            stack.extend((v, depth + 1) for v in cur)
            continue
        if isinstance(cur, dict):
            for k, v in cur.items():
                stack.append((k, depth + 1))
                stack.append((v, depth + 1))
