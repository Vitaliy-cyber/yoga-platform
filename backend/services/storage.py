import asyncio
import logging
from typing import Optional

import boto3

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class S3Storage:
    """S3 storage service for uploading images."""

    _instance: Optional["S3Storage"] = None

    def __new__(cls) -> "S3Storage":
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

        if not settings.S3_BUCKET:
            raise RuntimeError("S3_BUCKET is required when using S3 storage")

        self.bucket = settings.S3_BUCKET
        self.prefix = settings.S3_PREFIX.strip("/")
        self.public_base_url = self._resolve_public_base_url()

        self.client = boto3.client(
            "s3",
            aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None,
            region_name=settings.S3_REGION or None,
        )

        logger.info(
            "S3 storage initialized (bucket=%s, prefix=%s)",
            self.bucket,
            self.prefix or "<none>",
        )

    def _resolve_public_base_url(self) -> str:
        region = settings.S3_REGION.strip()
        if not region or region == "us-east-1":
            return f"https://{settings.S3_BUCKET}.s3.amazonaws.com"
        return f"https://{settings.S3_BUCKET}.s3.{region}.amazonaws.com"

    def _build_key(self, key: str) -> str:
        key = key.lstrip("/")
        if self.prefix:
            return f"{self.prefix}/{key}"
        return key

    def _build_public_url(self, key: str) -> str:
        return f"{self.public_base_url}/{key}"

    async def upload_bytes(self, data: bytes, key: str, content_type: str) -> str:
        s3_key = self._build_key(key)
        params = {
            "Bucket": self.bucket,
            "Key": s3_key,
            "Body": data,
            "ContentType": content_type,
        }

        await asyncio.to_thread(self.client.put_object, **params)
        return self._build_public_url(s3_key)
