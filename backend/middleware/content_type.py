"""Content-Type validation middleware.

Ensures that POST/PUT/PATCH requests to JSON API endpoints include
the correct Content-Type header. This helps prevent security issues
and provides better error messages to API consumers.
"""

import logging
from typing import Callable, Set

from fastapi import Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# HTTP methods that typically have request bodies
METHODS_WITH_BODY = {"POST", "PUT", "PATCH"}

# Paths that are exempt from content-type validation
# (e.g., file upload endpoints, webhooks)
EXEMPT_PATHS: Set[str] = {
    # File upload endpoints handle multipart/form-data
    "/api/v1/generate/photo",
    "/api/generate/photo",
    "/api/v1/generate",  # Main generate endpoint (multipart/form-data)
    "/api/generate",
    "/api/v1/import/poses/json",
    "/api/v1/import/poses/csv",
    "/api/v1/import/backup",
    "/api/v1/import/preview/json",
    "/api/import/poses/json",
    "/api/import/poses/csv",
    "/api/import/backup",
    "/api/import/preview/json",
}

# Path patterns for dynamic routes that accept file uploads
EXEMPT_PATH_PATTERNS: Set[str] = {
    "/api/v1/poses/",  # Matches /api/v1/poses/{id}/schema
    "/api/poses/",
}

# Acceptable JSON content types
JSON_CONTENT_TYPES = {
    "application/json",
    "application/json; charset=utf-8",
    "application/json;charset=utf-8",
}


def is_json_content_type(content_type: str | None) -> bool:
    """Check if the content type indicates JSON."""
    if not content_type:
        return False

    # Normalize and check
    normalized = content_type.lower().strip()

    # Check exact match first
    if normalized in JSON_CONTENT_TYPES:
        return True

    # Check if it starts with application/json (handles charset params)
    return normalized.startswith("application/json")


def should_validate_content_type(request: Request) -> bool:
    """Determine if request should have content-type validated."""
    # Only validate methods that typically have bodies
    if request.method not in METHODS_WITH_BODY:
        return False

    # Skip exempt paths
    path = request.url.path
    if path in EXEMPT_PATHS:
        return False

    # Skip paths ending in common file upload patterns
    if "/upload" in path:
        return False

    # Skip paths ending with /schema (file upload endpoints)
    if path.endswith("/schema"):
        return False

    # Skip paths matching exempt patterns (dynamic routes with file uploads)
    for pattern in EXEMPT_PATH_PATTERNS:
        if path.startswith(pattern) and "/schema" in path:
            return False

    # Check if this is an API endpoint
    if not (path.startswith("/api/v1/") or path.startswith("/api/")):
        return False

    return True


class ContentTypeValidationMiddleware(BaseHTTPMiddleware):
    """
    Middleware to validate Content-Type header for API requests.

    Ensures that POST/PUT/PATCH requests to JSON API endpoints
    include application/json Content-Type header.

    Benefits:
    - Prevents accidental form-data submissions to JSON endpoints
    - Provides clear error messages for misconfigured clients
    - Helps catch integration issues early
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Check if we should validate content type
        if should_validate_content_type(request):
            content_type = request.headers.get("content-type")
            content_length = request.headers.get("content-length", "0")

            # Only validate if there's a body (content-length > 0 or unknown)
            has_body = content_length != "0"

            if has_body and not is_json_content_type(content_type):
                logger.warning(
                    f"Invalid Content-Type for {request.method} {request.url.path}: "
                    f"expected application/json, got {content_type}"
                )

                return JSONResponse(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    content={
                        "detail": "Content-Type must be application/json for this endpoint",
                        "code": "UNSUPPORTED_MEDIA_TYPE",
                    },
                )

        return await call_next(request)
