"""
Tests for application configuration.
"""

import pytest
from unittest.mock import patch, MagicMock
import os


class TestAppModeEnum:
    """Tests for AppMode enum."""

    def test_app_mode_values(self):
        """Test AppMode enum has correct values."""
        from config import AppMode

        assert AppMode.DEV.value == "dev"
        assert AppMode.PROD.value == "prod"

    def test_app_mode_from_string(self):
        """Test AppMode can be created from string."""
        from config import AppMode

        assert AppMode("dev") == AppMode.DEV
        assert AppMode("prod") == AppMode.PROD


class TestSettingsDefaults:
    """Tests for Settings default values."""

    def test_default_app_mode(self):
        """Test default app mode is DEV."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings, AppMode

            settings = Settings()
            assert settings.APP_MODE == AppMode.DEV

    def test_default_database_url(self):
        """Test default database URL is SQLite."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert "sqlite" in settings.DATABASE_URL

    def test_default_host_and_port(self):
        """Test default host and port values."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.HOST == "0.0.0.0"
            assert settings.PORT == 8000

    def test_default_storage_backend(self):
        """Test default storage backend is S3."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.STORAGE_BACKEND == "s3"

    def test_default_s3_settings(self):
        """Test default S3 settings."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.S3_BUCKET == ""
            assert settings.S3_REGION == "us-east-1"
            assert settings.S3_PREFIX == ""


class TestSettingsFromEnv:
    """Tests for Settings loading from environment variables."""

    def test_app_mode_from_env(self):
        """Test APP_MODE is loaded from environment."""
        with patch.dict(os.environ, {"APP_MODE": "prod"}, clear=True):
            from config import Settings, AppMode

            settings = Settings()
            assert settings.APP_MODE == AppMode.PROD

    def test_database_url_from_env(self):
        """Test DATABASE_URL is loaded from environment."""
        test_url = "postgresql://user:pass@localhost:5432/db"
        with patch.dict(os.environ, {"DATABASE_URL": test_url}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.DATABASE_URL == test_url

    def test_s3_settings_from_env(self):
        """Test S3 settings are loaded from environment."""
        env_vars = {
            "S3_BUCKET": "my-bucket",
            "S3_REGION": "eu-west-1",
            "S3_ACCESS_KEY_ID": "test-key",
            "S3_SECRET_ACCESS_KEY": "test-secret",
            "S3_PREFIX": "yoga-app",
        }
        with patch.dict(os.environ, env_vars, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.S3_BUCKET == "my-bucket"
            assert settings.S3_REGION == "eu-west-1"
            assert settings.S3_ACCESS_KEY_ID == "test-key"
            assert settings.S3_SECRET_ACCESS_KEY == "test-secret"
            assert settings.S3_PREFIX == "yoga-app"

    def test_google_api_key_from_env(self):
        """Test GOOGLE_API_KEY is loaded from environment."""
        with patch.dict(os.environ, {"GOOGLE_API_KEY": "test-key"}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.GOOGLE_API_KEY == "test-key"


class TestCORSOrigins:
    """Tests for CORS origins configuration."""

    def test_cors_origins_dev_mode(self):
        """Test CORS origins in dev mode."""
        with patch.dict(os.environ, {"APP_MODE": "dev"}, clear=True):
            from config import Settings

            settings = Settings()
            origins = settings.CORS_ORIGINS

            assert "http://localhost:3000" in origins
            assert "http://localhost:5173" in origins

    def test_cors_origins_prod_mode_default(self):
        """Test CORS origins in prod mode with no custom origins."""
        with patch.dict(os.environ, {"APP_MODE": "prod"}, clear=True):
            from config import Settings

            settings = Settings()
            origins = settings.CORS_ORIGINS

            # Production now fails closed: no wildcard fallback.
            assert origins == []

    def test_cors_allowed_origins_custom(self):
        """Test custom CORS_ALLOWED_ORIGINS are added."""
        env_vars = {
            "APP_MODE": "prod",
            "CORS_ALLOWED_ORIGINS": "https://example.com,https://app.example.com",
        }
        with patch.dict(os.environ, env_vars, clear=True):
            from config import Settings

            settings = Settings()
            origins = settings.CORS_ORIGINS

            assert "https://example.com" in origins
            assert "https://app.example.com" in origins

    def test_cors_allowed_origins_with_spaces(self):
        """Test CORS_ALLOWED_ORIGINS handles spaces correctly."""
        env_vars = {
            "APP_MODE": "prod",
            "CORS_ALLOWED_ORIGINS": "https://example.com, https://app.example.com , https://api.example.com",
        }
        with patch.dict(os.environ, env_vars, clear=True):
            from config import Settings

            settings = Settings()
            origins = settings.CORS_ORIGINS

            assert "https://example.com" in origins
            assert "https://app.example.com" in origins
            assert "https://api.example.com" in origins
            # Should not contain spaces
            assert " https://app.example.com" not in origins

    def test_cors_origins_dev_with_custom(self):
        """Test dev mode includes both default and custom origins."""
        env_vars = {
            "APP_MODE": "dev",
            "CORS_ALLOWED_ORIGINS": "https://custom.example.com",
        }
        with patch.dict(os.environ, env_vars, clear=True):
            from config import Settings

            settings = Settings()
            origins = settings.CORS_ORIGINS

            # Should include both dev defaults and custom
            assert "http://localhost:3000" in origins
            assert "https://custom.example.com" in origins


class TestLogLevel:
    """Tests for log level configuration."""

    def test_default_log_level(self):
        """Test default log level is INFO."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.LOG_LEVEL == "INFO"


