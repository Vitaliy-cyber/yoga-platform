"""Security headers middleware for HTTP response hardening."""

import logging
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from config import AppMode, get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds security headers to all responses.

    Headers added:
    - X-Content-Type-Options: Prevents MIME type sniffing
    - X-Frame-Options: Prevents clickjacking
    - X-XSS-Protection: Legacy XSS protection (for older browsers)
    - Strict-Transport-Security: Forces HTTPS (production only)
    - Content-Security-Policy: Controls resource loading
    - Referrer-Policy: Controls referrer information
    - Permissions-Policy: Controls browser features
    """

    def __init__(self, app):
        super().__init__(app)
        self.is_production = settings.APP_MODE == AppMode.PROD

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Legacy XSS protection (still useful for IE/older browsers)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Control referrer information
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Disable potentially dangerous browser features
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), "
            "camera=(), "
            "geolocation=(), "
            "gyroscope=(), "
            "magnetometer=(), "
            "microphone=(), "
            "payment=(), "
            "usb=()"
        )

        # HSTS header - only in production with HTTPS
        if self.is_production:
            # 1 year max-age with includeSubDomains and preload
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

            # Content Security Policy - Strengthened for production
            # SECURITY NOTES:
            # - 'unsafe-inline' removed from script-src - use nonces or hashes instead
            # - 'unsafe-eval' removed - can enable XSS attacks
            # - style-src still allows 'unsafe-inline' for CSS-in-JS frameworks
            #   (consider using style hashes in a stricter setup)
            # - strict-dynamic is used for scripts loaded by trusted scripts
            # - upgrade-insecure-requests forces HTTPS for all resources
            # - block-all-mixed-content prevents loading HTTP resources on HTTPS pages
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "  # CSS-in-JS needs unsafe-inline
                "img-src 'self' data: https: blob:; "
                "font-src 'self' data:; "
                "connect-src 'self' https:; "
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self'; "
                "upgrade-insecure-requests; "
                "block-all-mixed-content"
            )
        else:
            # Development CSP - more permissive for hot reload, dev tools
            # WARNING: Do not use this policy in production!
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "  # Needed for dev tools
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https: blob:; "
                "font-src 'self' data:; "
                "connect-src 'self' http: https: ws: wss:; "  # Allow WebSocket for HMR
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self'"
            )

        # Cache control for API responses
        if request.url.path.startswith("/api/"):
            # Don't cache API responses by default
            if "Cache-Control" not in response.headers:
                response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"

        return response


class TrustedHostMiddleware:
    """
    Middleware to validate Host header against allowed hosts.

    Prevents host header attacks by rejecting requests with
    unexpected Host headers.
    """

    def __init__(self, app, allowed_hosts: list[str] = None):
        self.app = app
        self.allowed_hosts = set(allowed_hosts or ["*"])
        self.allow_all = "*" in self.allowed_hosts

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if self.allow_all:
            await self.app(scope, receive, send)
            return

        # Extract host from headers
        headers = dict(scope.get("headers", []))
        host = headers.get(b"host", b"").decode("latin-1").split(":")[0].lower()

        if host not in self.allowed_hosts:
            logger.warning(f"Rejected request with untrusted Host header: {host}")

            # Return 400 Bad Request
            response = Response(
                content=b"Invalid host header",
                status_code=400,
                media_type="text/plain",
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def get_security_headers() -> dict:
    """
    Get a dictionary of security headers.

    Useful for adding headers to specific responses manually.
    """
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }

    if settings.APP_MODE == AppMode.PROD:
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return headers
