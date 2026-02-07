import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Optional, Protocol

from config import get_settings
logger = logging.getLogger(__name__)

# Presigned URL expiration time (7 days in seconds)
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60


class StorageBackend(Protocol):
    """Protocol for storage backends."""

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes and return URL."""
        ...

    async def download_bytes(self, url_or_path: str) -> bytes:
        """Download file and return bytes."""
        ...

    def get_presigned_url(
        self, key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Get URL for existing file."""
        ...


class LocalStorage:
    """Local filesystem storage for development."""

    _instance: Optional["LocalStorage"] = None

    def __new__(cls) -> "LocalStorage":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance

    @classmethod
    def get_instance(cls) -> "LocalStorage":
        return cls()

    def _initialize(self) -> None:
        # Base directory for uploads (relative to backend folder)
        self.base_dir = Path(__file__).parent.parent / "storage"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info("Local storage initialized at %s", self.base_dir)

    def _validate_within_base_dir(self, file_path: Path) -> None:
        base_dir_resolved = self.base_dir.resolve()
        resolved_path = file_path.resolve()
        try:
            resolved_path.relative_to(base_dir_resolved)
        except ValueError:
            raise ValueError("Invalid path: path traversal attempt detected")

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes to local filesystem."""
        key = key.lstrip("/")
        file_path = self.base_dir / key

        # SECURITY: Validate path to prevent directory traversal attacks
        self._validate_within_base_dir(file_path)

        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(data)

        logger.info("Saved file locally: %s", file_path)
        # Return relative URL that will be served by FastAPI
        return f"/storage/{key}"

    async def download_bytes(self, url_or_path: str) -> bytes:
        """Download file from local filesystem."""
        # Remove /storage/ prefix if present
        path = url_or_path.lstrip("/")
        if path.startswith("storage/"):
            path = path[8:]

        file_path = self.base_dir / path

        # SECURITY: Validate path to prevent directory traversal attacks
        self._validate_within_base_dir(file_path)

        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        return file_path.read_bytes()

    def get_presigned_url(
        self, key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Get URL for local file (just returns the path)."""
        key = key.lstrip("/")
        # Remove /storage/ prefix if present
        if key.startswith("storage/"):
            key = key[8:]
        self._validate_within_base_dir(self.base_dir / key)
        return f"/storage/{key}"


def get_storage() -> StorageBackend:
    """Get the appropriate storage backend based on settings."""
    settings = get_settings()
    if settings.STORAGE_BACKEND == "local":
        return LocalStorage.get_instance()
    return S3Storage.get_instance()


try:
    import boto3
    from botocore.config import Config

    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False
    boto3 = None  # type: ignore
    Config = None  # type: ignore


