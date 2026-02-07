"""
Atomic MIME normalization tests (50 edge cases).

Each case represents a concrete content-type variant observed in clients/proxies.
"""

import pytest

from services.image_validation import normalize_image_mime_type


MIME_CASES = [
    ("atomic_001", "image/jpg", "image/jpeg"),
    ("atomic_002", "IMAGE/JPG", "image/jpeg"),
    ("atomic_003", "image/jpg; charset=binary", "image/jpeg"),
    ("atomic_004", '"image/jpg"', "image/jpeg"),
    ("atomic_005", "'image/jpg'", "image/jpeg"),
    ("atomic_006", "image/pjpeg", "image/jpeg"),
    ("atomic_007", "IMAGE/PJPEG", "image/jpeg"),
    ("atomic_008", "image/pjpeg; charset=UTF-8", "image/jpeg"),
    ("atomic_009", "image/x-jpg", "image/jpeg"),
    ("atomic_010", "image/x-jpeg", "image/jpeg"),
    ("atomic_011", "image/x-pjpeg", "image/jpeg"),
    ("atomic_012", "image/jpe", "image/jpeg"),
    ("atomic_013", "image/jfif", "image/jpeg"),
    ("atomic_014", "image/x-jfif", "image/jpeg"),
    ("atomic_015", "image/pipeg", "image/jpeg"),
    ("atomic_016", "image/apng", "image/png"),
    ("atomic_017", "image/vnd.mozilla.apng", "image/png"),
    ("atomic_018", "image/x-png", "image/png"),
    ("atomic_019", "image/x-citrix-png", "image/png"),
    ("atomic_020", "image/png", "image/png"),
    ("atomic_021", " IMAGE/PNG ", "image/png"),
    ("atomic_022", "image/png; charset=binary", "image/png"),
    ("atomic_023", '"image/png; charset=binary"', "image/png"),
    ("atomic_024", "'image/png'", "image/png"),
    ("atomic_025", "image/png ,image/*", "image/png"),
    ("atomic_026", "image/png, image/*", "image/png"),
    ("atomic_027", "image/webp", "image/webp"),
    ("atomic_028", "IMAGE/WEBP", "image/webp"),
    ("atomic_029", "image/webp; charset=binary", "image/webp"),
    ("atomic_030", '"image/webp"', "image/webp"),
    ("atomic_031", "image/x-webp", "image/webp"),
    ("atomic_032", "image/x-citrix-webp", "image/webp"),
    ("atomic_033", "image/jpeg", "image/jpeg"),
    ("atomic_034", "IMAGE/JPEG", "image/jpeg"),
    ("atomic_035", "image/jpeg;name=test.jpg", "image/jpeg"),
    ("atomic_036", '"image/jpeg"', "image/jpeg"),
    ("atomic_037", "image/jfif;name=foo.jpg", "image/jpeg"),
    ("atomic_038", "image/x-jfif; name=a.jpg", "image/jpeg"),
    ("atomic_039", "image/x-png; charset=UTF-8", "image/png"),
    ("atomic_040", "image/apng; charset=UTF-8", "image/png"),
    ("atomic_041", "image/vnd.mozilla.apng; foo=bar", "image/png"),
    ("atomic_042", "image/x-webp; q=1", "image/webp"),
    ("atomic_043", "image/x-jpeg;foo=bar", "image/jpeg"),
    ("atomic_044", "image/x-pjpeg;foo=bar", "image/jpeg"),
    ("atomic_045", "image/pipeg;foo=bar", "image/jpeg"),
    ("atomic_046", '" IMAGE/JPEG "', "image/jpeg"),
    ("atomic_047", '" image/png "', "image/png"),
    ("atomic_048", '" image/webp "', "image/webp"),
    ("atomic_049", "\"'image/pjpeg'\"", "image/jpeg"),
    ("atomic_050", "image/jpg,image/png", "image/jpeg"),
]


@pytest.mark.parametrize("atomic_id,raw,expected", MIME_CASES, ids=[c[0] for c in MIME_CASES])
def test_atomic_mime_normalization_50_cases(
    atomic_id: str, raw: str, expected: str
):
    # atomic_id is used only as a stable test identifier in reports.
    assert atomic_id.startswith("atomic_")
    assert normalize_image_mime_type(raw) == expected
