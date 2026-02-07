"""Shared Pydantic validators.

Keep these small and dependency-free so schema modules can reuse them without
introducing import cycles.
"""


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

