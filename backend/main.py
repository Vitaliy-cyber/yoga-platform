import logging
from contextlib import asynccontextmanager

from api.routes import auth, categories, generate, muscles, poses
from config import AppMode, get_settings
from db.database import init_db
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
    logger.info("Shutting down Yoga Platform...")


# Створення FastAPI додатку
app = FastAPI(
    title="Yoga Pose Platform",
    description="Платформа для йога-студії з AI генерацією зображень поз",
    version="1.0.0",
    lifespan=lifespan,
    debug=(settings.APP_MODE == AppMode.DEV),
)

# CORS middleware
allow_credentials = "*" not in settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files для завантажених та згенерованих зображень (лише для local storage)
if settings.STORAGE_BACKEND == "local":
    import os
    from pathlib import Path

    # Create storage directory for local uploads
    storage_dir = Path(__file__).parent / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")

# API Routes
app.include_router(auth.router)
app.include_router(poses.router)
app.include_router(generate.router)
app.include_router(categories.router)
app.include_router(muscles.router)


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


@app.get("/api/info")
async def api_info():
    """Інформація про API"""
    return {
        "name": "Yoga Pose Platform",
        "version": "1.0.0",
        "mode": settings.APP_MODE.value,
        "features": {
            "ai_generation": True,
            "pose_management": True,
            "muscle_mapping": True,
            "layer_visualization": True,
        },
        "endpoints": {
            "poses": "/api/poses",
            "categories": "/api/categories",
            "muscles": "/api/muscles",
            "generate": "/api/generate",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=(settings.APP_MODE == AppMode.DEV),
    )