class S3Storage:
    """S3 storage service for uploading images.

    Supports:
    - AWS S3
    - Railway Object Storage
    - Cloudflare R2
    - MinIO
    - Any S3-compatible storage

    Uses presigned URLs for private buckets.
    """

    _instance: Optional["S3Storage"] = None

    def __new__(cls) -> "S3Storage":
        if not HAS_BOTO3:
            raise RuntimeError(
                "boto3 is required for S3 storage. Install it with: pip install boto3"
            )
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialize()
        return cls._instance

    @classmethod
    def get_instance(cls) -> "S3Storage":
        return cls()

    def _initialize(self) -> None:
        settings = get_settings()
        if settings.STORAGE_BACKEND != "s3":
            raise RuntimeError("S3 storage backend is not enabled")

        def _string_setting(name: str, default: str = "") -> str:
            value = getattr(settings, name, default)
            return value if isinstance(value, str) else default

        # Support both standard S3 and Railway Object Storage variable names
        self.bucket = _string_setting("S3_BUCKET") or _string_setting("BUCKET_NAME")

        if not self.bucket:
            raise RuntimeError("S3_BUCKET is required")

        prefix_value = _string_setting("S3_PREFIX")
        self.prefix = prefix_value.strip("/") if prefix_value else ""

        # Get credentials (support both naming conventions)
        access_key = _string_setting("S3_ACCESS_KEY_ID") or _string_setting("AWS_ACCESS_KEY_ID")
        secret_key = _string_setting("S3_SECRET_ACCESS_KEY") or _string_setting("AWS_SECRET_ACCESS_KEY")
        self.region = _string_setting("S3_REGION") or _string_setting("AWS_REGION") or "us-east-1"

        # Get endpoint URL (for Railway, R2, MinIO etc.)
        endpoint_url = _string_setting("S3_ENDPOINT_URL") or _string_setting("BUCKET_ENDPOINT")
        self.endpoint_url = endpoint_url or None
        # Public URL for presigned URLs (MinIO in Docker: internal URL != public URL)
        public_url = _string_setting("S3_PUBLIC_URL")
        self.public_url = public_url or None

        if self.public_url:
            self.public_base_url = self.public_url.rstrip("/")
        else:
            region = self.region or "us-east-1"
            if region == "us-east-1":
                self.public_base_url = f"https://{self.bucket}.s3.amazonaws.com"
            else:
                self.public_base_url = (
                    f"https://{self.bucket}.s3.{region}.amazonaws.com"
                )

        # Build S3 client with signature version for compatibility
        client_kwargs = {
            "aws_access_key_id": access_key or None,
            "aws_secret_access_key": secret_key or None,
            "region_name": self.region,
            "config": Config(signature_version="s3v4"),
        }

        if self.endpoint_url:
            client_kwargs["endpoint_url"] = self.endpoint_url

        self.client = boto3.client("s3", **client_kwargs)

        logger.info(
            "S3 storage initialized (bucket=%s, prefix=%s, endpoint=%s)",
            self.bucket,
            self.prefix or "<none>",
            self.endpoint_url or "AWS S3",
        )

    def _build_key(self, key: str) -> str:
        key = key.lstrip("/")
        if self.prefix:
            return f"{self.prefix}/{key}"
        return key

    def _build_public_url(self, key: str) -> str:
        s3_key = key.lstrip("/")
        if self.prefix and not s3_key.startswith(f"{self.prefix}/"):
            s3_key = self._build_key(s3_key)
        return f"{self.public_base_url}/{s3_key}"

    def _generate_presigned_url(
        self, s3_key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Generate a presigned URL for accessing a private S3 object."""
        try:
            url = self.client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": s3_key,
                },
                ExpiresIn=expiration,
            )
            # Replace internal endpoint with public URL (for MinIO in Docker)
            if self.public_url and self.endpoint_url:
                url = url.replace(self.endpoint_url, self.public_url)
            return url
        except Exception as e:
            logger.error("Failed to generate presigned URL: %s", str(e))
            raise

    async def _run_blocking(self, fn, *args, **kwargs):
        """
        Run a blocking SDK call.

        In pytest we avoid creating executor threads to prevent intermittent
        loop teardown hangs on Python 3.14.
        """
        if "pytest" in sys.modules:
            return fn(*args, **kwargs)
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes to S3 and return a public URL for access."""
        s3_key = self._build_key(key)
        params = {
            "Bucket": self.bucket,
            "Key": s3_key,
            "Body": data,
            "ContentType": content_type,
        }

        try:
            logger.info(
                "Uploading to S3: bucket=%s, key=%s, endpoint=%s",
                self.bucket,
                s3_key,
                self.endpoint_url,
            )
            await self._run_blocking(self.client.put_object, **params)

            url = self._build_public_url(key)
            logger.info("Upload successful, public URL generated")
            return url
        except Exception as e:
            logger.error(
                "S3 upload failed: bucket=%s, key=%s, endpoint=%s, error=%s",
                self.bucket,
                s3_key,
                self.endpoint_url,
                str(e),
            )
            raise

    async def download_bytes(self, url_or_path: str) -> bytes:
        """Download file from S3."""
        import urllib.parse

        # If it's a presigned URL, extract the key
        if url_or_path.startswith("http"):
            parsed = urllib.parse.urlparse(url_or_path)
            # Extract key from path, removing bucket name if present
            path = parsed.path.lstrip("/")
            if path.startswith(self.bucket + "/"):
                path = path[len(self.bucket) + 1 :]
            s3_key = path
        else:
            # It's a path/key
            s3_key = self._build_key(url_or_path)

        try:
            logger.info("Downloading from S3: bucket=%s, key=%s", self.bucket, s3_key)
            response = await self._run_blocking(
                self.client.get_object,
                Bucket=self.bucket,
                Key=s3_key,
            )
            data = response["Body"].read()
            logger.info("Download successful: %d bytes", len(data))
            return data
        except Exception as e:
            logger.error(
                "S3 download failed: bucket=%s, key=%s, error=%s",
                self.bucket,
                s3_key,
                str(e),
            )
            raise

    def get_presigned_url(
        self, key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Get a presigned URL for an existing S3 object."""
        s3_key = self._build_key(key) if not key.startswith(self.prefix) else key
        return self._generate_presigned_url(s3_key, expiration)
