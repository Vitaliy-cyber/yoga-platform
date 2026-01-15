from enum import Enum
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings


class AppMode(str, Enum):
    DEV = "dev"
    PROD = "prod"


class Settings(BaseSettings):
    # Режим роботи
    APP_MODE: AppMode = AppMode.DEV

    # База даних (SQLite за замовчуванням для dev)
    DATABASE_URL: str = "sqlite+aiosqlite:///./yoga_platform.db"

    # Сервер
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # JWT
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Storage backend (S3 only for production)
    STORAGE_BACKEND: str = "s3"

    # S3 storage paths (prefixes)
    UPLOAD_DIR: str = "uploads"
    GENERATED_DIR: str = "generated"
    LAYERS_DIR: str = "layers"

    # S3 settings (used when STORAGE_BACKEND="s3")
    # Standard AWS S3 settings
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_PREFIX: str = ""
    # S3 endpoint (for Railway, Cloudflare R2, MinIO, etc.)
    S3_ENDPOINT_URL: str = ""

    # Railway Object Storage (alternative names)
    BUCKET_NAME: str = ""  # Railway uses this
    BUCKET_ENDPOINT: str = ""  # Railway uses this
    AWS_ACCESS_KEY_ID: str = ""  # Railway uses this
    AWS_SECRET_ACCESS_KEY: str = ""  # Railway uses this
    AWS_REGION: str = ""  # Railway uses this

    # Google Gemini API (AI generation is always enabled)
    GOOGLE_API_KEY: str = ""

    # CORS - додаткові origins для Railway та інших платформ
    CORS_ALLOWED_ORIGINS: str = ""  # Comma-separated list of allowed origins

    @property
    def CORS_ORIGINS(self) -> List[str]:
        # Базові origins для dev
        origins = []

        if self.APP_MODE == AppMode.DEV:
            origins = [
                "http://localhost:3000",
                "http://localhost:5173",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:5173",
            ]

        # Додати кастомні origins з env змінної
        if self.CORS_ALLOWED_ORIGINS:
            custom_origins = [
                o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()
            ]
            origins.extend(custom_origins)

        # Якщо немає origins і це production, дозволити все (Railway)
        if not origins and self.APP_MODE == AppMode.PROD:
            return ["*"]

        return origins if origins else ["*"]

    @property
    def LOG_LEVEL(self) -> str:
        return "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra env variables


@lru_cache()
def get_settings() -> Settings:
    return Settings()
