import logging
from dataclasses import dataclass
from io import BytesIO

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
MIN_IMAGE_WIDTH = 64
MIN_IMAGE_HEIGHT = 64
MAX_IMAGE_WIDTH = 8192
MAX_IMAGE_HEIGHT = 8192
MAX_IMAGE_PIXELS = 16_777_216  # 16 MP
MAX_ASPECT_RATIO = 8.0

IMAGE_MIME_ALIASES = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/x-jpg": "image/jpeg",
    "image/x-jpeg": "image/jpeg",
    "image/x-pjpeg": "image/jpeg",
    "image/jpe": "image/jpeg",
    "image/jfif": "image/jpeg",
    "image/x-jfif": "image/jpeg",
    "image/pipeg": "image/jpeg",
    "image/apng": "image/png",
    "image/vnd.mozilla.apng": "image/png",
    "image/x-png": "image/png",
    "image/x-citrix-png": "image/png",
    "image/x-webp": "image/webp",
    "image/x-citrix-webp": "image/webp",
}


@dataclass(frozen=True)
class ImagePayloadInfo:
    mime_type: str
    width: int
    height: int


def normalize_image_mime_type(claimed_mime_type: str) -> str:
    mime_type = (claimed_mime_type or "").strip()
    if not mime_type:
        return ""

    # Normalize wrappers often seen in malformed multipart headers.
    for _ in range(2):
        if (mime_type.startswith('"') and mime_type.endswith('"')) or (
            mime_type.startswith("'") and mime_type.endswith("'")
        ):
            mime_type = mime_type[1:-1].strip()

    # Some clients/proxies accidentally send comma-joined values.
    if "," in mime_type:
        mime_type = mime_type.split(",", 1)[0].strip()
    if ";" in mime_type:
        mime_type = mime_type.split(";", 1)[0].strip()

    mime_type = mime_type.strip().lower()
    return IMAGE_MIME_ALIASES.get(mime_type, mime_type)


def extension_for_image_mime_type(claimed_mime_type: str) -> str:
    mime_type = normalize_image_mime_type(claimed_mime_type)
    if mime_type == "image/png":
        return ".png"
    if mime_type == "image/jpeg":
        return ".jpg"
    if mime_type == "image/webp":
        return ".webp"
    return ""


def validate_image_magic_bytes(content: bytes, claimed_mime_type: str) -> bool:
    """
    Validate that file content matches the claimed MIME type by checking magic bytes.

    This prevents attacks where malicious files are uploaded with fake extensions or content-types.
    Returns True if validation passes, raises HTTPException if it fails.
    """
    if len(content) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too small to be a valid image",
        )

    mime_type = normalize_image_mime_type(claimed_mime_type)

    # JPEG check
    if mime_type == "image/jpeg":
        if not content.startswith(b"\xff\xd8\xff"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match JPEG format. Upload a real JPEG image.",
            )
        return True

    # PNG check
    if mime_type == "image/png":
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match PNG format. Upload a real PNG image.",
            )
        return True

    # WebP check - RIFF container with WEBP identifier
    if mime_type == "image/webp":
        if not (content[:4] == b"RIFF" and content[8:12] == b"WEBP"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match WebP format. Upload a real WebP image.",
            )
        return True

    # Unknown type - reject
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported image type: {claimed_mime_type}",
    )


def sniff_image_mime_type(content: bytes) -> str | None:
    """
    Best-effort MIME sniffing by magic bytes.

    Returns normalized mime_type ("image/png", "image/jpeg", "image/webp") or None.
    """
    if not content:
        return None
    # PNG signature
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    # JPEG signature
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    # WebP RIFF container with WEBP identifier
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _detect_image_dimensions(content: bytes) -> tuple[int, int]:
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported or corrupted image file. Please upload PNG, JPG, or WEBP.",
        )

    if width <= 0 or height <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image dimensions",
        )
    return width, height


def validate_uploaded_image_payload(
    content: bytes,
    claimed_mime_type: str | None = None,
    *,
    min_width: int = MIN_IMAGE_WIDTH,
    min_height: int = MIN_IMAGE_HEIGHT,
    max_width: int = MAX_IMAGE_WIDTH,
    max_height: int = MAX_IMAGE_HEIGHT,
    max_pixels: int = MAX_IMAGE_PIXELS,
    max_aspect_ratio: float = MAX_ASPECT_RATIO,
) -> ImagePayloadInfo:
    """
    Validate uploaded image bytes and return canonical metadata.

    Rules:
    - Accept PNG/JPEG/WEBP by actual magic bytes (preferred).
    - Gracefully handle wrong/missing client Content-Type when bytes are valid.
    - Reject tiny images that are unusable for pose generation.
    """
    if len(content) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too small to be a valid image",
        )

    normalized_claimed = normalize_image_mime_type(claimed_mime_type or "")
    sniffed_mime = sniff_image_mime_type(content)

    resolved_mime = sniffed_mime
    if not resolved_mime and normalized_claimed in ALLOWED_IMAGE_MIME_TYPES:
        # Fall back to normalized claimed MIME when sniffing is inconclusive.
        # validate_image_magic_bytes will still enforce header consistency.
        resolved_mime = normalized_claimed

    if resolved_mime not in ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    if (
        normalized_claimed
        and normalized_claimed in ALLOWED_IMAGE_MIME_TYPES
        and sniffed_mime
        and normalized_claimed != sniffed_mime
    ):
        logger.warning(
            "Claimed MIME type mismatch (claimed=%s, sniffed=%s); using sniffed MIME",
            normalized_claimed,
            sniffed_mime,
        )

    validate_image_magic_bytes(content, resolved_mime)
    width, height = _detect_image_dimensions(content)

    if width < min_width or height < min_height:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Image is too small ({width}x{height}). "
                f"Minimum supported size is {min_width}x{min_height}."
            ),
        )

    if width > max_width or height > max_height:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Image is too large ({width}x{height}). "
                f"Maximum supported size is {max_width}x{max_height}."
            ),
        )

    total_pixels = width * height
    if total_pixels > max_pixels:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Image has too many pixels ({total_pixels}). "
                f"Maximum supported pixel count is {max_pixels}."
            ),
        )

    longer = max(width, height)
    shorter = max(1, min(width, height))
    if (longer / shorter) > max_aspect_ratio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported aspect ratio ({width}x{height}). "
                f"Maximum supported ratio is {max_aspect_ratio}:1."
            ),
        )

    return ImagePayloadInfo(mime_type=resolved_mime, width=width, height=height)
