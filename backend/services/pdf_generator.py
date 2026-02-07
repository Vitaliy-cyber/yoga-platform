"""
PDF Generator service for creating beautiful PDF exports of yoga poses.
Uses reportlab for PDF generation.
"""

import io
import ipaddress
import logging
import socket
from pathlib import Path
from typing import List, Optional, Set, Tuple
from datetime import datetime
from urllib.parse import urlparse
from xml.sax.saxutils import escape as _xml_escape

import httpx
import aiofiles
from PIL import Image

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Image as RLImage,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

# Unicode-capable fonts (bundled for predictable Cyrillic support)
FONT_REGULAR = "DejaVuSans"
FONT_BOLD = "DejaVuSans-Bold"


def _register_unicode_fonts() -> None:
    """Register bundled Unicode fonts if available."""
    try:
        fonts_dir = Path(__file__).parent.parent / "assets" / "fonts"
        regular_path = fonts_dir / "DejaVuSans.ttf"
        bold_path = fonts_dir / "DejaVuSans-Bold.ttf"

        if regular_path.exists() and FONT_REGULAR not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(FONT_REGULAR, str(regular_path)))
        if bold_path.exists() and FONT_BOLD not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold_path)))
    except Exception as e:
        logger.warning(f"Failed to register Unicode fonts: {e}")

# Page sizes mapping
PAGE_SIZES = {
    "A4": A4,
    "Letter": letter,
}

# Maximum image size in bytes (5MB)
MAX_IMAGE_SIZE = 5 * 1024 * 1024

# Allowed domains for external image fetching (allowlist approach)
# Empty set means no external domains allowed by default
ALLOWED_IMAGE_DOMAINS: Set[str] = {
    # Add trusted domains here, e.g.:
    # "cdn.example.com",
    # "images.example.com",
}

# Private/local IP ranges to block for SSRF protection
BLOCKED_IP_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),  # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),  # IPv6 private
    ipaddress.ip_network("fe80::/10"),  # IPv6 link-local
]


def _is_private_ip(hostname: str) -> bool:
    """Check if hostname resolves to a private/local IP address."""
    try:
        # Resolve hostname to IP addresses
        ip_addresses = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC)
        for family, _, _, _, sockaddr in ip_addresses:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                # Check against blocked ranges
                for blocked_range in BLOCKED_IP_RANGES:
                    if ip in blocked_range:
                        return True
            except ValueError:
                continue
        return False
    except socket.gaierror:
        # If we can't resolve, block it for safety
        return True


def _validate_url(url: str) -> bool:
    """
    Validate URL for SSRF protection.

    Returns True if URL is safe to fetch, False otherwise.
    """
    try:
        parsed = urlparse(url)

        # Only allow HTTPS
        if parsed.scheme != "https":
            logger.warning(f"Blocked non-HTTPS URL: {url}")
            return False

        # Must have a valid hostname
        if not parsed.hostname:
            return False

        # Check against domain allowlist (if configured)
        if ALLOWED_IMAGE_DOMAINS and parsed.hostname not in ALLOWED_IMAGE_DOMAINS:
            logger.warning(f"Domain not in allowlist: {parsed.hostname}")
            return False

        # Check for private/local IPs (SSRF protection)
        if _is_private_ip(parsed.hostname):
            logger.warning(f"Blocked private/local IP for hostname: {parsed.hostname}")
            return False

        return True
    except Exception as e:
        logger.warning(f"URL validation error: {e}")
        return False

# Colors
PRIMARY_COLOR = colors.HexColor("#6366F1")  # Indigo
SECONDARY_COLOR = colors.HexColor("#8B5CF6")  # Purple
TEXT_COLOR = colors.HexColor("#1F2937")  # Gray-800
MUTED_COLOR = colors.HexColor("#6B7280")  # Gray-500
BG_COLOR = colors.HexColor("#F9FAFB")  # Gray-50


