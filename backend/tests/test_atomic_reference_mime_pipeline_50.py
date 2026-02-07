"""
Atomic tests for Gemini reference MIME normalization and fallback behavior.
"""

from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from services.google_generator import GoogleGeminiGenerator


REFERENCE_MIME_CASES = [
    ("atomic_ref_001", "image/jpg", "image/jpeg"),
    ("atomic_ref_002", "IMAGE/JPG", "image/jpeg"),
    ("atomic_ref_003", "image/jpg; charset=binary", "image/jpeg"),
    ("atomic_ref_004", '"image/jpg"', "image/jpeg"),
    ("atomic_ref_005", "'image/jpg'", "image/jpeg"),
    ("atomic_ref_006", "image/pjpeg", "image/jpeg"),
    ("atomic_ref_007", "IMAGE/PJPEG", "image/jpeg"),
    ("atomic_ref_008", "image/pjpeg; charset=UTF-8", "image/jpeg"),
    ("atomic_ref_009", "image/x-jpg", "image/jpeg"),
    ("atomic_ref_010", "image/x-jpeg", "image/jpeg"),
    ("atomic_ref_011", "image/x-pjpeg", "image/jpeg"),
    ("atomic_ref_012", "image/jpe", "image/jpeg"),
    ("atomic_ref_013", "image/jfif", "image/jpeg"),
    ("atomic_ref_014", "image/x-jfif", "image/jpeg"),
    ("atomic_ref_015", "image/pipeg", "image/jpeg"),
    ("atomic_ref_016", "image/jpeg", "image/jpeg"),
    ("atomic_ref_017", " IMAGE/JPEG ", "image/jpeg"),
    ("atomic_ref_018", "image/jpeg;name=test.jpg", "image/jpeg"),
    ("atomic_ref_019", '" image/jpeg "', "image/jpeg"),
    ("atomic_ref_020", "image/jpg,image/png", "image/jpeg"),
    ("atomic_ref_021", "image/png", "image/png"),
    ("atomic_ref_022", " IMAGE/PNG ", "image/png"),
    ("atomic_ref_023", "image/png; charset=binary", "image/png"),
    ("atomic_ref_024", '"image/png"', "image/png"),
    ("atomic_ref_025", "'image/png'", "image/png"),
    ("atomic_ref_026", "image/x-png", "image/png"),
    ("atomic_ref_027", "image/x-citrix-png", "image/png"),
    ("atomic_ref_028", "image/apng", "image/png"),
    ("atomic_ref_029", "image/vnd.mozilla.apng", "image/png"),
    ("atomic_ref_030", "image/png ,image/*", "image/png"),
    ("atomic_ref_031", "image/webp", "image/webp"),
    ("atomic_ref_032", "IMAGE/WEBP", "image/webp"),
    ("atomic_ref_033", "image/webp; charset=binary", "image/webp"),
    ("atomic_ref_034", '"image/webp"', "image/webp"),
    ("atomic_ref_035", "image/x-webp", "image/webp"),
    ("atomic_ref_036", "image/x-citrix-webp", "image/webp"),
    ("atomic_ref_037", "image/x-webp; q=1", "image/webp"),
    ("atomic_ref_038", "\"'image/pjpeg'\"", "image/jpeg"),
    ("atomic_ref_039", "image/png, image/*", "image/png"),
    ("atomic_ref_040", "image/jpeg, image/*", "image/jpeg"),
    ("atomic_ref_041", "application/octet-stream", "image/png"),
    ("atomic_ref_042", "text/plain", "image/png"),
    ("atomic_ref_043", "application/json", "image/png"),
    ("atomic_ref_044", "multipart/form-data", "image/png"),
    ("atomic_ref_045", "image/gif", "image/png"),
    ("atomic_ref_046", "image/heic", "image/png"),
    ("atomic_ref_047", "image/heif", "image/png"),
    ("atomic_ref_048", "audio/mpeg", "image/png"),
    ("atomic_ref_049", "", "image/png"),
    ("atomic_ref_050", "   ", "image/png"),
]


@pytest.mark.parametrize(
    "atomic_id,raw,expected", REFERENCE_MIME_CASES, ids=[c[0] for c in REFERENCE_MIME_CASES]
)
def test_atomic_reference_mime_normalization_50_cases(
    atomic_id: str, raw: str, expected: str
):
    assert atomic_id.startswith("atomic_ref_")
    assert GoogleGeminiGenerator._normalize_reference_mime_type(raw) == expected


@pytest.mark.asyncio
async def test_atomic_reference_fallback_uses_sniffed_mime_on_preprocess_error():
    generator = GoogleGeminiGenerator()
    generator._initialized = True

    # valid JPEG bytes
    img = Image.new("RGB", (64, 64), "white")
    buf = BytesIO()
    img.save(buf, format="JPEG")
    jpeg_bytes = buf.getvalue()

    mock_response = MagicMock(parts=[])
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response
    generator._client = mock_client

    with patch.object(
        GoogleGeminiGenerator, "_prepare_reference_image", side_effect=RuntimeError("boom")
    ), patch.object(
        GoogleGeminiGenerator, "_extract_image_from_response", return_value=Image.new("RGB", (32, 32))
    ), patch("google.genai.types") as mock_types:
        mock_types.Part.from_bytes.return_value = MagicMock(name="part")
        mock_types.GenerateContentConfig.return_value = MagicMock()

        await generator._generate_image(
            "prompt",
            reference_image_bytes=jpeg_bytes,
            reference_mime_type="text/plain",
            max_retries=1,
        )

    sent_kwargs = mock_types.Part.from_bytes.call_args.kwargs
    assert sent_kwargs["mime_type"] == "image/jpeg"

