import asyncio
import logging
import os
from pathlib import Path
from typing import Optional, Protocol

import aiofiles

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Presigned URL expiration time (7 days in seconds)
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60


class StorageBackend(Protocol):
    """Protocol for storage backends."""

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes and return URL."""
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

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes to local filesystem."""
        key = key.lstrip("/")
        file_path = self.base_dir / key
        file_path.parent.mkdir(parents=True, exist_ok=True)

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(data)

        logger.info("Saved file locally: %s", file_path)
        # Return relative URL that will be served by FastAPI
        return f"/storage/{key}"

    def get_presigned_url(
        self, key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Get URL for local file (just returns the path)."""
        key = key.lstrip("/")
        # Remove /storage/ prefix if present
        if key.startswith("storage/"):
            key = key[8:]
        return f"/storage/{key}"


def get_storage() -> StorageBackend:
    """Get the appropriate storage backend based on settings."""
    if settings.STORAGE_BACKEND == "local":
        return LocalStorage.get_instance()
    else:
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
        if settings.STORAGE_BACKEND != "s3":
            raise RuntimeError("S3 storage backend is not enabled")

        # Support both standard S3 and Railway Object Storage variable names
        self.bucket = settings.S3_BUCKET or settings.BUCKET_NAME

        if not self.bucket:
            raise RuntimeError(
                "S3_BUCKET or BUCKET_NAME is required when using S3 storage"
            )

        self.prefix = settings.S3_PREFIX.strip("/") if settings.S3_PREFIX else ""

        # Get credentials (support both naming conventions)
        access_key = settings.S3_ACCESS_KEY_ID or settings.AWS_ACCESS_KEY_ID
        secret_key = settings.S3_SECRET_ACCESS_KEY or settings.AWS_SECRET_ACCESS_KEY
        self.region = settings.S3_REGION or settings.AWS_REGION or "us-east-1"

        # Get endpoint URL (for Railway, R2, MinIO etc.)
        self.endpoint_url = settings.S3_ENDPOINT_URL or settings.BUCKET_ENDPOINT or None

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
            return url
        except Exception as e:
            logger.error("Failed to generate presigned URL: %s", str(e))
            raise

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes to S3 and return a presigned URL for access."""
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
            await asyncio.to_thread(self.client.put_object, **params)

            # Return presigned URL instead of direct URL
            url = self._generate_presigned_url(s3_key)
            logger.info("Upload successful, presigned URL generated")
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

    def get_presigned_url(
        self, key: str, expiration: int = PRESIGNED_URL_EXPIRATION
    ) -> str:
        """Get a presigned URL for an existing S3 object."""
        s3_key = self._build_key(key) if not key.startswith(self.prefix) else key
        return self._generate_presigned_url(s3_key, expiration)