class TestJWTSettings:
    """Tests for JWT configuration."""

    def test_default_jwt_settings(self):
        """Test default JWT settings."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.ALGORITHM == "HS256"
            assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 30

    def test_secret_key_from_env(self):
        """Test SECRET_KEY is loaded from environment."""
        with patch.dict(os.environ, {"SECRET_KEY": "super-secret"}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.SECRET_KEY == "super-secret"


class TestAISettings:
    """Tests for AI generation settings."""

    def test_ai_enabled_by_default(self):
        """Test AI generation is enabled by default."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.ENABLE_AI_GENERATION is True
            assert settings.USE_GOOGLE_AI is True

    def test_ai_can_be_disabled(self):
        """Test AI generation can be disabled."""
        with patch.dict(os.environ, {"ENABLE_AI_GENERATION": "false"}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.ENABLE_AI_GENERATION is False


class TestProductionSecurityValidation:
    """Production security guardrails."""

    def test_prod_rejects_insecure_secret_placeholder(self):
        with patch.dict(
            os.environ,
            {
                "APP_MODE": "prod",
                "SECRET_KEY": "change-me-in-production",
                "DATABASE_URL": "sqlite+aiosqlite:///./test.db",
            },
            clear=True,
        ):
            import config

            config.get_settings.cache_clear()
            with pytest.raises(ValueError, match="Insecure SECRET_KEY"):
                config.get_settings()

    def test_prod_rejects_short_secret(self):
        with patch.dict(
            os.environ,
            {
                "APP_MODE": "prod",
                "SECRET_KEY": "short-secret",
                "DATABASE_URL": "sqlite+aiosqlite:///./test.db",
            },
            clear=True,
        ):
            import config

            config.get_settings.cache_clear()
            with pytest.raises(ValueError, match="too short"):
                config.get_settings()


class TestGetSettings:
    """Tests for get_settings function."""

    def test_get_settings_returns_settings(self):
        """Test get_settings returns Settings instance."""
        from config import get_settings, Settings

        # Clear cache
        get_settings.cache_clear()

        settings = get_settings()
        assert isinstance(settings, Settings)

    def test_get_settings_is_cached(self):
        """Test get_settings returns cached instance."""
        from config import get_settings

        # Clear cache first
        get_settings.cache_clear()

        settings1 = get_settings()
        settings2 = get_settings()

        assert settings1 is settings2


class TestStoragePaths:
    """Tests for storage path settings."""

    def test_default_storage_paths(self):
        """Test default storage paths."""
        with patch.dict(os.environ, {}, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.UPLOAD_DIR == "uploads"
            assert settings.GENERATED_DIR == "generated"
            assert settings.LAYERS_DIR == "layers"

    def test_custom_storage_paths(self):
        """Test custom storage paths from environment."""
        env_vars = {
            "UPLOAD_DIR": "/data/uploads",
            "GENERATED_DIR": "/data/generated",
            "LAYERS_DIR": "/data/layers",
        }
        with patch.dict(os.environ, env_vars, clear=True):
            from config import Settings

            settings = Settings()
            assert settings.UPLOAD_DIR == "/data/uploads"
            assert settings.GENERATED_DIR == "/data/generated"
            assert settings.LAYERS_DIR == "/data/layers"
