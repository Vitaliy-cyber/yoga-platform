"""
Tests for S3 Storage Service.
"""

import pytest
from unittest.mock import MagicMock, patch
from io import BytesIO


class TestS3StorageInitialization:
    """Tests for S3Storage initialization and configuration."""

    def test_s3_storage_requires_s3_backend(self):
        """Test that S3Storage raises error when storage backend is not s3."""
        with patch("services.storage.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(STORAGE_BACKEND="local")

            # Reset singleton
            from services.storage import S3Storage

            S3Storage._instance = None

            with pytest.raises(RuntimeError, match="S3 storage backend is not enabled"):
                S3Storage()

    def test_s3_storage_requires_bucket(self):
        """Test that S3Storage raises error when S3_BUCKET is not set."""
        with patch("services.storage.get_settings") as mock_settings:
            settings = MagicMock()
            settings.STORAGE_BACKEND = "s3"
            settings.S3_BUCKET = ""
            mock_settings.return_value = settings

            from services.storage import S3Storage

            S3Storage._instance = None

            with pytest.raises(RuntimeError, match="S3_BUCKET is required"):
                S3Storage()

    def test_s3_storage_singleton_pattern(self):
        """Test that S3Storage follows singleton pattern."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                instance1 = S3Storage()
                instance2 = S3Storage()

                assert instance1 is instance2

    def test_get_instance_returns_singleton(self):
        """Test get_instance class method returns singleton."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = "prefix"
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                instance = S3Storage.get_instance()

                assert instance is not None
                assert instance.bucket == "test-bucket"
                assert instance.prefix == "prefix"


class TestS3StorageUrlBuilding:
    """Tests for URL building methods."""

    @pytest.fixture
    def storage_instance(self):
        """Create a mocked S3Storage instance for testing."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "my-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = "yoga"
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                yield S3Storage()
                S3Storage._instance = None

    def test_build_key_with_prefix(self, storage_instance):
        """Test key building with prefix."""
        key = storage_instance._build_key("uploads/test.png")
        assert key == "yoga/uploads/test.png"

    def test_build_key_strips_leading_slash(self, storage_instance):
        """Test key building strips leading slashes."""
        key = storage_instance._build_key("/uploads/test.png")
        assert key == "yoga/uploads/test.png"

    def test_build_key_without_prefix(self):
        """Test key building without prefix."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "my-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                key = storage._build_key("uploads/test.png")
                assert key == "uploads/test.png"
                S3Storage._instance = None

    def test_public_url_us_east_1(self):
        """Test public URL for us-east-1 region."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "my-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                assert storage.public_base_url == "https://my-bucket.s3.amazonaws.com"
                S3Storage._instance = None

    def test_public_url_other_region(self):
        """Test public URL for other regions."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "my-bucket"
                settings.S3_REGION = "eu-west-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                assert (
                    storage.public_base_url
                    == "https://my-bucket.s3.eu-west-1.amazonaws.com"
                )
                S3Storage._instance = None

    def test_build_public_url(self, storage_instance):
        """Test building complete public URL."""
        url = storage_instance._build_public_url("yoga/uploads/test.png")
        assert url == "https://my-bucket.s3.amazonaws.com/yoga/uploads/test.png"


class TestS3StorageUpload:
    """Tests for upload functionality."""

    @pytest.mark.asyncio
    async def test_upload_bytes_success(self):
        """Test successful byte upload to S3."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                # Setup mock settings
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = "yoga"
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                # Setup mock S3 client
                mock_client = MagicMock()
                mock_boto3.client.return_value = mock_client

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()

                # Test upload
                test_data = b"test image content"
                result = await storage.upload_bytes(
                    test_data, "uploads/photo.png", "image/png"
                )

                # Verify put_object was called (via asyncio.to_thread)
                assert "test-bucket.s3.amazonaws.com" in result
                assert "yoga/uploads/photo.png" in result

                S3Storage._instance = None

    @pytest.mark.asyncio
    async def test_upload_bytes_with_different_content_types(self):
        """Test upload with different content types."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                mock_client = MagicMock()
                mock_boto3.client.return_value = mock_client

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()

                # Test PNG
                await storage.upload_bytes(b"png", "test.png", "image/png")

                # Test JPEG
                await storage.upload_bytes(b"jpeg", "test.jpg", "image/jpeg")

                # Test WebP
                await storage.upload_bytes(b"webp", "test.webp", "image/webp")

                # Verify all upload calls reached S3 client
                assert mock_client.put_object.call_count == 3

                S3Storage._instance = None


class TestS3StorageEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_region_defaults_to_us_east_1_url(self):
        """Test that empty region uses us-east-1 URL format."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = ""
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                assert "s3.amazonaws.com" in storage.public_base_url
                assert ".s3." not in storage.public_base_url.replace(
                    ".s3.amazonaws.com", ""
                )

                S3Storage._instance = None

    def test_prefix_with_slashes_is_cleaned(self):
        """Test that prefix with slashes is properly cleaned."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = "/yoga/platform/"
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                # Prefix should have slashes stripped
                assert storage.prefix == "yoga/platform"

                S3Storage._instance = None

    def test_special_characters_in_key(self):
        """Test handling of special characters in keys."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3"):
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                mock_settings.return_value = settings

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()

                # Test with UUID-like filename
                key = storage._build_key(
                    "uploads/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
                )
                assert key == "uploads/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"

                S3Storage._instance = None

    def test_public_url_without_scheme_is_normalized(self):
        """Public URL host-only values must be upgraded to https://."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                settings.S3_PUBLIC_URL = "cdn.example.com"
                settings.S3_ENDPOINT_URL = "objects.example.com"
                settings.BUCKET_ENDPOINT = ""
                mock_settings.return_value = settings

                mock_client = MagicMock()
                mock_boto3.client.return_value = mock_client

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()

                assert storage.public_url == "https://cdn.example.com"
                assert storage.public_base_url == "https://cdn.example.com"
                assert storage.endpoint_url == "https://objects.example.com"
                assert mock_boto3.client.call_args.kwargs["endpoint_url"] == "https://objects.example.com"

                S3Storage._instance = None

    @pytest.mark.asyncio
    async def test_download_bytes_supports_host_only_legacy_urls(self):
        """Legacy host/path values without scheme should still resolve object key."""
        with patch("services.storage.get_settings") as mock_settings:
            with patch("services.storage.boto3") as mock_boto3:
                settings = MagicMock()
                settings.STORAGE_BACKEND = "s3"
                settings.S3_BUCKET = "test-bucket"
                settings.S3_REGION = "us-east-1"
                settings.S3_PREFIX = ""
                settings.S3_ACCESS_KEY_ID = "key"
                settings.S3_SECRET_ACCESS_KEY = "secret"
                settings.S3_PUBLIC_URL = ""
                settings.S3_ENDPOINT_URL = ""
                settings.BUCKET_ENDPOINT = ""
                mock_settings.return_value = settings

                mock_client = MagicMock()
                mock_client.get_object.return_value = {"Body": BytesIO(b"png-bytes")}
                mock_boto3.client.return_value = mock_client

                from services.storage import S3Storage

                S3Storage._instance = None

                storage = S3Storage()
                payload = await storage.download_bytes("cdn.example.com/generated/file.png")

                assert payload == b"png-bytes"
                mock_client.get_object.assert_called_once_with(
                    Bucket="test-bucket",
                    Key="generated/file.png",
                )

                S3Storage._instance = None
