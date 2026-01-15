"""
Google Gemini AI Generator Service.

Uses Google's Gemini API for image generation and analysis.
"""

import base64
import logging
from dataclasses import dataclass
from io import BytesIO
from typing import Callable, Optional

from PIL import Image

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    """Result of layer generation - studio photo and body paint muscles"""

    photo_bytes: bytes
    muscles_bytes: bytes
    used_placeholders: bool = False


class GoogleGeminiGenerator:
    """
    AI Generator using Google Gemini API.

    Supports:
    - Image analysis (understanding pose from schema) - gemini-3-pro-preview
    - Text-to-image generation - gemini-3-pro-image-preview
    """

    _instance: Optional["GoogleGeminiGenerator"] = None
    _client = None
    _initialized = False

    # Model for image generation (lerailchuk@gmail.com)
    GEMINI_IMAGE_MODEL = "models/gemini-3-pro-image-preview"
    # Model for vision/analysis
    GEMINI_VISION_MODEL = "models/gemini-3-pro-preview"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls) -> "GoogleGeminiGenerator":
        if cls._instance is None:
            cls._instance = cls()
        if not cls._initialized:
            cls._instance._initialize()
        return cls._instance

    @classmethod
    def is_available(cls) -> bool:
        """Check if Google Gemini API is available"""
        try:
            from google import genai

            return bool(settings.GOOGLE_API_KEY)
        except ImportError:
            return False

    def _initialize(self):
        """Initialize Google Gemini client"""
        if self._initialized:
            return

        logger.info("Initializing Google Gemini Generator...")

        if not self.is_available():
            raise RuntimeError(
                "Google Gemini API not available! "
                "Install: pip install google-genai "
                "And set GOOGLE_API_KEY in .env"
            )

        try:
            from google import genai

            self._client = genai.Client(api_key=settings.GOOGLE_API_KEY)
            self._initialized = True
            logger.info("Google Gemini Generator initialized successfully!")
        except Exception as e:
            logger.error(f"Failed to initialize Google Gemini: {e}")
            raise

    async def _analyze_pose_from_image(self, image_bytes: bytes, mime_type: str) -> str:
        """
        Analyze pose from schema image using Gemini vision.
        Returns a description of the yoga pose.
        """
        from google.genai import types

        logger.info("Analyzing pose from image bytes (%s)", mime_type)

        try:
            response = self._client.models.generate_content(
                model=self.GEMINI_VISION_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    "Describe this yoga pose in detail for image generation. "
                    "Focus on: body position, arm placement, leg position, torso angle. "
                    "Output only the pose description in English, nothing else. "
                    "Example: 'warrior pose with right leg forward, arms raised overhead, torso upright'",
                ],
            )

            pose_description = response.text.strip()
            logger.info(f"Detected pose: {pose_description}")
            return pose_description

        except Exception as e:
            logger.warning(f"Failed to analyze image: {e}")
            return "yoga pose with arms extended"

    async def _generate_image(
        self,
        prompt: str,
        reference_image_bytes: Optional[bytes] = None,
        reference_mime_type: Optional[str] = None,
        max_retries: int = 3,
    ) -> tuple[Image.Image, bool]:
        """
        Generate image using Gemini 3 Pro Image.
        Returns (image, is_placeholder) tuple.
        Image is returned in original size without resizing.

        If reference_image_bytes is provided, the image will be used as visual reference
        to ensure consistent pose/composition.
        """
        import asyncio
        from google.genai import types
        from google.genai.errors import ClientError

        logger.info(f"Generating image: {prompt[:80]}...")

        # Prepare contents - either just prompt or prompt + reference image
        if reference_image_bytes:
            ref_mime_type = reference_mime_type or "image/png"
            contents = [
                types.Part.from_bytes(
                    data=reference_image_bytes, mime_type=ref_mime_type
                ),
                prompt,
            ]
        else:
            contents = prompt

        for attempt in range(max_retries):
            try:
                response = self._client.models.generate_content(
                    model=self.GEMINI_IMAGE_MODEL,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                    ),
                )

                # Extract image from response using the new API
                for part in response.parts:
                    if part.inline_data is not None:
                        # Convert bytes to PIL Image
                        image_data = part.inline_data.data
                        pil_image = Image.open(BytesIO(image_data))
                        return pil_image, False

                logger.warning("No image in response")

            except ClientError as e:
                error_msg = str(e)
                if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                    # Rate limit - wait and retry
                    wait_time = (attempt + 1) * 10  # 10s, 20s, 30s
                    logger.warning(
                        f"Rate limited (attempt {attempt + 1}/{max_retries}), waiting {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.warning(f"API error: {e}")
                    break

            except Exception as e:
                logger.warning(f"Image generation error: {e}")
                break

        # Fallback: create placeholder image
        logger.warning("Using placeholder image (API quota may be exhausted)")
        img = Image.new("RGB", (1024, 1024), color=(200, 200, 200))
        return img, True

    @staticmethod
    def _image_to_bytes(image: Image.Image, format: str = "PNG") -> bytes:
        buffer = BytesIO()
        image.save(buffer, format=format)
        return buffer.getvalue()

    async def generate_all_from_image(
        self,
        image_bytes: bytes,
        mime_type: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> GenerationResult:
        """
        Generate 2 images from uploaded schema image.

        1. Analyze pose from schema
        2. Generate realistic studio photo
        3. Generate body paint muscle visualization
        """
        # Step 1: Analyze pose
        if progress_callback:
            progress_callback(10, "Analyzing pose...")

        pose_description = await self._analyze_pose_from_image(image_bytes, mime_type)

        used_placeholders = False

        # Step 2: Generate studio photo
        # Use the schema as reference to ensure correct pose
        if progress_callback:
            progress_callback(30, "Generating studio photo...")

        photo_prompt = f"""Professional yoga photography. Generate based on the reference pose image.

Pose: {pose_description}
- Match EXACTLY the pose from the reference image
- Same body position and viewing angle

Subject requirements:
- Athletic woman, natural body proportions
- HANDS: exactly 5 fingers on each hand, natural hand shape, no extra or fused fingers
- ARMS: two normal human arms with elbows and wrists in correct positions
- FEET: exactly 5 toes on each foot
- Face in natural orientation

Outfit: Black yoga attire (sports bra + leggings), barefoot
Background: Clean white/light gray yoga studio
Lighting: Soft professional studio lighting

DO NOT generate: extra limbs, fused fingers, distorted hands, extra fingers, mutated body parts"""

        photo_img, is_placeholder = await self._generate_image(
            photo_prompt,
            reference_image_bytes=image_bytes,
            reference_mime_type=mime_type,
        )
        photo_bytes = self._image_to_bytes(photo_img)
        used_placeholders = used_placeholders or is_placeholder
        logger.info("Photo generated")

        # Step 3: Generate body paint muscle visualization
        # Use the generated photo as reference to ensure consistent pose
        if progress_callback:
            progress_callback(60, "Generating muscle visualization...")

        muscle_prompt = f"""Create an anatomical muscle and skeleton diagram based on EXACTLY this pose from the reference image.
The figure MUST match the EXACT same pose, position, and angle as shown in the reference photo.

Requirements:
- SAME body position, arm placement, leg angles as the reference
- Visible SKELETON/BONES colored pure WHITE (spine, ribs, pelvis, limb bones)
- ALL muscles shown with BLACK outlines/contours
- INACTIVE muscles colored GRAY
- ACTIVE/WORKING muscles engaged in this {pose_description} colored bright RED
- Clean white or light gray background
- Medical textbook anatomical illustration style
- Full body view, anatomically accurate
- Educational diagram showing muscle activation and bone structure
- Style: clean anatomical illustration with clear muscle and bone definition

Color scheme:
- Bones/skeleton: WHITE
- Active muscles: RED
- Inactive muscles: GRAY
- Outlines: BLACK"""

        muscle_img, is_placeholder = await self._generate_image(
            muscle_prompt,
            reference_image_bytes=photo_bytes,
            reference_mime_type="image/png",
        )
        muscle_bytes = self._image_to_bytes(muscle_img)
        used_placeholders = used_placeholders or is_placeholder
        logger.info("Muscles generated")

        if progress_callback:
            progress_callback(100, "Completed!")

        return GenerationResult(
            photo_bytes=photo_bytes,
            muscles_bytes=muscle_bytes,
            used_placeholders=used_placeholders,
        )

    async def generate_all(
        self,
        pose_description: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> GenerationResult:
        """Generate 2 images from text description"""
        used_placeholders = False

        if progress_callback:
            progress_callback(30, "Generating studio photo...")

        photo_img, is_placeholder = await self._generate_image(
            f"Professional yoga studio photograph, fit woman performing {pose_description}, "
            f"black yoga outfit, clean white background, soft studio lighting, full body shot"
        )
        photo_bytes = self._image_to_bytes(photo_img)
        used_placeholders = used_placeholders or is_placeholder

        if progress_callback:
            progress_callback(60, "Generating muscle visualization...")

        muscle_prompt = f"""Create an anatomical muscle and skeleton diagram based on EXACTLY this pose from the reference image.
The figure MUST match the EXACT same pose, position, and angle as shown in the reference photo.

Requirements:
- SAME body position, arm placement, leg angles as the reference
- Visible SKELETON/BONES colored pure WHITE (spine, ribs, pelvis, limb bones)
- ALL muscles shown with BLACK outlines/contours
- INACTIVE muscles colored GRAY
- ACTIVE/WORKING muscles engaged in this {pose_description} colored bright RED
- Clean white or light gray background
- Medical textbook anatomical illustration style
- Full body view, anatomically accurate
- Educational diagram showing muscle activation and bone structure"""

        muscle_img, is_placeholder = await self._generate_image(
            muscle_prompt,
            reference_image_bytes=photo_bytes,
            reference_mime_type="image/png",
        )
        muscle_bytes = self._image_to_bytes(muscle_img)
        used_placeholders = used_placeholders or is_placeholder

        if progress_callback:
            progress_callback(100, "Completed!")

        return GenerationResult(
            photo_bytes=photo_bytes,
            muscles_bytes=muscle_bytes,
            used_placeholders=used_placeholders,
        )