def get_activation_color(level: int) -> colors.Color:
    """Get color based on muscle activation level."""
    if level >= 70:
        return colors.HexColor("#EF4444")  # Red - High
    elif level >= 40:
        return colors.HexColor("#F59E0B")  # Amber - Medium
    else:
        return colors.HexColor("#22C55E")  # Green - Low


class PosePDFGenerator:
    """Generator for creating PDF documents from yoga poses."""

    def __init__(self, page_size: str = "A4"):
        _register_unicode_fonts()
        self.font_regular = (
            FONT_REGULAR
            if FONT_REGULAR in pdfmetrics.getRegisteredFontNames()
            else "Helvetica"
        )
        self.font_bold = (
            FONT_BOLD
            if FONT_BOLD in pdfmetrics.getRegisteredFontNames()
            else "Helvetica-Bold"
        )
        self.page_size = PAGE_SIZES.get(page_size, A4)
        self.width, self.height = self.page_size
        self.styles = self._create_styles()

    def _create_styles(self) -> dict:
        """Create custom paragraph styles."""
        base_styles = getSampleStyleSheet()

        custom_styles = {
            "title": ParagraphStyle(
                "CustomTitle",
                parent=base_styles["Heading1"],
                fontSize=24,
                textColor=TEXT_COLOR,
                spaceAfter=6*mm,
                alignment=TA_CENTER,
                fontName=self.font_bold,
            ),
            "subtitle": ParagraphStyle(
                "CustomSubtitle",
                parent=base_styles["Normal"],
                fontSize=14,
                textColor=MUTED_COLOR,
                spaceAfter=4*mm,
                alignment=TA_CENTER,
                fontName=self.font_regular,
            ),
            "section_title": ParagraphStyle(
                "SectionTitle",
                parent=base_styles["Heading2"],
                fontSize=14,
                textColor=PRIMARY_COLOR,
                spaceBefore=8*mm,
                spaceAfter=4*mm,
                fontName=self.font_bold,
            ),
            "body": ParagraphStyle(
                "CustomBody",
                parent=base_styles["Normal"],
                fontSize=11,
                textColor=TEXT_COLOR,
                spaceAfter=3*mm,
                leading=16,
                fontName=self.font_regular,
            ),
            "label": ParagraphStyle(
                "Label",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=MUTED_COLOR,
                fontName=self.font_bold,
            ),
            "value": ParagraphStyle(
                "Value",
                parent=base_styles["Normal"],
                fontSize=11,
                textColor=TEXT_COLOR,
                fontName=self.font_regular,
            ),
            "muscle_name": ParagraphStyle(
                "MuscleName",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=TEXT_COLOR,
                fontName=self.font_regular,
            ),
            "footer": ParagraphStyle(
                "Footer",
                parent=base_styles["Normal"],
                fontSize=8,
                textColor=MUTED_COLOR,
                alignment=TA_CENTER,
                fontName=self.font_regular,
            ),
        }

        return custom_styles

    def _safe_paragraph_text(self, value: Optional[str]) -> str:
        """
        Sanitize user-provided text before feeding it into reportlab Paragraph.

        ReportLab's Paragraph uses an HTML-like parser. Untrusted user content may:
        - contain invalid/unbalanced markup, crashing PDF generation (500)
        - include characters that are not UTF-8 encodable (e.g. unpaired surrogates)
        """
        if value is None:
            return ""

        # Normalize to a UTF-8 encodable string (replaces invalid sequences)
        text = str(value).encode("utf-8", errors="replace").decode(
            "utf-8", errors="replace"
        )

        # Replace ASCII control characters (except \n and \t) to avoid parser weirdness
        text = "".join(
            (ch if (ch >= " " or ch in ("\n", "\t")) else " ") for ch in text
        )

        # Escape markup-sensitive characters so text is treated as plain text
        text = _xml_escape(text, entities={'"': "&quot;", "'": "&#39;"})

        # Preserve newlines in a safe way
        return text.replace("\n", "<br/>")

    async def _fetch_image(
        self,
        url_or_path: str,
        max_size: int = MAX_IMAGE_SIZE,
    ) -> Optional[bytes]:
        """
        Fetch image from URL or local path with security checks.

        Security measures:
        - Path traversal prevention for local files
        - SSRF protection for remote URLs
        - File size limits to prevent memory exhaustion
        """
        try:
            # Check if it's a local file path
            if url_or_path.startswith("/storage/"):
                return await self._fetch_local_image(url_or_path, max_size)

            # Remote URL - validate for SSRF
            if not _validate_url(url_or_path):
                logger.warning(f"URL validation failed: {url_or_path}")
                return None

            return await self._fetch_remote_image(url_or_path, max_size)

        except Exception as e:
            logger.warning(f"Failed to fetch image: {url_or_path} - {e}")
            return None

    async def _fetch_local_image(
        self,
        path: str,
        max_size: int = MAX_IMAGE_SIZE,
    ) -> Optional[bytes]:
        """
        Fetch local image with path traversal protection.

        Validates that the resolved path is within the storage directory.
        """
        try:
            # Define storage root directory
            storage_root = (Path(__file__).parent.parent / "storage").resolve()

            # Get the relative path portion after /storage/
            relative_path = path[9:]  # Remove "/storage/" prefix

            # Sanitize: remove any parent directory references
            # Split and filter out dangerous components
            path_parts = relative_path.split("/")
            safe_parts = [
                part for part in path_parts
                if part and part not in (".", "..")
            ]

            if not safe_parts:
                logger.warning(f"Invalid storage path: {path}")
                return None

            # Construct the target path
            target_path = storage_root.joinpath(*safe_parts).resolve()

            # CRITICAL: Verify the resolved path is within storage directory
            try:
                target_path.relative_to(storage_root)
            except ValueError:
                logger.warning(f"Path traversal attempt blocked: {path}")
                return None

            # Check file exists and is a file (not directory)
            if not target_path.exists() or not target_path.is_file():
                logger.warning(f"File not found: {target_path}")
                return None

            # Check file size before reading
            file_size = target_path.stat().st_size
            if file_size > max_size:
                logger.warning(
                    f"Local file too large: {file_size} bytes "
                    f"(max: {max_size})"
                )
                return None

            # Read file content
            async with aiofiles.open(target_path, "rb") as f:
                return await f.read()

        except Exception as e:
            logger.warning(f"Error fetching local image: {e}")
            return None

    async def _fetch_remote_image(
        self,
        url: str,
        max_size: int = MAX_IMAGE_SIZE,
    ) -> Optional[bytes]:
        """
        Fetch remote image with streaming and size limits.

        Streams the download and aborts if size exceeds limit.
        """
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                max_redirects=3,
            ) as client:
                async with client.stream(
                    "GET",
                    url,
                    timeout=30.0,
                ) as response:
                    response.raise_for_status()

                    # Check content-length header if available
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > max_size:
                        logger.warning(
                            f"Remote image too large (Content-Length): "
                            f"{content_length} bytes"
                        )
                        return None

                    # Stream download with size check
                    chunks = []
                    total_size = 0

                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        total_size += len(chunk)
                        if total_size > max_size:
                            logger.warning(
                                f"Remote image exceeded size limit during download: "
                                f"{total_size} bytes (max: {max_size})"
                            )
                            return None
                        chunks.append(chunk)

                    return b"".join(chunks)

        except httpx.TimeoutException:
            logger.warning(f"Timeout fetching remote image: {url}")
            return None
        except httpx.HTTPStatusError as e:
            logger.warning(f"HTTP error fetching remote image: {e}")
            return None
        except Exception as e:
            logger.warning(f"Error fetching remote image: {e}")
            return None

    def _prepare_image(
        self,
        image_bytes: bytes,
        max_width: float,
        max_height: float
    ) -> Optional[RLImage]:
        """Prepare image for PDF with proper sizing.

        Defensive hardening:
        - Some stored images can be corrupted/truncated (e.g. prior placeholder bugs).
          ReportLab may crash during `doc.build()` even if PIL can parse headers.
        - To avoid 500s, we fully decode the image via PIL and re-encode a clean PNG
          before passing bytes to ReportLab.
        """
        try:
            # Fully decode with PIL (forces validation of the entire stream)
            with Image.open(io.BytesIO(image_bytes)) as pil_image:
                pil_image.load()
                img_width, img_height = pil_image.size

                # Calculate scaling factor (in PDF points; roughly proportional to pixels)
                width_ratio = max_width / max(img_width, 1)
                height_ratio = max_height / max(img_height, 1)
                scale = min(width_ratio, height_ratio, 1.0)  # Don't upscale

                final_width = img_width * scale
                final_height = img_height * scale

                # Re-encode to a clean PNG to prevent ReportLab parsing issues.
                # Performance optimization:
                # - downscale to the rendered PDF size (+ small retina buffer)
                # - avoid expensive PNG optimize pass
                safe_image = pil_image.convert("RGB")
                target_w = max(1, int(final_width * 2))
                target_h = max(1, int(final_height * 2))
                if safe_image.width > target_w or safe_image.height > target_h:
                    resampling = getattr(
                        getattr(Image, "Resampling", Image),
                        "LANCZOS",
                        Image.BICUBIC,
                    )
                    safe_image.thumbnail((target_w, target_h), resampling)
                out = io.BytesIO()
                safe_image.save(out, format="PNG", optimize=False, compress_level=1)
                safe_bytes = out.getvalue()

            # Create ReportLab image
            img_io = io.BytesIO(safe_bytes)
            return RLImage(img_io, width=final_width, height=final_height)

        except Exception as e:
            logger.warning(f"Failed to prepare image: {e}")
            return None

    def _build_muscle_table(
        self,
        muscles: List[dict]
    ) -> Table:
        """Build a styled table of muscles."""
        # Sort by activation level descending
        sorted_muscles = sorted(muscles, key=lambda m: m.get("activation_level", 0), reverse=True)

        # Table header
        data = [["М'яз", "Рівень активації"]]

        for muscle in sorted_muscles:
            name = muscle.get("muscle_name", muscle.get("name", "Невідомо"))
            level = muscle.get("activation_level", 0)

            # Create activation bar representation
            filled = int(level / 10)
            bar = "[" + "#" * filled + "-" * (10 - filled) + f"] {level}%"

            data.append([name, bar])

        table = Table(data, colWidths=[self.width * 0.5, self.width * 0.35])

        # Table style
        style = TableStyle([
            # Header
            ("BACKGROUND", (0, 0), (-1, 0), PRIMARY_COLOR),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), self.font_bold),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 8),

            # Body
            ("FONTNAME", (0, 1), (-1, -1), self.font_regular),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("TOPPADDING", (0, 1), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 6),

            # Grid
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),

            # Alternating row colors
            *[("BACKGROUND", (0, i), (-1, i), BG_COLOR) for i in range(2, len(data), 2)],
        ])

        table.setStyle(style)
        return table

    async def generate_pose_pdf(
        self,
        pose: dict,
        include_photo: bool = True,
        include_schema: bool = True,
        include_muscle_layer: bool = True,
        include_muscles_list: bool = True,
        include_description: bool = True,
    ) -> bytes:
        """
        Generate a beautiful PDF for a single pose.

        Args:
            pose: Dictionary with pose data including:
                - code, name, name_en, description, effect, breathing
                - muscles: list of muscle dictionaries
                - photo_path, schema_path, muscle_layer_path
            include_photo: Include photo image
            include_schema: Include schema image
            include_muscle_layer: Include muscle layer image
            include_muscles_list: Include muscle activation table
            include_description: Include text descriptions

        Returns:
            PDF as bytes
        """
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=self.page_size,
            rightMargin=2*cm,
            leftMargin=2*cm,
            topMargin=2*cm,
            bottomMargin=2*cm,
        )

        story = []

        # === Header ===
        story.append(
            Paragraph(
                self._safe_paragraph_text(pose.get("name", "Поза йоги")),
                self.styles["title"],
            )
        )

        # Subtitle with code and English name
        subtitle_parts = []
        if pose.get("name_en"):
            subtitle_parts.append(pose["name_en"])
        if pose.get("category_name"):
            subtitle_parts.append(f"Категорія: {pose['category_name']}")
        if subtitle_parts:
            story.append(
                Paragraph(
                    self._safe_paragraph_text(" | ".join(subtitle_parts)),
                    self.styles["subtitle"],
                )
            )

        story.append(Spacer(1, 6*mm))
        story.append(HRFlowable(
            width="100%",
            thickness=1,
            color=colors.HexColor("#E5E7EB"),
            spaceBefore=2*mm,
            spaceAfter=6*mm
        ))

        # === Images Section ===
        images_added = False
        max_img_width = self.width - 4*cm
        max_img_height = 8*cm

        # Photo
        if include_photo and pose.get("photo_path"):
            img_bytes = await self._fetch_image(pose["photo_path"])
            if img_bytes:
                story.append(Paragraph("Згенероване фото", self.styles["section_title"]))
                img = self._prepare_image(img_bytes, max_img_width, max_img_height)
                if img:
                    story.append(img)
                    story.append(Spacer(1, 4*mm))
                    images_added = True

        # Schema
        if include_schema and pose.get("schema_path"):
            img_bytes = await self._fetch_image(pose["schema_path"])
            if img_bytes:
                story.append(Paragraph("Вихідна схема", self.styles["section_title"]))
                img = self._prepare_image(img_bytes, max_img_width, max_img_height)
                if img:
                    story.append(img)
                    story.append(Spacer(1, 4*mm))
                    images_added = True

        # Muscle Layer
        if include_muscle_layer and pose.get("muscle_layer_path"):
            img_bytes = await self._fetch_image(pose["muscle_layer_path"])
            if img_bytes:
                story.append(Paragraph("Візуалізація м'язів", self.styles["section_title"]))
                img = self._prepare_image(img_bytes, max_img_width, max_img_height)
                if img:
                    story.append(img)
                    story.append(Spacer(1, 4*mm))
                    images_added = True

        if images_added:
            story.append(Spacer(1, 4*mm))

        # === Description Section ===
        if include_description:
            if pose.get("description"):
                story.append(Paragraph("Опис", self.styles["section_title"]))
                story.append(
                    Paragraph(
                        self._safe_paragraph_text(pose["description"]),
                        self.styles["body"],
                    )
                )

            if pose.get("effect"):
                story.append(Paragraph("Ефекти та користь", self.styles["section_title"]))
                story.append(
                    Paragraph(
                        self._safe_paragraph_text(pose["effect"]),
                        self.styles["body"],
                    )
                )

            if pose.get("breathing"):
                story.append(Paragraph("Інструкції з дихання", self.styles["section_title"]))
                story.append(
                    Paragraph(
                        self._safe_paragraph_text(pose["breathing"]),
                        self.styles["body"],
                    )
                )

        # === Muscle Activation Section ===
        muscles = pose.get("muscles", [])
        if include_muscles_list and muscles:
            story.append(Paragraph("Активні м'язи", self.styles["section_title"]))
            muscle_table = self._build_muscle_table(muscles)
            story.append(muscle_table)

        # === Footer ===
        story.append(Spacer(1, 10*mm))
        story.append(HRFlowable(
            width="100%",
            thickness=0.5,
            color=colors.HexColor("#E5E7EB"),
            spaceBefore=4*mm,
            spaceAfter=4*mm
        ))

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        story.append(Paragraph(
            self._safe_paragraph_text(f"Згенеровано в YogaFlow | {timestamp}"),
            self.styles["footer"]
        ))

        # Build PDF
        try:
            doc.build(story)
        except Exception as e:
            # Never 5xx on export because of a single broken image or malformed text.
            logger.warning(f"PDF build failed; retrying without images: {e}")
            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=self.page_size,
                rightMargin=2*cm,
                leftMargin=2*cm,
                topMargin=2*cm,
                bottomMargin=2*cm,
            )
            story_no_images = []
            story_no_images.append(
                Paragraph(
                    self._safe_paragraph_text(pose.get("name", "Поза йоги")),
                    self.styles["title"],
                )
            )
            subtitle_parts = []
            if pose.get("name_en"):
                subtitle_parts.append(pose["name_en"])
            if pose.get("category_name"):
                subtitle_parts.append(f"Категорія: {pose['category_name']}")
            if subtitle_parts:
                story_no_images.append(
                    Paragraph(
                        self._safe_paragraph_text(" | ".join(subtitle_parts)),
                        self.styles["subtitle"],
                    )
                )
            story_no_images.append(Spacer(1, 6*mm))
            story_no_images.append(HRFlowable(
                width="100%",
                thickness=1,
                color=colors.HexColor("#E5E7EB"),
                spaceBefore=2*mm,
                spaceAfter=6*mm
            ))

            # Text sections only
            if include_description:
                if pose.get("description"):
                    story_no_images.append(Paragraph("Опис", self.styles["section_title"]))
                    story_no_images.append(
                        Paragraph(
                            self._safe_paragraph_text(pose["description"]),
                            self.styles["body"],
                        )
                    )
                if pose.get("effect"):
                    story_no_images.append(Paragraph("Ефекти та користь", self.styles["section_title"]))
                    story_no_images.append(
                        Paragraph(
                            self._safe_paragraph_text(pose["effect"]),
                            self.styles["body"],
                        )
                    )
                if pose.get("breathing"):
                    story_no_images.append(Paragraph("Інструкції з дихання", self.styles["section_title"]))
                    story_no_images.append(
                        Paragraph(
                            self._safe_paragraph_text(pose["breathing"]),
                            self.styles["body"],
                        )
                    )

            muscles = pose.get("muscles", [])
            if include_muscles_list and muscles:
                story_no_images.append(Paragraph("Активні м'язи", self.styles["section_title"]))
                story_no_images.append(self._build_muscle_table(muscles))

            story_no_images.append(Spacer(1, 10*mm))
            story_no_images.append(HRFlowable(
                width="100%",
                thickness=0.5,
                color=colors.HexColor("#E5E7EB"),
                spaceBefore=4*mm,
                spaceAfter=4*mm
            ))
            story_no_images.append(Paragraph(
                self._safe_paragraph_text(f"Згенеровано в YogaFlow | {timestamp}"),
                self.styles["footer"]
            ))
            doc.build(story_no_images)

        return buffer.getvalue()

    async def generate_multiple_poses_pdf(
        self,
        poses: List[dict],
        title: str = "Колекція йога-поз",
    ) -> bytes:
        """
        Generate a PDF with multiple poses (one per page).

        Args:
            poses: List of pose dictionaries
            title: Title for the document

        Returns:
            PDF as bytes
        """
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=self.page_size,
            rightMargin=2*cm,
            leftMargin=2*cm,
            topMargin=2*cm,
            bottomMargin=2*cm,
        )

        story = []
        exported_at = datetime.now().strftime("%d.%m.%Y %H:%M")

        # Cover page
        story.append(Spacer(1, 2.6 * cm))
        story.append(Paragraph(self._safe_paragraph_text(title), self.styles["title"]))
        story.append(Spacer(1, 3 * mm))
        story.append(
            Paragraph(self._safe_paragraph_text("Експорт послідовності"), self.styles["subtitle"])
        )
        story.append(Spacer(1, 8 * mm))

        summary_data = [
            [
                Paragraph(self._safe_paragraph_text("Кількість поз"), self.styles["label"]),
                Paragraph(self._safe_paragraph_text(str(len(poses))), self.styles["value"]),
            ],
            [
                Paragraph(self._safe_paragraph_text("Згенеровано"), self.styles["label"]),
                Paragraph(self._safe_paragraph_text(exported_at), self.styles["value"]),
            ],
        ]
        summary_table = Table(summary_data, colWidths=[5.2 * cm, 8.8 * cm], hAlign="CENTER")
        summary_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
                    ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#D1D5DB")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]
            )
        )
        story.append(summary_table)
        story.append(Spacer(1, 10 * mm))

        preview_rows = []
        for idx, pose in enumerate(poses[:12], start=1):
            pose_name = self._safe_paragraph_text(pose.get("name", "Поза йоги"))
            duration = pose.get("duration_seconds")
            duration_text = f"{int(duration)} с" if isinstance(duration, (int, float)) else "-"
            preview_rows.append(
                [
                    Paragraph(self._safe_paragraph_text(str(idx)), self.styles["label"]),
                    Paragraph(pose_name, self.styles["body"]),
                    Paragraph(self._safe_paragraph_text(duration_text), self.styles["value"]),
                ]
            )

        if preview_rows:
            preview_data = [[
                Paragraph(self._safe_paragraph_text("#"), self.styles["label"]),
                Paragraph(self._safe_paragraph_text("Поза"), self.styles["label"]),
                Paragraph(self._safe_paragraph_text("Тривалість"), self.styles["label"]),
            ]] + preview_rows
            preview_table = Table(
                preview_data,
                colWidths=[1.2 * cm, 9.6 * cm, 3.2 * cm],
                hAlign="CENTER",
            )
            preview_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1F2937")),
                        ("FONTNAME", (0, 0), (-1, 0), self.font_bold),
                        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#E5E7EB")),
                        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (0, -1), "CENTER"),
                        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
                        *[
                            ("BACKGROUND", (0, row), (-1, row), BG_COLOR)
                            for row in range(2, len(preview_data), 2)
                        ],
                    ]
                )
            )
            story.append(preview_table)

        # Each pose on a new page
        for idx, pose in enumerate(poses, start=1):
            story.append(PageBreak())

            pose_title = self._safe_paragraph_text(pose.get("name", "Поза йоги"))
            story.append(Paragraph(self._safe_paragraph_text(f"{idx}. {pose_title}"), self.styles["title"]))

            meta_parts = []
            if pose.get("code"):
                meta_parts.append(f"Код: {pose['code']}")
            if pose.get("category_name"):
                meta_parts.append(f"Категорія: {pose['category_name']}")
            duration = pose.get("duration_seconds")
            if isinstance(duration, (int, float)):
                meta_parts.append(f"Тривалість: {int(duration)} с")
            if meta_parts:
                story.append(
                    Paragraph(
                        self._safe_paragraph_text(" | ".join(meta_parts)),
                        self.styles["subtitle"],
                    )
                )

            story.append(Spacer(1, 2 * mm))
            story.append(
                HRFlowable(
                    width="100%",
                    thickness=0.8,
                    color=colors.HexColor("#E5E7EB"),
                    spaceBefore=2 * mm,
                    spaceAfter=4 * mm,
                )
            )

            image_specs = []
            if pose.get("photo_path"):
                image_specs.append(("Фото студії", pose["photo_path"]))
            if pose.get("muscle_layer_path"):
                image_specs.append(("Шар м'язів", pose["muscle_layer_path"]))
            elif pose.get("schema_path"):
                image_specs.append(("Вихідна схема", pose["schema_path"]))

            if image_specs:
                max_img_width = self.width - 4 * cm
                if len(image_specs) >= 2:
                    col_w = (max_img_width - 10) / 2
                    cells = []
                    for label, path in image_specs[:2]:
                        flowables = [Paragraph(self._safe_paragraph_text(label), self.styles["label"]), Spacer(1, 2 * mm)]
                        img_bytes = await self._fetch_image(path)
                        if img_bytes:
                            img = self._prepare_image(img_bytes, col_w, 6.8 * cm)
                            if img:
                                flowables.append(img)
                        cells.append(flowables)

                    images_table = Table([cells], colWidths=[col_w, col_w], hAlign="CENTER")
                    images_table.setStyle(
                        TableStyle(
                            [
                                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E5E7EB")),
                                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                                ("TOPPADDING", (0, 0), (-1, -1), 8),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ]
                        )
                    )
                    story.append(images_table)
                else:
                    label, path = image_specs[0]
                    story.append(Paragraph(self._safe_paragraph_text(label), self.styles["section_title"]))
                    img_bytes = await self._fetch_image(path)
                    if img_bytes:
                        img = self._prepare_image(img_bytes, max_img_width, 8 * cm)
                        if img:
                            story.append(img)

                story.append(Spacer(1, 4 * mm))

            if pose.get("description"):
                story.append(Paragraph("Опис пози", self.styles["section_title"]))
                story.append(
                    Paragraph(
                        self._safe_paragraph_text(pose["description"]),
                        self.styles["body"],
                    )
                )

            muscles = pose.get("muscles", [])
            if muscles:
                story.append(Paragraph("Активні м'язи", self.styles["section_title"]))
                muscle_table = self._build_muscle_table(muscles)
                story.append(muscle_table)

        try:
            doc.build(story)
        except Exception as e:
            logger.warning(f"Multi-pose PDF build failed; retrying without images: {e}")
            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=self.page_size,
                rightMargin=2*cm,
                leftMargin=2*cm,
                topMargin=2*cm,
                bottomMargin=2*cm,
            )
            story_no_images = []
            story_no_images.append(Spacer(1, 2.6 * cm))
            story_no_images.append(Paragraph(self._safe_paragraph_text(title), self.styles["title"]))
            story_no_images.append(Spacer(1, 3 * mm))
            story_no_images.append(Paragraph(
                self._safe_paragraph_text("Експорт послідовності"),
                self.styles["subtitle"]
            ))
            story_no_images.append(Spacer(1, 1 * cm))
            story_no_images.append(Paragraph(
                self._safe_paragraph_text(f"{len(poses)} поз | Згенеровано: {exported_at}"),
                self.styles["body"]
            ))
            for idx, pose in enumerate(poses, start=1):
                story_no_images.append(PageBreak())
                story_no_images.append(
                    Paragraph(
                        self._safe_paragraph_text(f"{idx}. {pose.get('name', 'Поза йоги')}"),
                        self.styles["title"],
                    )
                )
                meta_parts = []
                if pose.get("code"):
                    meta_parts.append(f"Код: {pose['code']}")
                if pose.get("category_name"):
                    meta_parts.append(f"Категорія: {pose['category_name']}")
                duration = pose.get("duration_seconds")
                if isinstance(duration, (int, float)):
                    meta_parts.append(f"Тривалість: {int(duration)} с")
                if meta_parts:
                    story_no_images.append(
                        Paragraph(
                            self._safe_paragraph_text(" | ".join(meta_parts)),
                            self.styles["subtitle"],
                        )
                    )
                story_no_images.append(Spacer(1, 4*mm))
                if pose.get("description"):
                    story_no_images.append(Paragraph("Опис", self.styles["section_title"]))
                    story_no_images.append(
                        Paragraph(
                            self._safe_paragraph_text(pose["description"]),
                            self.styles["body"],
                        )
                    )
                muscles = pose.get("muscles", [])
                if muscles:
                    story_no_images.append(Paragraph("Активні м'язи", self.styles["section_title"]))
                    story_no_images.append(self._build_muscle_table(muscles))
            doc.build(story_no_images)
        return buffer.getvalue()
