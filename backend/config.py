import logging
import warnings
from enum import Enum
from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings


logger = logging.getLogger(__name__)


# Default insecure secret key - MUST be changed in production
_DEFAULT_INSECURE_SECRET_KEY = "your-secret-key-here-change-in-production"


class AppMode(str, Enum):
    DEV = "dev"
    PROD = "prod"


class Settings(BaseSettings):
    # Application mode - defaults to DEV for safety
    # SECURITY: In production, explicitly set APP_MODE=prod
    APP_MODE: AppMode = AppMode.DEV

    # Debug mode - MUST be False in production
    # SECURITY: Debug mode exposes sensitive information in error responses
    DEBUG: bool = False

    # Database (SQLite default for dev, use PostgreSQL in production)
    DATABASE_URL: str = "sqlite+aiosqlite:///./yoga_platform.db"

    # Server configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # JWT Configuration
    # SECURITY: SECRET_KEY has no secure default - MUST be set via environment variable
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(64))"
    SECRET_KEY: str = _DEFAULT_INSECURE_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 minutes for access tokens
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # 7 days for refresh tokens
    JWT_ISSUER: str = "yoga-platform"
    JWT_AUDIENCE: str = "yoga-platform-users"

    # Rate Limiting
    # Note: These are default values. In DEV mode, auth limit is increased
    # to support E2E testing without hitting rate limits.
    RATE_LIMIT_GLOBAL: int = 100  # requests per minute per IP
    RATE_LIMIT_AUTH: int = 10  # requests per minute per IP for auth endpoints (production)
    RATE_LIMIT_GENERATE: int = 5  # requests per minute per user for generate endpoints
    RATE_LIMIT_WINDOW: int = 60  # window in seconds

    @property
    def effective_rate_limit_auth(self) -> int:
        """Get effective auth rate limit based on app mode."""
        # In DEV mode, allow more auth requests for E2E testing
        if self.APP_MODE == AppMode.DEV:
            return 100  # 100 requests per minute in dev
        return self.RATE_LIMIT_AUTH

    @property
    def effective_access_token_expire_minutes(self) -> int:
        """Get effective access token expiry time based on app mode."""
        # In DEV mode, use longer token expiry for E2E testing
        if self.APP_MODE == AppMode.DEV:
            return 60  # 60 minutes in dev for longer test runs
        return self.ACCESS_TOKEN_EXPIRE_MINUTES

    # Redis URL for rate limiting persistence (optional, in-memory used if not set)
    # IMPORTANT: For production with multiple instances, set this to enable persistent rate limiting
    REDIS_URL: Optional[str] = None

    # Trusted proxy networks (comma-separated CIDR notation)
    # Example: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    # SECURITY: Only IPs from these networks are trusted to set X-Forwarded-For headers
    TRUSTED_PROXIES: Optional[str] = None

    # Storage backend: "local" for dev, "s3" for production
    STORAGE_BACKEND: str = "local"

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
        """
        Get allowed CORS origins.

        SECURITY: In production, never return ["*"] as this allows any origin
        to make authenticated requests. Always configure CORS_ALLOWED_ORIGINS
        explicitly in production.
        """
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

        # SECURITY FIX: In production, require explicit CORS configuration
        # Never return ["*"] which would allow any origin
        if not origins:
            if self.APP_MODE == AppMode.PROD:
                # In production without explicit origins, return empty list
                # This effectively disables CORS (no cross-origin requests allowed)
                logger.warning(
                    "SECURITY WARNING: No CORS_ALLOWED_ORIGINS configured in production. "
                    "Cross-origin requests will be blocked. "
                    "Set CORS_ALLOWED_ORIGINS environment variable to allow specific origins."
                )
                return []
            else:
                # In development, allow localhost by default
                return [
                    "http://localhost:3000",
                    "http://localhost:5173",
                    "http://127.0.0.1:3000",
                    "http://127.0.0.1:5173",
                ]

        return origins

    @property
    def LOG_LEVEL(self) -> str:
        return "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra env variables


def _validate_settings(settings: Settings) -> Settings:
    """
    Validate settings and warn/error on security issues.

    SECURITY: This function ensures critical security settings are properly
    configured in production environments.
    """
    # Check SECRET_KEY in production
    if settings.APP_MODE == AppMode.PROD:
        # CRITICAL: Fail fast if using default secret key in production
        if settings.SECRET_KEY == _DEFAULT_INSECURE_SECRET_KEY:
            error_msg = (
                "CRITICAL SECURITY ERROR: Default SECRET_KEY is being used in production! "
                "This is a serious security vulnerability. "
                "Set a strong, unique SECRET_KEY environment variable. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )
            logger.critical(error_msg)
            raise ValueError(error_msg)

        # CRITICAL: Fail fast if DEBUG is enabled in production
        if settings.DEBUG:
            error_msg = (
                "CRITICAL SECURITY ERROR: DEBUG=True in production! "
                "Debug mode exposes sensitive information in error responses. "
                "Set DEBUG=False or remove the DEBUG environment variable."
            )
            logger.critical(error_msg)
            raise ValueError(error_msg)

        # Warn if SECRET_KEY appears to be weak (less than 32 characters)
        if len(settings.SECRET_KEY) < 32:
            warnings.warn(
                "SECRET_KEY appears to be weak (less than 32 characters). "
                "Consider using a longer, more random key for production.",
                SecurityWarning,
                stacklevel=2,
            )

        # Warn if TRUSTED_PROXIES is not configured but likely behind a proxy
        if not settings.TRUSTED_PROXIES:
            logger.warning(
                "TRUSTED_PROXIES not configured in production. "
                "If behind a reverse proxy, rate limiting may not work correctly. "
                "Set TRUSTED_PROXIES to your proxy's IP range."
            )

        # Warn if REDIS_URL is not configured (rate limiting won't be process-safe)
        if not settings.REDIS_URL:
            logger.warning(
                "REDIS_URL not configured in production. "
                "In-memory rate limiting is NOT process-safe with multiple workers. "
                "Set REDIS_URL for reliable rate limiting across workers."
            )

    return settings


class SecurityWarning(UserWarning):
    """Warning for security-related configuration issues."""
    pass


@lru_cache()
def get_settings() -> Settings:
    """
    Get application settings (cached).

    This function validates settings on first access and raises errors
    for critical security misconfigurations in production.
    """
    settings = Settings()
    return _validate_settings(settings)
