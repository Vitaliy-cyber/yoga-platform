"""
Atomic tests for image transfer pipeline hardening.

These tests target MIME normalization, payload validation, and API behavior
for image upload/fetch paths used by generation flows.
"""

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from models.pose import Pose
from models.user import User
from services.image_validation import normalize_image_mime_type, validate_uploaded_image_payload


def _png_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


class TestAtomicImageTransfer:
    """Atomic invariants for image transfer and parsing."""

    def test_atomic_01_normalize_strips_parameters(self):
        assert normalize_image_mime_type("image/png; charset=binary") == "image/png"

    def test_atomic_02_normalize_image_pjpeg_alias(self):
        assert normalize_image_mime_type("image/pjpeg") == "image/jpeg"

    def test_atomic_03_normalize_image_x_png_alias(self):
        assert normalize_image_mime_type("image/x-png") == "image/png"

    def test_atomic_04_normalize_image_x_webp_alias(self):
        assert normalize_image_mime_type("image/x-webp") == "image/webp"

    def test_atomic_05_payload_accepts_octet_stream_when_bytes_are_valid(self):
        info = validate_uploaded_image_payload(
            _png_bytes(128, 128), claimed_mime_type="application/octet-stream"
        )
        assert info.mime_type == "image/png"
        assert (info.width, info.height) == (128, 128)

    def test_atomic_06_payload_rejects_empty_or_tiny_content(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(b"", claimed_mime_type="image/png")

    def test_atomic_07_payload_rejects_too_small_dimensions(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(_png_bytes(1, 1), claimed_mime_type="image/png")

    def test_atomic_08_payload_rejects_too_wide_dimensions(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(_png_bytes(9000, 128), claimed_mime_type="image/png")

    def test_atomic_09_payload_rejects_too_tall_dimensions(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(_png_bytes(128, 9000), claimed_mime_type="image/png")

    def test_atomic_10_payload_rejects_too_many_pixels(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(_png_bytes(5000, 5000), claimed_mime_type="image/png")

    def test_atomic_11_payload_rejects_extreme_aspect_ratio(self):
        with pytest.raises(Exception):
            validate_uploaded_image_payload(_png_bytes(2048, 64), claimed_mime_type="image/png")

    def test_atomic_12_payload_uses_sniffed_mime_over_wrong_claim(self):
        info = validate_uploaded_image_payload(
            _png_bytes(128, 96), claimed_mime_type="image/jpeg"
        )
        assert info.mime_type == "image/png"

    @pytest.mark.asyncio
    async def test_atomic_13_generate_accepts_octet_stream_valid_png(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        buffer = BytesIO(_png_bytes(128, 128))
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("schema.bin", buffer, "application/octet-stream")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_atomic_14_generate_accepts_content_type_with_parameters(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        buffer = BytesIO(_png_bytes(128, 128))
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("schema.png", buffer, "image/png; charset=binary")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_atomic_15_generate_accepts_pjpeg_alias(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        buffer = BytesIO(_jpeg_bytes(128, 128))
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("schema.jpg", buffer, "image/pjpeg")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_atomic_16_generate_rejects_tiny_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        buffer = BytesIO(_png_bytes(1, 1))
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("tiny.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "too small" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_atomic_17_generate_rejects_extreme_aspect_ratio(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        buffer = BytesIO(_png_bytes(2048, 64))
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("wide.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "aspect ratio" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_atomic_18_pose_schema_upload_accepts_x_png_alias(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "AIMG18", "name": "Atomic Image 18"}
        )
        assert create.status_code == 201
        pose_id = create.json()["id"]

        buffer = BytesIO(_png_bytes(128, 128))
        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("schema.png", buffer, "image/x-png")},
        )
        assert response.status_code == 200
        assert response.json()["schema_path"]

    @pytest.mark.asyncio
    async def test_atomic_19_pose_schema_upload_rejects_tiny_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "AIMG19", "name": "Atomic Image 19"}
        )
        assert create.status_code == 201
        pose_id = create.json()["id"]

        buffer = BytesIO(_png_bytes(1, 1))
        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("tiny.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "too small" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_atomic_20_get_pose_image_content_type_from_bytes_not_extension(
        self, auth_client: AsyncClient, db_session
    ):
        user_result = await db_session.execute(select(User))
        user = user_result.scalar_one()

        pose = Pose(
            user_id=user.id,
            code="AIMG20",
            name="Atomic Image 20",
            schema_path="https://example.com/wrong-extension.jpg",
        )
        db_session.add(pose)
        await db_session.commit()

        storage = MagicMock()
        storage.download_bytes = AsyncMock(return_value=_png_bytes(128, 128))
        with patch("api.routes.poses.get_storage", return_value=storage):
            response = await auth_client.get(f"/api/poses/{pose.id}/image/schema")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/png")
