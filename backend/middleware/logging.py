"""Request/Response logging middleware for development and debugging.

This middleware logs incoming requests and outgoing responses,
which is invaluable for debugging API issues during development.

IMPORTANT: This middleware should only be enabled in development mode
to avoid performance overhead and privacy concerns in production.
"""

import logging
import time
import uuid
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("api.requests")

# Paths to exclude from logging (noisy endpoints)
EXCLUDED_PATHS = {
    "/health",
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}

# Prefixes to exclude from logging (high-frequency polling endpoints)
EXCLUDED_PREFIXES = (
    "/api/v1/generate/status/",
    "/api/generate/status/",
)

# Maximum body size to log (to avoid logging large file uploads)
MAX_BODY_LOG_SIZE = 1024  # 1KB


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs HTTP requests and responses.

    For each request, logs:
    - Request ID (for correlation)
    - HTTP method and path
    - Query parameters
    - Request duration
    - Response status code

    Note: This middleware is designed for development use only.
    Enable by adding to main.py when APP_MODE is DEV.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip excluded paths
        if request.url.path in EXCLUDED_PATHS:
            return await call_next(request)

        # Skip excluded prefix paths
        if any(request.url.path.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
            return await call_next(request)

        # Skip static file paths
        if request.url.path.startswith("/storage/"):
            return await call_next(request)

        # Generate request ID for correlation
        request_id = str(uuid.uuid4())[:8]

        # Record start time
        start_time = time.time()

        # Extract request info
        method = request.method
        path = request.url.path
        query_params = dict(request.query_params)
        client_ip = request.client.host if request.client else "unknown"

        # Build request descriptor (single-line logging on completion/error).
        log_parts = [
            f"[{request_id}]",
            f"{method} {path}",
        ]

        if query_params:
            # Sanitize sensitive query params
            sanitized_params = {
                k: ("***" if k.lower() in ("token", "password", "key") else v)
                for k, v in query_params.items()
            }
            log_parts.append(f"params={sanitized_params}")

        log_parts.append(f"client={client_ip}")
        request_desc = " ".join(log_parts)

        # Process request
        try:
            response = await call_next(request)
        except Exception as e:
            # Log exception
            duration = time.time() - start_time
            logger.error(
                f"{request_desc} - ERROR ({duration:.3f}s): {e}"
            )
            raise

        # Calculate duration
        duration = time.time() - start_time

        # Log response
        status_code = response.status_code
        status_class = status_code // 100

        # Use appropriate log level based on status code
        if status_class == 5:
            log_func = logger.error
        elif status_class == 4:
            log_func = logger.warning
        elif method == "GET":
            # Successful read traffic is the noisiest in dev; keep it at debug.
            log_func = logger.debug
        else:
            log_func = logger.info

        log_func(
            f"{request_desc} - {status_code} ({duration:.3f}s)"
        )

        # Add request ID to response headers for debugging
        response.headers["X-Request-ID"] = request_id

        return response


def configure_request_logging(log_level: str = "INFO") -> None:
    """
    Configure the request logger with appropriate settings.

    Call this function during application startup to set up
    the request logging format and level.
    """
    request_logger = logging.getLogger("api.requests")
    request_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    # Prevent duplicate emission via root logger handlers.
    request_logger.propagate = False

    # Create a handler if none exists
    if not request_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
            )
        )
        request_logger.addHandler(handler)
