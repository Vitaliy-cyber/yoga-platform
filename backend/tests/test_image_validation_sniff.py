from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from services.image_validation import sniff_image_mime_type, validate_uploaded_image_payload


def _png_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), "white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), "white")
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _webp_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), "white")
    buf = BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()


def test_sniff_image_mime_type_png():
    # Minimal valid PNG header
    data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
    assert sniff_image_mime_type(data) == "image/png"


def test_sniff_image_mime_type_jpeg():
    data = b"\xff\xd8\xff" + b"\x00" * 20
    assert sniff_image_mime_type(data) == "image/jpeg"


def test_sniff_image_mime_type_webp():
    # RIFF....WEBP
    data = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 20
    assert sniff_image_mime_type(data) == "image/webp"


def test_sniff_image_mime_type_unknown():
    assert sniff_image_mime_type(b"not-an-image") is None
    assert sniff_image_mime_type(b"") is None


def test_validate_uploaded_image_payload_accepts_octet_stream_with_valid_png():
    info = validate_uploaded_image_payload(
        _png_bytes(128, 128),
        claimed_mime_type="application/octet-stream",
    )
    assert info.mime_type == "image/png"
    assert info.width == 128
    assert info.height == 128


def test_validate_uploaded_image_payload_accepts_claimed_mime_mismatch_when_bytes_valid():
    info = validate_uploaded_image_payload(
        _png_bytes(128, 96),
        claimed_mime_type="image/jpeg",
    )
    assert info.mime_type == "image/png"
    assert info.width == 128
    assert info.height == 96


def test_validate_uploaded_image_payload_rejects_tiny_images():
    with pytest.raises(HTTPException) as exc:
        validate_uploaded_image_payload(_png_bytes(1, 1), claimed_mime_type="image/png")
    assert exc.value.status_code == 400
    assert "too small" in str(exc.value.detail).lower()


def test_validate_uploaded_image_payload_rejects_extreme_aspect_ratio():
    with pytest.raises(HTTPException) as exc:
        validate_uploaded_image_payload(_png_bytes(2048, 64), claimed_mime_type="image/png")
    assert exc.value.status_code == 400
    assert "aspect ratio" in str(exc.value.detail).lower()


def test_validate_uploaded_image_payload_rejects_too_large_dimensions():
    with pytest.raises(HTTPException) as exc:
        validate_uploaded_image_payload(_png_bytes(9000, 120), claimed_mime_type="image/png")
    assert exc.value.status_code == 400
    assert "too large" in str(exc.value.detail).lower()


def test_validate_uploaded_image_payload_rejects_too_many_pixels():
    with pytest.raises(HTTPException) as exc:
        validate_uploaded_image_payload(_png_bytes(5000, 5000), claimed_mime_type="image/png")
    assert exc.value.status_code == 400
    assert "too many pixels" in str(exc.value.detail).lower()


def test_validate_uploaded_image_payload_accepts_mime_with_parameters():
    info = validate_uploaded_image_payload(
        _png_bytes(128, 128),
        claimed_mime_type="image/png; charset=binary",
    )
    assert info.mime_type == "image/png"


def test_validate_uploaded_image_payload_accepts_alias_image_pjpeg():
    info = validate_uploaded_image_payload(
        _jpeg_bytes(128, 128),
        claimed_mime_type="image/pjpeg",
    )
    assert info.mime_type == "image/jpeg"


def test_validate_uploaded_image_payload_accepts_alias_image_x_png():
    info = validate_uploaded_image_payload(
        _png_bytes(128, 128),
        claimed_mime_type="image/x-png",
    )
    assert info.mime_type == "image/png"


def test_validate_uploaded_image_payload_accepts_alias_image_x_webp():
    info = validate_uploaded_image_payload(
        _webp_bytes(128, 128),
        claimed_mime_type="image/x-webp",
    )
    assert info.mime_type == "image/webp"


def test_validate_uploaded_image_payload_rejects_invalid_magic_despite_image_claim():
    with pytest.raises(HTTPException) as exc:
        validate_uploaded_image_payload(
            b"not-an-image-at-all",
            claimed_mime_type="image/png",
        )
    assert exc.value.status_code == 400
    assert "does not match png format" in str(exc.value.detail).lower()


def test_validate_uploaded_image_payload_accepts_jpeg_when_claimed_jpg_alias():
    info = validate_uploaded_image_payload(
        _jpeg_bytes(128, 128),
        claimed_mime_type="image/jpg",
    )
    assert info.mime_type == "image/jpeg"


def test_validate_uploaded_image_payload_accepts_uppercase_mime():
    info = validate_uploaded_image_payload(
        _png_bytes(128, 128),
        claimed_mime_type=" IMAGE/PNG ",
    )
    assert info.mime_type == "image/png"
