import logging
from contextlib import asynccontextmanager

from api.routes import categories, generate, muscles, poses
from config import AppMode, get_settings
from db.database import init_db
from fastapi import FastAPI
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

    # Ініціалізація бази даних
    await init_db()
    logger.info("Database initialized")

    logger.info(f"Storage backend: {settings.STORAGE_BACKEND}")

    # Initialize AI Generator (Google Gemini API)
    if settings.ENABLE_AI_GENERATION:
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
    else:
        logger.info("AI generation disabled")

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files для завантажених та згенерованих зображень (лише для local storage)
if settings.STORAGE_BACKEND == "local":
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")
    app.mount(
        "/generated", StaticFiles(directory=settings.GENERATED_DIR), name="generated"
    )
    app.mount("/layers", StaticFiles(directory=settings.LAYERS_DIR), name="layers")

# API Routes
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
        "ai_enabled": settings.ENABLE_AI_GENERATION,
        "ai_provider": "google_gemini" if settings.GOOGLE_API_KEY else None,
    }


@app.get("/api/info")
async def api_info():
    """Інформація про API"""
    return {
        "name": "Yoga Pose Platform",
        "version": "1.0.0",
        "mode": settings.APP_MODE.value,
        "features": {
            "ai_generation": settings.ENABLE_AI_GENERATION,
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
