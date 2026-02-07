import logging
import sys
import asyncio
from contextlib import asynccontextmanager
from typing import Any

from api.routes import analytics, auth, categories, compare, export, generate, import_, muscles, poses, sequences, versions, websocket
from fastapi import APIRouter
from config import AppMode, get_settings
from db.database import init_db
from fastapi import FastAPI, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from middleware.content_type import ContentTypeValidationMiddleware
from middleware.rate_limit import RateLimitMiddleware
from middleware.security import SecurityHeadersMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

settings = get_settings()

# Налаштування логування
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Заглушити шумні логгери
logging.getLogger("aiosqlite").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events - startup та shutdown"""

    # === STARTUP ===
    logger.info(f"Starting Yoga Platform in {settings.APP_MODE.value} mode...")

    # Попередження про небезпечний SECRET_KEY в production
    if (
        settings.APP_MODE == AppMode.PROD
        and settings.SECRET_KEY == "your-secret-key-here-change-in-production"
    ):
        logger.error("SECRET_KEY is using the default value in production")

    # Ініціалізація бази даних
    await init_db()
    logger.info("Database initialized")

    logger.info(f"Storage backend: {settings.STORAGE_BACKEND}")

    # Start periodic auth token cleanup task (skip during pytest).
    if "pytest" not in sys.modules:
        auth.start_cleanup_task()

    # Initialize AI Generator (Google Gemini API)
    try:
        if settings.GOOGLE_API_KEY:
            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator.get_instance()
            logger.info("Google Gemini AI Generator initialized")
        else:
            logger.warning("No GOOGLE_API_KEY configured. Set it in .env")
    except Exception as e:
        logger.warning(f"Failed to initialize AI generator: {e}")
        logger.warning("AI generation will not be available")

    yield

    # === SHUTDOWN ===
    if "pytest" not in sys.modules:
        auth.stop_cleanup_task()
    logger.info("Shutting down Yoga Platform...")


# Створення FastAPI додатку
app = FastAPI(
    title="Yoga Pose Platform",
    description="Платформа для йога-студії з AI генерацією зображень поз",
    version="1.0.0",
    lifespan=lifespan,
    debug=(settings.APP_MODE == AppMode.DEV),
)

MAX_ERROR_STRING_CHARS = 400
MAX_ERROR_CONTAINER_ITEMS = 50
MAX_ERROR_DEPTH = 8


def _truncate_string(value: str, max_chars: int = MAX_ERROR_STRING_CHARS) -> str:
    if len(value) <= max_chars:
        return value
    return f"{value[:max_chars]}…(truncated)"


def _sanitize_for_json(value: Any, *, _depth: int = 0) -> Any:
    """
    Make sure error payloads are always UTF-8 encodable.

    SECURITY/ROBUSTNESS: RequestValidationError details can include user-provided
    strings. Certain Unicode sequences (e.g. unpaired surrogates) can crash
    Starlette's JSONResponse encoder and turn 422 into 500 with a traceback.

    SECURITY: also truncate large reflected inputs to avoid response amplification
    (e.g. a 200KB invalid field producing a 200KB+ 422 body).
    """
    if _depth > MAX_ERROR_DEPTH:
        return "<max depth reached>"
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        safe = value.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
        return _truncate_string(safe)
    if isinstance(value, bytes):
        return _truncate_string(value.decode("utf-8", errors="replace"))
    if isinstance(value, list):
        out = [_sanitize_for_json(v, _depth=_depth + 1) for v in value[:MAX_ERROR_CONTAINER_ITEMS]]
        if len(value) > MAX_ERROR_CONTAINER_ITEMS:
            out.append(f"... ({len(value) - MAX_ERROR_CONTAINER_ITEMS} more items truncated)")
        return out
    if isinstance(value, tuple):
        return _sanitize_for_json(list(value), _depth=_depth)
    if isinstance(value, set):
        return _sanitize_for_json(list(value), _depth=_depth)
    if isinstance(value, dict):
        items = list(value.items())
        out: dict[str, Any] = {}
        for k, v in items[:MAX_ERROR_CONTAINER_ITEMS]:
            out[str(_sanitize_for_json(k, _depth=_depth + 1))] = _sanitize_for_json(v, _depth=_depth + 1)
        if len(items) > MAX_ERROR_CONTAINER_ITEMS:
            out["__truncated__"] = f"{len(items) - MAX_ERROR_CONTAINER_ITEMS} more keys truncated"
        return out
    # Pydantic/FastAPI validation contexts can include non-JSON-serializable
    # objects (e.g. exception instances). Convert anything else to a safe string.
    try:
        return _sanitize_for_json(str(value), _depth=_depth + 1)
    except Exception:
        return "<unserializable>"


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    safe_errors = _sanitize_for_json(exc.errors())
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": safe_errors},
    )

# Security middlewares (order matters - first added = last executed)
# 1. Security headers - adds security headers to all responses
app.add_middleware(SecurityHeadersMiddleware)

# 2. Content-Type validation - ensures proper content type for JSON endpoints
app.add_middleware(ContentTypeValidationMiddleware)

# 3. Rate limiting - protects against abuse
app.add_middleware(RateLimitMiddleware)

# 3.5. Serialize requests during pytest to avoid shared-session flush races
if "pytest" in sys.modules:
    class TestRequestLockMiddleware(BaseHTTPMiddleware):
        _lock = asyncio.Lock()

        async def dispatch(self, request, call_next):
            async with self._lock:
                return await call_next(request)

    app.add_middleware(TestRequestLockMiddleware)

# 4. Request logging (development only)
if settings.APP_MODE == AppMode.DEV:
    from middleware.logging import RequestLoggingMiddleware, configure_request_logging
    configure_request_logging(settings.LOG_LEVEL)
    app.add_middleware(RequestLoggingMiddleware)

# 5. CORS middleware - must be last (first to process incoming requests)
allow_credentials = "*" not in settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)

# Static files для завантажених та згенерованих зображень (лише для local storage)
if settings.STORAGE_BACKEND == "local":
    import os
    from pathlib import Path

    # Create storage directory for local uploads
    storage_dir = Path(__file__).parent / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")

# API Routes - versioned under /api/v1/
# Create a v1 router to group all API routes
api_v1_router = APIRouter(prefix="/api/v1")

# Include all route modules under the v1 router
api_v1_router.include_router(auth.router)
api_v1_router.include_router(poses.router)
api_v1_router.include_router(generate.router)
api_v1_router.include_router(categories.router)
api_v1_router.include_router(muscles.router)
api_v1_router.include_router(compare.router)
api_v1_router.include_router(analytics.router)
api_v1_router.include_router(sequences.router)
api_v1_router.include_router(versions.router)
api_v1_router.include_router(export.router)
api_v1_router.include_router(import_.router)
api_v1_router.include_router(websocket.router)

# Mount the v1 API router
app.include_router(api_v1_router)

# Backward compatibility: Also mount routes at /api/ (deprecated)
# This allows existing clients to continue working during migration
api_compat_router = APIRouter(prefix="/api", deprecated=True)
api_compat_router.include_router(auth.router)
api_compat_router.include_router(poses.router)
api_compat_router.include_router(generate.router)
api_compat_router.include_router(categories.router)
api_compat_router.include_router(muscles.router)
api_compat_router.include_router(compare.router)
api_compat_router.include_router(analytics.router)
api_compat_router.include_router(sequences.router)
api_compat_router.include_router(versions.router)
api_compat_router.include_router(export.router)
api_compat_router.include_router(import_.router)

app.include_router(api_compat_router)


@app.get("/")
async def root():
    """Головна сторінка API"""
    return {
        "name": "Yoga Pose Platform API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "mode": settings.APP_MODE.value,
        "ai_enabled": bool(settings.GOOGLE_API_KEY),
        "ai_provider": "google_gemini" if settings.GOOGLE_API_KEY else None,
    }


@app.get("/debug/storage")
async def debug_storage():
    """Debug endpoint to check S3 configuration (dev only)."""
    if settings.APP_MODE != AppMode.DEV:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return {
        "storage_backend": settings.STORAGE_BACKEND,
        "s3_bucket": settings.S3_BUCKET or settings.BUCKET_NAME or "<not set>",
        "s3_region": settings.S3_REGION or settings.AWS_REGION or "<not set>",
        "s3_endpoint": settings.S3_ENDPOINT_URL
        or settings.BUCKET_ENDPOINT
        or "<not set>",
        "has_access_key": bool(settings.S3_ACCESS_KEY_ID or settings.AWS_ACCESS_KEY_ID),
        "has_secret_key": bool(
            settings.S3_SECRET_ACCESS_KEY or settings.AWS_SECRET_ACCESS_KEY
        ),
    }


@app.get("/api/v1/info")
async def api_info():
    """API information endpoint."""
    return {
        "name": "Yoga Pose Platform",
        "version": "1.0.0",
        "api_version": "v1",
        "mode": settings.APP_MODE.value,
        "features": {
            "ai_generation": True,
            "pose_management": True,
            "muscle_mapping": True,
            "layer_visualization": True,
        },
        "endpoints": {
            "poses": "/api/v1/poses",
            "categories": "/api/v1/categories",
            "muscles": "/api/v1/muscles",
            "generate": "/api/v1/generate",
            "analytics": "/api/v1/analytics",
            "sequences": "/api/v1/sequences",
            "export": "/api/v1/export",
            "import": "/api/v1/import",
            "compare": "/api/v1/compare",
            "auth": "/api/v1/auth",
        },
        "deprecated_endpoints": {
            "note": "The /api/ prefix (without v1) is deprecated and will be removed in a future version",
        },
    }


# Backward compatibility - deprecated endpoint
@app.get("/api/info", deprecated=True)
async def api_info_deprecated():
    """API information endpoint (deprecated - use /api/v1/info)."""
    return await api_info()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=(settings.APP_MODE == AppMode.DEV),
    )
