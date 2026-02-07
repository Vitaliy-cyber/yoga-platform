import re
from typing import Optional


_SUSPICIOUS_ERROR_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"traceback", re.IGNORECASE),
    re.compile(r"\bfile\s+\".*?\.py\"", re.IGNORECASE),
    re.compile(r"sqlalchemy", re.IGNORECASE),
    re.compile(r"sqlite3", re.IGNORECASE),
    re.compile(r"\boperationalerror\b", re.IGNORECASE),
    re.compile(r"\bintegrityerror\b", re.IGNORECASE),
    re.compile(r"\bstaledataerror\b", re.IGNORECASE),
    re.compile(r"\[sql:", re.IGNORECASE),
    re.compile(r"https?://sqlalche\.me/", re.IGNORECASE),
    re.compile(r"/home/|/users/|[a-z]:\\", re.IGNORECASE),
)


def sanitize_public_error_message(
    message: Optional[str],
    *,
    fallback: str = "Internal error",
    max_chars: int = 240,
) -> Optional[str]:
    """
    Sanitize an error message before returning it to clients.

    Treat `message` as untrusted: it may contain stack traces, SQL, file paths,
    or other internal details (especially if derived from `str(exception)`).
    """
    if not message:
        return None

    safe = message.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    safe = safe.strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        return None

    if any(p.search(safe) for p in _SUSPICIOUS_ERROR_PATTERNS):
        return fallback

    if len(safe) > max_chars:
        return f"{safe[:max_chars]}…"
    return safe

