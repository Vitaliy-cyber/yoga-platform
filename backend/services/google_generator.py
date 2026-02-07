"""
Google Gemini AI Generator Service.

Uses Google's Gemini API for image generation and analysis.
"""

import logging
import sys
from hashlib import sha256
from dataclasses import dataclass
from io import BytesIO
from typing import Callable, Iterable, Optional

from PIL import Image, ImageFilter, ImageOps

from config import get_settings
from services.image_validation import normalize_image_mime_type, sniff_image_mime_type
from services.pose_fidelity import PoseFidelityEvaluator
from services.pose_vision_describer import describe_pose_from_image
from services.storage import get_storage

settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass
class AnalyzedMuscle:
    """Analyzed muscle with activation level"""
    name: str  # muscle name from database (e.g., 'quadriceps', 'hamstrings')
    activation_level: int  # 0-100


@dataclass
class GenerationResult:
    """Result of layer generation - studio photo and body paint muscles"""

    photo_bytes: bytes
    muscles_bytes: bytes
    used_placeholders: bool = False
    analyzed_muscles: list[AnalyzedMuscle] | None = None


class GoogleGeminiGenerator:
    """
    AI Generator using Google Gemini API.

    Supports:
    - Image analysis (understanding pose from schema) - gemini-3-pro-preview
    - Text-to-image generation - gemini-3-pro-image-preview
    """

    _instance: Optional["GoogleGeminiGenerator"] = None
    _client: Optional["genai.Client"] = None  # type: ignore
    _initialized: bool = False

    # Model for image generation (lerailchuk@gmail.com)
    GEMINI_IMAGE_MODEL = "models/gemini-3-pro-image-preview"
    # Model for vision/analysis
    GEMINI_VISION_MODEL = "models/gemini-3-pro-preview"
    # Prefer mixed response first (matches AI Studio defaults), then strict image-only.
    IMAGE_MODALITY_PROFILES: tuple[list[str], ...] = (
        ["TEXT", "IMAGE"],
        ["IMAGE"],
    )
    IMAGE_ASPECT_RATIO = "1:1"
    IMAGE_SIZE = "2K"
    MAX_REFERENCE_SIDE = 2048
    MIN_SUBJECT_OCCUPANCY_RATIO = 0.45
    SUBJECT_CROP_MARGIN_RATIO = 0.20
    POSE_CONTROL_EDGE_THRESHOLD = 28
    # Low-stochasticity baseline for better pose stability in image generation.
    IMAGE_TEMPERATURE = 0.8
    IMAGE_TOP_P = 0.85
    IMAGE_TOP_K = 40
    MAX_PHOTO_ATTEMPTS = 3
    ALLOWED_REFERENCE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})

    POSE_SYSTEM_INSTRUCTION = (
        "You are an expert yoga photography studio specializing in anatomically "
        "precise pose reproduction. Given a reference pose diagram, you generate "
        "studio-quality photographs that faithfully replicate every joint angle, "
        "limb direction, and body orientation visible in the reference. "
        "Maintain strict visual consistency for the character across all "
        "generations: the subject is always the same fit young woman with a "
        "calm demeanor, dressed entirely in a clean, monochromatic white "
        "outfit. Her attire consists of a white fitted t-shirt, white yoga "
        "leggings, and a white head-wrap, devoid of any logos, patterns, or "
        "contrasting colors. Her physical features, skin tone, and styling "
        "must remain identical in every image to ensure character continuity "
        "throughout the series."
    )

    @staticmethod
    def _normalize_reference_mime_type(mime_type: str) -> str:
        normalized = normalize_image_mime_type(mime_type or "")
        if normalized in GoogleGeminiGenerator.ALLOWED_REFERENCE_MIME_TYPES:
            return normalized
        return "image/png"

    def _get_pose_fidelity_evaluator(self) -> PoseFidelityEvaluator:
        evaluator = getattr(self, "_pose_fidelity_evaluator", None)
        if evaluator is None:
            evaluator = PoseFidelityEvaluator()
            self._pose_fidelity_evaluator = evaluator
        return evaluator

    @staticmethod
    def _seed_from_task(task_id: str, stage: str, attempt: int) -> int:
        """
        Produce deterministic but stage/attempt-specific seed to reduce random drift
        while keeping retries exploratory across attempts.
        """
        digest = sha256(f"{task_id}:{stage}:{attempt}".encode("utf-8")).digest()
        # Gemini expects INT32-compatible seed values.
        # Keep deterministic mapping while constraining to 0..2_147_483_647.
        return int.from_bytes(digest[:4], byteorder="big", signed=False) & 0x7FFFFFFF

    @staticmethod
    def _seed_from_material(material: str, stage: str, attempt: int) -> int:
        """
        Stable seed for the same semantic input, independent of per-request task_id.
        This reduces run-to-run drift for repeated generations of identical input.
        """
        digest = sha256(f"{material}:{stage}:{attempt}".encode("utf-8")).digest()
        return int.from_bytes(digest[:4], byteorder="big", signed=False) & 0x7FFFFFFF

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

    # Timeout for Google API calls (in seconds)
    API_TIMEOUT_SECONDS = 120

    @classmethod
    async def _run_with_timeout(cls, call: Callable[[], object]) -> object:
        """
        Run a blocking SDK call with timeout.

        During pytest runs we execute synchronously to avoid hanging worker
        threads created by asyncio.to_thread under heavy mocking.
        """
        import asyncio

        if "pytest" in sys.modules:
            return call()
        return await asyncio.wait_for(
            asyncio.to_thread(call), timeout=cls.API_TIMEOUT_SECONDS
        )

    # Valid muscle names from database
    VALID_MUSCLE_NAMES = [
        "erector_spinae", "latissimus_dorsi", "trapezius", "rhomboids",
        "rectus_abdominis", "obliques", "transverse_abdominis",
        "quadriceps", "hamstrings", "gluteus_maximus", "gluteus_medius",
        "calves", "hip_flexors", "deltoids", "rotator_cuff",
        "biceps", "triceps", "forearms", "pectoralis", "serratus_anterior"
    ]

    async def _analyze_muscles_from_image(
        self, image_bytes: bytes, mime_type: str, pose_description: str
    ) -> list[AnalyzedMuscle]:
        """
        Analyze which muscles are active in the yoga pose using Gemini vision.
        Returns a list of AnalyzedMuscle with name and activation_level (0-100).
        """
        import asyncio
        import json
        from google.genai import types

        logger.info("Analyzing active muscles from pose image...")

        if self._client is None:
            raise RuntimeError("Google Gemini client not initialized")

        valid_muscles_str = ", ".join(self.VALID_MUSCLE_NAMES)

        try:
            response = await self._run_with_timeout(
                lambda: self._client.models.generate_content(
                    model=self.GEMINI_VISION_MODEL,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        f"""Analyze this yoga pose image and identify which muscles are actively engaged.

Pose description: {pose_description}

ONLY use muscle names from this list:
{valid_muscles_str}

For each active muscle, estimate the activation level from 0 to 100:
- 70-100: Primary muscles doing most of the work (high activation)
- 40-69: Secondary muscles providing support (medium activation)
- 1-39: Stabilizing muscles with minor engagement (low activation)

Return ONLY a JSON array with the active muscles. Example format:
[{{"name": "quadriceps", "activation": 85}}, {{"name": "gluteus_maximus", "activation": 70}}, {{"name": "hamstrings", "activation": 45}}]

Important rules:
- Only include muscles that are actually active in this pose
- Use EXACT names from the list above
- Return ONLY valid JSON array, no other text
- Typically 3-8 muscles are active in a yoga pose""",
                    ],
                )
            )

            response_text = response.text.strip() if response.text else "[]"

            # Clean up response - extract JSON if wrapped in markdown
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            logger.info(f"Muscle analysis response: {response_text[:200]}")

            # Parse JSON
            muscles_data = json.loads(response_text)

            analyzed_muscles = []
            for muscle_data in muscles_data:
                name = muscle_data.get("name", "").lower().strip()
                activation = muscle_data.get("activation", 50)

                # Validate muscle name
                if name in self.VALID_MUSCLE_NAMES:
                    # Clamp activation to 0-100
                    activation = max(0, min(100, int(activation)))
                    analyzed_muscles.append(AnalyzedMuscle(name=name, activation_level=activation))
                else:
                    logger.warning(f"Unknown muscle name from AI: {name}")

            logger.info(f"Analyzed {len(analyzed_muscles)} active muscles")
            return analyzed_muscles

        except asyncio.TimeoutError:
            logger.warning(f"Google API call timed out after {self.API_TIMEOUT_SECONDS}s")
            return []
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse muscle analysis JSON: {e}")
            return []
        except Exception as e:
            logger.warning(f"Failed to analyze muscles: {e}")
            return []

    def _build_photo_prompt(
        self,
        pose_description: Optional[str],
        additional_notes: Optional[str],
        *,
        attempt: int = 0,
    ) -> str:
        prompt = (
            "A single practitioner holds the exact yoga pose depicted in the "
            "reference image, photographed in a professional studio setting. "
            "Soft, even lighting wraps around the body from above and slightly "
            "in front, casting gentle shadows that reveal the contours of each "
            "muscle group. The practitioner wears a light-colored yoga outfit "
            "that contrasts cleanly against a neutral seamless backdrop, "
            "allowing every limb angle and joint position to read clearly in "
            "the frame."
        )

        if pose_description and pose_description.strip():
            prompt += (
                f" {pose_description.strip()}"
                " The body mirrors the reference diagram precisely, preserving "
                "every bend, extension, and rotation visible in the original."
            )
        else:
            prompt += (
                " The body replicates the reference diagram exactly, "
                "maintaining the same limb placement, joint bend angles, "
                "torso orientation, and camera viewpoint."
            )

        prompt += (
            " Natural body proportions ground the image in realism while "
            "the camera captures the full figure centered in a square "
            "composition with no cropping of extremities."
        )

        if attempt >= 1:
            prompt += (
                " Pay meticulous attention to matching every joint angle, "
                "limb direction, and the overall body silhouette against "
                "the reference so the pose is an exact geometric replica."
            )

        if additional_notes and additional_notes.strip():
            prompt += f" {additional_notes.strip()}"

        return prompt

    def _build_muscle_prompt(
        self, additional_notes: Optional[str], attempt: int
    ) -> str:
        base_prompt = f"""Professional anatomical muscle illustration in the style of Frédéric Delavier.

Transform the source image into an ecorché figure while preserving EXACTLY the same pose, body position, and viewing angle.
The source image is the single source of truth for pose geometry.

Style and anatomy:
- Visualization of the superficial muscular system only
- The body is composed of dense, opaque muscle tissue with visible fiber texture
- Scientific pencil sketch style
- High contrast, precise myology, hyper-realistic muscle definition
- Clean pure white background

Color coding (automatic, for any pose):
- Highlight STRETCHING muscles in RED
- Highlight CONTRACTING muscles in BLUE

Hard exclusions:
- NO skeleton, NO visible bones, NO skull, NO ribs, NO spine
- NO x-ray effect, NO transparent/translucent body
- NO internal organs
- NO skin, NO clothing
- NO text, NO labels, NO watermark"""

        if attempt == 1:
            base_prompt += """

IMPORTANT CORRECTION:
- ABSOLUTELY NO skeleton / bones / x-ray / organs
- Muscles must be dense and opaque; nothing internal may be visible"""
        elif attempt >= 2:
            base_prompt += """

IMPORTANT CORRECTION:
- Muscles must cover most of the body surface as dense opaque tissue (not minimal contours)
- Strong contrast between RED (stretching) and BLUE (contracting)
- Avoid monochrome diagrams or sparse line-art"""

        if additional_notes and additional_notes.strip():
            base_prompt += f"""

ADDITIONAL USER INSTRUCTIONS (apply these modifications):
{additional_notes.strip()}"""

        return base_prompt

    @staticmethod
    def _muscle_image_metrics(image: Image.Image) -> dict[str, float]:
        import numpy as np

        img = image.convert("RGB")
        pixels = np.array(img)
        if pixels.size == 0:
            return {
                "nonwhite_ratio": 0.0,
                "red_ratio": 0.0,
                "blue_ratio": 0.0,
                "dark_ratio": 0.0,
            }

        r = pixels[:, :, 0]
        g = pixels[:, :, 1]
        b = pixels[:, :, 2]
        total = float(r.size)

        max_rgb = np.maximum(np.maximum(r, g), b)
        min_rgb = np.minimum(np.minimum(r, g), b)
        chroma = max_rgb - min_rgb

        nonwhite_mask = (r < 245) | (g < 245) | (b < 245)
        red_mask = (
            (r >= 70)
            & ((r - np.maximum(g, b)) >= 25)
            & (chroma >= 25)
        )
        blue_mask = (
            (b >= 70)
            & ((b - np.maximum(r, g)) >= 25)
            & (chroma >= 25)
        )
        dark_mask = (r < 95) & (g < 95) & (b < 95)

        return {
            "nonwhite_ratio": float(np.count_nonzero(nonwhite_mask)) / total,
            "red_ratio": float(np.count_nonzero(red_mask)) / total,
            "blue_ratio": float(np.count_nonzero(blue_mask)) / total,
            "dark_ratio": float(np.count_nonzero(dark_mask)) / total,
        }

    @staticmethod
    def _muscle_quality_score(metrics: dict[str, float]) -> float:
        # Weighted heuristic used as tie-breaker when no attempt passes quality thresholds.
        return (
            metrics["nonwhite_ratio"] * 0.45
            + (metrics["red_ratio"] + metrics["blue_ratio"]) * 0.35
            + max(metrics["red_ratio"], metrics["blue_ratio"]) * 0.1
            + metrics["dark_ratio"] * 0.1
        )

    @staticmethod
    def _is_good_muscle_metrics(metrics: dict[str, float]) -> bool:
        colored_ratio = metrics["red_ratio"] + metrics["blue_ratio"]
        return (
            metrics["nonwhite_ratio"] >= 0.04
            and colored_ratio >= 0.003
            and max(metrics["red_ratio"], metrics["blue_ratio"]) >= 0.001
            and metrics["dark_ratio"] >= 0.001
        )

    @classmethod
    def _is_good_muscle_image(cls, image: Image.Image) -> bool:
        metrics = cls._muscle_image_metrics(image)
        return cls._is_good_muscle_metrics(metrics)

    @classmethod
    def _build_generation_config(
        cls,
        types_module: object,
        modalities: list[str],
        *,
        seed: int | None = None,
        system_instruction: str | None = None,
    ) -> object:
        config_kwargs: dict[str, object] = {"response_modalities": modalities}

        image_config_cls = getattr(types_module, "ImageConfig", None)
        if image_config_cls is not None:
            image_config = None
            for image_config_kwargs in (
                {"aspect_ratio": cls.IMAGE_ASPECT_RATIO, "image_size": cls.IMAGE_SIZE},
                {"aspect_ratio": cls.IMAGE_ASPECT_RATIO},
            ):
                try:
                    image_config = image_config_cls(**image_config_kwargs)
                    break
                except TypeError:
                    continue
                except Exception as e:
                    logger.warning(
                        "Failed to construct ImageConfig with %s: %s",
                        image_config_kwargs,
                        e,
                    )
                    continue
            if image_config is not None:
                config_kwargs["image_config"] = image_config

        safety_setting_cls = getattr(types_module, "SafetySetting", None)
        harm_category_cls = getattr(types_module, "HarmCategory", None)
        harm_threshold_cls = getattr(types_module, "HarmBlockThreshold", None)
        if (
            safety_setting_cls is not None
            and harm_category_cls is not None
            and harm_threshold_cls is not None
        ):
            threshold = getattr(harm_threshold_cls, "BLOCK_ONLY_HIGH", None) or getattr(
                harm_threshold_cls, "BLOCK_MEDIUM_AND_ABOVE", None
            )
            categories = [
                getattr(harm_category_cls, "HARM_CATEGORY_SEXUALLY_EXPLICIT", None),
                getattr(harm_category_cls, "HARM_CATEGORY_DANGEROUS_CONTENT", None),
                getattr(harm_category_cls, "HARM_CATEGORY_HARASSMENT", None),
                getattr(harm_category_cls, "HARM_CATEGORY_HATE_SPEECH", None),
            ]
            if threshold is not None:
                safety_settings = []
                for category in categories:
                    if category is None:
                        continue
                    try:
                        safety_settings.append(
                            safety_setting_cls(category=category, threshold=threshold)
                        )
                    except Exception as e:
                        logger.warning("Failed to construct safety setting: %s", e)
                        safety_settings = []
                        break
                if safety_settings:
                    config_kwargs["safety_settings"] = safety_settings

        # Keep output more deterministic for pose-critical generation.
        # Some SDK versions may not accept all fields, so we progressively degrade.
        config_with_sampling = dict(config_kwargs)
        config_with_sampling["temperature"] = cls.IMAGE_TEMPERATURE
        config_with_sampling["top_p"] = cls.IMAGE_TOP_P
        config_with_sampling["top_k"] = cls.IMAGE_TOP_K
        if seed is not None:
            # Defensive clamp: keep seed in INT32 range accepted by Gemini API.
            config_with_sampling["seed"] = int(seed) & 0x7FFFFFFF
        if system_instruction is not None:
            config_with_sampling["system_instruction"] = system_instruction

        removable_sampling_keys = (
            "system_instruction", "seed", "top_k", "top_p", "temperature",
        )
        attempt_kwargs = dict(config_with_sampling)
        while True:
            try:
                return types_module.GenerateContentConfig(**attempt_kwargs)
            except Exception as e:
                keys_left = [k for k in removable_sampling_keys if k in attempt_kwargs]
                if not keys_left:
                    raise
                message = str(e)
                unsupported_sampling_error = (
                    "unexpected keyword argument" in message
                    or "extra inputs are not permitted" in message.lower()
                    or "extra_forbidden" in message.lower()
                )
                if not unsupported_sampling_error and not any(
                    key in message for key in keys_left
                ):
                    raise
                key_to_remove = next(
                    (k for k in keys_left if k in message),
                    keys_left[0],
                )
                attempt_kwargs.pop(key_to_remove, None)
                logger.warning(
                    "GenerateContentConfig rejected '%s'; retrying without it (%s)",
                    key_to_remove,
                    e,
                )

    @classmethod
    def _prepare_reference_image(
        cls, image_bytes: bytes, mime_type: str
    ) -> tuple[bytes, str, tuple[int, int], tuple[int, int]]:
        """
        Normalize reference image for stable conditioning:
        - apply EXIF orientation
        - convert to RGB
        - letterbox to square canvas (1:1) with white background
        """
        source_mime = cls._normalize_reference_mime_type(mime_type)
        if not image_bytes:
            return image_bytes, source_mime, (0, 0), (0, 0)

        with Image.open(BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img)

            if img.mode in {"RGBA", "LA"}:
                alpha = img.getchannel("A")
                rgb = Image.new("RGB", img.size, (255, 255, 255))
                rgb.paste(img.convert("RGB"), mask=alpha)
                img = rgb
            else:
                img = img.convert("RGB")

            original_size = img.size

            # Keep reference within a stable upper bound to avoid huge payloads.
            longest_side = max(original_size)
            if longest_side > cls.MAX_REFERENCE_SIDE:
                scale = cls.MAX_REFERENCE_SIDE / float(longest_side)
                resized = (
                    max(1, int(round(original_size[0] * scale))),
                    max(1, int(round(original_size[1] * scale))),
                )
                resampling = getattr(Image, "Resampling", Image)
                lanczos = getattr(resampling, "LANCZOS", Image.LANCZOS)
                img = img.resize(resized, lanczos)

            # Reduce empty margins when the subject occupies a tiny part of the frame.
            img = cls._crop_subject_if_too_small(img)

            w, h = img.size
            if w != h:
                side = max(w, h)
                square = Image.new("RGB", (side, side), (255, 255, 255))
                square.paste(img, ((side - w) // 2, (side - h) // 2))
                img = square

            # Run one additional conservative crop pass after square-letterboxing.
            # This helps portrait schematics avoid becoming too small in 1:1 output.
            recropped = cls._crop_subject_if_too_small(img)
            if recropped.size != img.size:
                rw, rh = recropped.size
                side = max(rw, rh)
                square = Image.new("RGB", (side, side), (255, 255, 255))
                square.paste(recropped, ((side - rw) // 2, (side - rh) // 2))
                img = square

            prepared_size = img.size
            out = BytesIO()
            img.save(out, format="PNG")
            return out.getvalue(), "image/png", original_size, prepared_size

    @classmethod
    def _crop_subject_if_too_small(cls, img: Image.Image) -> Image.Image:
        """
        Auto-crop large white margins so body geometry occupies more of the conditioning image.
        Keeps behavior conservative and deterministic.
        """
        import numpy as np

        rgb = img.convert("RGB")
        arr = np.array(rgb)
        if arr.size == 0:
            return rgb

        # Adaptive foreground heuristic. More robust than static RGB<245 for
        # light-on-light schemes and pale clothing.
        gray = (0.299 * arr[:, :, 0]) + (0.587 * arr[:, :, 1]) + (0.114 * arr[:, :, 2])
        bg_level = float(np.percentile(gray, 97))
        fg_cutoff = max(80.0, min(248.0, bg_level - 8.0))
        brightness_mask = gray < fg_cutoff

        color_distance = np.sqrt(
            ((255 - arr[:, :, 0].astype(np.float32)) ** 2)
            + ((255 - arr[:, :, 1].astype(np.float32)) ** 2)
            + ((255 - arr[:, :, 2].astype(np.float32)) ** 2)
        )
        color_mask = color_distance > 20.0
        foreground = brightness_mask | color_mask
        ys, xs = np.where(foreground)
        if ys.size == 0 or xs.size == 0:
            return rgb

        h, w = arr.shape[:2]
        frame_area = float(max(1, h * w))

        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bw = max(1, x1 - x0 + 1)
        bh = max(1, y1 - y0 + 1)
        subject_area = float(bw * bh)
        occupancy = subject_area / frame_area

        if occupancy >= cls.MIN_SUBJECT_OCCUPANCY_RATIO:
            return rgb

        margin_x = int(max(2, bw * cls.SUBJECT_CROP_MARGIN_RATIO))
        margin_y = int(max(2, bh * cls.SUBJECT_CROP_MARGIN_RATIO))
        cx0 = max(0, x0 - margin_x)
        cy0 = max(0, y0 - margin_y)
        cx1 = min(w, x1 + margin_x + 1)
        cy1 = min(h, y1 + margin_y + 1)

        if (cx1 - cx0) < 8 or (cy1 - cy0) < 8:
            return rgb

        return rgb.crop((cx0, cy0, cx1, cy1))

    @classmethod
    def _build_pose_control_reference(cls, image_bytes: bytes) -> tuple[bytes, str]:
        """
        Build a Canny-style edge map from the already prepared reference.
        Black edge lines on white background preserving internal structure
        and joint details for better pose geometry conditioning.

        Uses numpy-based Sobel gradients with non-maximum suppression and
        hysteresis thresholding (manual Canny). Falls back to original image
        if edge detection fails.
        """
        import numpy as np
        from collections import deque

        try:
            with Image.open(BytesIO(image_bytes)) as img:
                gray = img.convert("L")
                gray_arr = np.array(gray, dtype=np.float64)
                if gray_arr.size == 0:
                    return image_bytes, "image/png"

                h, w = gray_arr.shape

                # -- Gaussian blur (5x5, sigma~1.4) to suppress noise --
                k1d = np.array([1, 4, 6, 4, 1], dtype=np.float64) / 16.0
                padded = np.pad(gray_arr, ((0, 0), (2, 2)), mode="reflect")
                blurred_h = np.zeros_like(gray_arr)
                for k in range(5):
                    blurred_h += padded[:, k:k + w] * k1d[k]
                padded = np.pad(blurred_h, ((2, 2), (0, 0)), mode="reflect")
                blurred = np.zeros_like(gray_arr)
                for k in range(5):
                    blurred += padded[k:k + h, :] * k1d[k]

                # -- Sobel gradient --
                sx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float64)
                sy = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float64)
                pad_b = np.pad(blurred, ((1, 1), (1, 1)), mode="reflect")
                gx = np.zeros_like(blurred)
                gy = np.zeros_like(blurred)
                for dy in range(3):
                    for dx in range(3):
                        gx += pad_b[dy:dy + h, dx:dx + w] * sx[dy, dx]
                        gy += pad_b[dy:dy + h, dx:dx + w] * sy[dy, dx]

                magnitude = np.sqrt(gx * gx + gy * gy)
                mag_max = magnitude.max()
                if mag_max < 1e-6:
                    return image_bytes, "image/png"
                magnitude = magnitude * (255.0 / mag_max)

                # Gradient direction quantized to 4 bins
                angle = np.arctan2(gy, gx) * (180.0 / np.pi)
                angle[angle < 0] += 180.0

                # -- Vectorized non-maximum suppression --
                mag_i = magnitude[1:-1, 1:-1]
                ang_i = angle[1:-1, 1:-1]
                interior = np.zeros((h - 2, w - 2), dtype=np.float64)

                mask0 = ((ang_i >= 0) & (ang_i < 22.5)) | (
                    (ang_i >= 157.5) & (ang_i <= 180)
                )
                n1_0 = magnitude[1:-1, 0:-2]
                n2_0 = magnitude[1:-1, 2:]
                interior[mask0] = np.where(
                    (mag_i[mask0] >= n1_0[mask0]) & (mag_i[mask0] >= n2_0[mask0]),
                    mag_i[mask0], 0.0,
                )

                mask45 = (ang_i >= 22.5) & (ang_i < 67.5)
                n1_45 = magnitude[2:, 0:-2]
                n2_45 = magnitude[0:-2, 2:]
                interior[mask45] = np.where(
                    (mag_i[mask45] >= n1_45[mask45]) & (mag_i[mask45] >= n2_45[mask45]),
                    mag_i[mask45], 0.0,
                )

                mask90 = (ang_i >= 67.5) & (ang_i < 112.5)
                n1_90 = magnitude[0:-2, 1:-1]
                n2_90 = magnitude[2:, 1:-1]
                interior[mask90] = np.where(
                    (mag_i[mask90] >= n1_90[mask90]) & (mag_i[mask90] >= n2_90[mask90]),
                    mag_i[mask90], 0.0,
                )

                mask135 = (ang_i >= 112.5) & (ang_i < 157.5)
                n1_135 = magnitude[0:-2, 0:-2]
                n2_135 = magnitude[2:, 2:]
                interior[mask135] = np.where(
                    (mag_i[mask135] >= n1_135[mask135]) & (mag_i[mask135] >= n2_135[mask135]),
                    mag_i[mask135], 0.0,
                )

                nms = np.zeros_like(magnitude)
                nms[1:-1, 1:-1] = interior

                # -- Hysteresis thresholding --
                nonzero_nms = nms[nms > 0]
                if nonzero_nms.size == 0:
                    return image_bytes, "image/png"

                high_thresh = max(
                    float(np.percentile(nonzero_nms, 70)),
                    float(cls.POSE_CONTROL_EDGE_THRESHOLD),
                )
                low_thresh = max(high_thresh * 0.4, high_thresh * 0.3)

                strong = nms >= high_thresh
                weak = (nms >= low_thresh) & ~strong

                # Edge tracking: connect weak pixels adjacent to strong ones
                edges_out = np.zeros_like(nms, dtype=np.uint8)
                edges_out[strong] = 255

                ys_s, xs_s = np.where(strong)
                queue = deque(zip(ys_s.tolist(), xs_s.tolist()))
                while queue:
                    cy, cx = queue.popleft()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and weak[ny, nx]:
                                edges_out[ny, nx] = 255
                                weak[ny, nx] = False
                                queue.append((ny, nx))

                # Black edges on white background
                canvas = np.full((h, w), 255, dtype=np.uint8)
                canvas[edges_out > 0] = 0

                edge_ratio = float(np.count_nonzero(edges_out)) / float(max(1, h * w))
                if edge_ratio < 0.005:
                    return image_bytes, "image/png"

                control_img = Image.fromarray(canvas).convert("RGB")
                out = BytesIO()
                control_img.save(out, format="PNG")
                return out.getvalue(), "image/png"
        except Exception:
            logger.warning("Edge map generation failed, falling back to original image")
            return image_bytes, "image/png"

    @staticmethod
    def _append_pose_control_instructions(prompt: str) -> str:
        return (
            f"{prompt} Accompanying the original pose diagram is a derived "
            "edge map that traces the body contours, internal joint structure, "
            "and limb boundaries against a clean white background. Use both "
            "references together to anchor the body shape, aligning every "
            "joint angle and limb trajectory so the generated figure matches "
            "the spatial geometry shown in the edge map precisely."
        )

    async def _generate_image(
        self,
        prompt: str,
        reference_image_bytes: Optional[bytes] = None,
        reference_mime_type: Optional[str] = None,
        max_retries: int = 3,
        *,
        reference_already_prepared: bool = False,
        include_pose_control: bool = False,
        generation_seed: int | None = None,
        system_instruction: str | None = None,
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
            ref_mime_type = self._normalize_reference_mime_type(
                reference_mime_type or "image/png"
            )
            prepared_ref_bytes = reference_image_bytes
            prepared_ref_mime_type = ref_mime_type
            if not reference_already_prepared:
                try:
                    (
                        prepared_ref_bytes,
                        prepared_ref_mime_type,
                        original_size,
                        prepared_size,
                    ) = self._prepare_reference_image(reference_image_bytes, ref_mime_type)
                    logger.info(
                        "Prepared reference image for Gemini: mime=%s original=%sx%s prepared=%sx%s",
                        prepared_ref_mime_type,
                        original_size[0],
                        original_size[1],
                        prepared_size[0],
                        prepared_size[1],
                    )
                except Exception as e:
                    sniffed_mime = sniff_image_mime_type(reference_image_bytes)
                    if sniffed_mime in self.ALLOWED_REFERENCE_MIME_TYPES:
                        prepared_ref_mime_type = sniffed_mime
                    logger.warning(
                        "Failed to preprocess reference image, using raw bytes: %s",
                        e,
                    )

            # Follow common multimodal ordering: image(s) first, then text prompt.
            content_parts = [
                types.Part.from_bytes(
                    data=prepared_ref_bytes, mime_type=prepared_ref_mime_type
                )
            ]
            if include_pose_control:
                try:
                    control_bytes, control_mime_type = self._build_pose_control_reference(
                        prepared_ref_bytes
                    )
                    content_parts.append(
                        types.Part.from_bytes(data=control_bytes, mime_type=control_mime_type)
                    )
                    prompt = self._append_pose_control_instructions(prompt)
                except Exception as e:
                    logger.warning("Failed to build pose-control guide image: %s", e)

            contents = [*content_parts, prompt]
        else:
            contents = prompt

        if self._client is None:
            raise RuntimeError("Google Gemini client not initialized")

        active_seed = generation_seed
        for attempt in range(max_retries):
            try:
                allow_seed = active_seed is not None
                for modalities in self.IMAGE_MODALITY_PROFILES:
                    config_seed = active_seed if allow_seed else None
                    try:
                        def _call_generate_content(
                            *,
                            _modalities=modalities,
                            _seed=config_seed,
                            _contents=contents,
                            _model=self.GEMINI_IMAGE_MODEL,
                            _system_instruction=system_instruction,
                        ):
                            return self._client.models.generate_content(
                                model=_model,
                                contents=_contents,
                                config=self._build_generation_config(
                                    types, _modalities, seed=_seed,
                                    system_instruction=_system_instruction,
                                ),
                            )

                        response = await self._run_with_timeout(_call_generate_content)
                    except ClientError as e:
                        if allow_seed and self._is_seed_invalid_error(e):
                            allow_seed = False
                            active_seed = None
                            logger.warning(
                                "Gemini rejected generation seed; retrying without seed "
                                "(attempt %s/%s)",
                                attempt + 1,
                                max_retries,
                            )
                            break
                        # Non-rate-limit client errors can be modality-specific.
                        # Try the next modality profile before giving up.
                        error_msg = str(e)
                        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                            raise
                        logger.warning(
                            "Gemini client error with modalities=%s: %s",
                            modalities,
                            e,
                        )
                        continue

                    pil_image = self._extract_image_from_response(response)
                    if pil_image is not None:
                        return pil_image, False
                    logger.warning(
                        "No image in Gemini response (attempt %s/%s, modalities=%s)",
                        attempt + 1,
                        max_retries,
                        modalities,
                    )
                else:
                    logger.warning(
                        "Gemini returned no image for any modality profile (attempt %s/%s)",
                        attempt + 1,
                        max_retries,
                    )
                    continue
                logger.warning(
                    "Retrying modality profiles without seed after INVALID_ARGUMENT "
                    "(attempt %s/%s)",
                    attempt + 1,
                    max_retries,
                )

            except asyncio.TimeoutError:
                logger.warning(
                    f"Google API call timed out after {self.API_TIMEOUT_SECONDS}s "
                    f"(attempt {attempt + 1}/{max_retries})"
                )
                # Timeout is treated similar to rate limiting - retry with backoff
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 5
                    await asyncio.sleep(wait_time)
                    continue
                break

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
                logger.warning(f"API error: {e}")
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2
                    await asyncio.sleep(wait_time)
                    continue
                break

            except Exception as e:
                logger.warning(f"Image generation error: {e}")
                break

        # Fallback: create placeholder image
        logger.warning(
            "Using placeholder image after generation failure "
            "(e.g. invalid request, quota exhaustion, or transient API error)"
        )
        img = Image.new("RGB", (1024, 1024), color=(200, 200, 200))
        return img, True

    @staticmethod
    def _is_seed_invalid_error(error: Exception) -> bool:
        message = str(error).lower()
        return (
            "invalid_argument" in message
            and "generation_config.seed" in message
        )

    @staticmethod
    def _iter_response_parts(response: object) -> Iterable[object]:
        """Yield candidate parts across SDK response layouts."""
        direct_parts = getattr(response, "parts", None)
        if direct_parts:
            for part in direct_parts:
                yield part

        candidates = getattr(response, "candidates", None)
        if not candidates:
            return
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            if content is None:
                continue
            parts = getattr(content, "parts", None)
            if not parts:
                continue
            for part in parts:
                yield part

    @classmethod
    def _extract_image_from_response(cls, response: object) -> Optional[Image.Image]:
        """Extract first inline image from Gemini response."""
        for part in cls._iter_response_parts(response):
            # Newer SDK helper
            as_image = getattr(part, "as_image", None)
            if callable(as_image):
                try:
                    image = as_image()
                    if isinstance(image, Image.Image):
                        return image
                except Exception:
                    pass

            inline_data = getattr(part, "inline_data", None)
            data = getattr(inline_data, "data", None) if inline_data is not None else None
            if data is None:
                continue
            try:
                if isinstance(data, str):
                    import base64

                    image_bytes = base64.b64decode(data)
                else:
                    image_bytes = data
                pil_image = Image.open(BytesIO(image_bytes))
                pil_image.load()
                return pil_image
            except Exception:
                continue
        return None

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
        additional_notes: Optional[str] = None,
        pose_description: Optional[str] = None,
    ) -> GenerationResult:
        """
        Generate 2 images from uploaded schema image.

        1. Generate realistic studio photo (conditioned on schema image)
        2. Generate body paint muscle visualization (conditioned on generated photo)

        Args:
            additional_notes: Optional user instructions to customize generation
        """

        async def update_progress(progress: int, message: str):
            if progress_callback:
                result = progress_callback(progress, message)
                # Handle both sync and async callbacks
                if hasattr(result, "__await__"):
                    await result

        # Step 1: Prepare (5%)
        await update_progress(5, "Preparing pose...")

        used_placeholders = False
        reference_bytes_for_model = image_bytes
        reference_mime_for_model = mime_type
        reference_is_prepared = False

        try:
            (
                prepared_ref_bytes,
                prepared_ref_mime,
                original_size,
                prepared_size,
            ) = self._prepare_reference_image(image_bytes, mime_type)
            reference_bytes_for_model = prepared_ref_bytes
            reference_mime_for_model = prepared_ref_mime
            reference_is_prepared = True
            logger.info(
                "Prepared source image once for generation/fidelity: mime=%s original=%sx%s prepared=%sx%s",
                prepared_ref_mime,
                original_size[0],
                original_size[1],
                prepared_size[0],
                prepared_size[1],
            )
        except Exception as e:
            logger.warning(
                "Failed to preprocess source image before generation; using original bytes: %s",
                e,
            )

        # Step 2: Describe pose via Gemini Vision (10%)
        await update_progress(10, "Analyzing pose with vision model...")

        vision_description = await describe_pose_from_image(
            self._client, reference_bytes_for_model, reference_mime_for_model
        )
        if vision_description:
            if pose_description and pose_description.strip():
                pose_description = f"{pose_description.strip()}\n\n{vision_description}"
            else:
                pose_description = vision_description

        source_seed_material = sha256(reference_bytes_for_model).hexdigest()
        if pose_description and pose_description.strip():
            source_seed_material = sha256(
                f"{source_seed_material}|pose:{pose_description.strip()}".encode("utf-8")
            ).hexdigest()
        if additional_notes and additional_notes.strip():
            source_seed_material = sha256(
                f"{source_seed_material}|notes:{additional_notes.strip()}".encode("utf-8")
            ).hexdigest()

        # Step 3: Generate studio photo with fidelity retry loop (20%)
        await update_progress(20, "Generating studio photo...")

        best_photo_img: Optional[Image.Image] = None
        best_photo_score = -1.0
        photo_is_placeholder = False

        for attempt in range(self.MAX_PHOTO_ATTEMPTS):
            photo_prompt = self._build_photo_prompt(
                pose_description, additional_notes, attempt=attempt
            )
            photo_img, is_placeholder = await self._generate_image(
                photo_prompt,
                reference_image_bytes=reference_bytes_for_model,
                reference_mime_type=reference_mime_for_model,
                reference_already_prepared=reference_is_prepared,
                include_pose_control=True,
                generation_seed=self._seed_from_material(
                    source_seed_material, "photo", attempt
                ),
                system_instruction=self.POSE_SYSTEM_INSTRUCTION,
            )
            if is_placeholder:
                raise RuntimeError("Gemini failed to generate studio photo after retries.")

            candidate_bytes = self._image_to_bytes(photo_img)

            # Persist every attempt to disk for later review
            try:
                storage = get_storage()
                attempt_key = f"generated/{task_id}_photo_attempt{attempt + 1}.png"
                await storage.upload_bytes(candidate_bytes, attempt_key, "image/png")
                logger.info("Saved fidelity attempt %d to %s", attempt + 1, attempt_key)
            except Exception as exc:
                logger.warning("Failed to save fidelity attempt %d: %s", attempt + 1, exc)

            # Evaluate pose fidelity against the reference
            try:
                evaluator = self._get_pose_fidelity_evaluator()
                fidelity = evaluator.evaluate(reference_bytes_for_model, candidate_bytes)
                score = fidelity.pose_score

                if best_photo_img is None or score > best_photo_score:
                    best_photo_img = photo_img
                    best_photo_score = score
                    photo_is_placeholder = is_placeholder

                if fidelity.passed:
                    logger.info(
                        "Photo fidelity passed on attempt %d/%d (score=%.3f)",
                        attempt + 1,
                        self.MAX_PHOTO_ATTEMPTS,
                        score,
                    )
                    break

                logger.info(
                    "Photo fidelity check did not pass (attempt %d/%d, score=%.3f, reason=%s)",
                    attempt + 1,
                    self.MAX_PHOTO_ATTEMPTS,
                    score,
                    fidelity.failure_reason,
                )
            except Exception as exc:
                logger.warning(
                    "Pose fidelity evaluation failed on attempt %d/%d: %s; accepting result",
                    attempt + 1,
                    self.MAX_PHOTO_ATTEMPTS,
                    exc,
                )
                if best_photo_img is None:
                    best_photo_img = photo_img
                    photo_is_placeholder = is_placeholder
                break

        photo_img = best_photo_img
        is_placeholder = photo_is_placeholder
        photo_bytes = self._image_to_bytes(photo_img)
        used_placeholders = used_placeholders or is_placeholder

        logger.info("Photo generated")

        # Step 4: Generate body paint muscle visualization (50%)
        # Use generated photo as reference to keep photo + muscle output aligned.
        await update_progress(50, "Generating muscle visualization...")

        muscle_img = None
        best_muscle_img: Optional[Image.Image] = None
        best_muscle_metrics: Optional[dict[str, float]] = None
        best_muscle_score = -1.0
        is_placeholder = False
        for attempt in range(3):
            muscle_prompt = self._build_muscle_prompt(additional_notes, attempt)
            muscle_img, is_placeholder = await self._generate_image(
                muscle_prompt,
                reference_image_bytes=photo_bytes,
                reference_mime_type="image/png",
                include_pose_control=True,
                generation_seed=self._seed_from_material(
                    source_seed_material, "muscles", attempt
                ),
            )
            if is_placeholder:
                raise RuntimeError(
                    "Gemini failed to generate muscle visualization after retries."
                )

            # Persist every muscle attempt to disk for later review
            try:
                storage = get_storage()
                muscle_candidate_bytes = self._image_to_bytes(muscle_img)
                attempt_key = f"generated/{task_id}_muscles_attempt{attempt + 1}.png"
                await storage.upload_bytes(muscle_candidate_bytes, attempt_key, "image/png")
                logger.info("Saved muscle attempt %d to %s", attempt + 1, attempt_key)
            except Exception as exc:
                logger.warning("Failed to save muscle attempt %d: %s", attempt + 1, exc)

            metrics = self._muscle_image_metrics(muscle_img)
            score = self._muscle_quality_score(metrics)
            if best_muscle_img is None or score > best_muscle_score:
                best_muscle_img = muscle_img
                best_muscle_metrics = metrics
                best_muscle_score = score
            if self._is_good_muscle_metrics(metrics):
                break
            logger.info(
                f"Muscle image quality check failed (attempt {attempt + 1}/3): {metrics}"
            )
        if not is_placeholder and best_muscle_img is not None:
            if muscle_img is None:
                muscle_img = best_muscle_img
            else:
                final_metrics = self._muscle_image_metrics(muscle_img)
                if not self._is_good_muscle_metrics(final_metrics):
                    muscle_img = best_muscle_img
                    logger.info(
                        "Using best available muscle image after retries: %s",
                        best_muscle_metrics,
                    )
        muscle_bytes = self._image_to_bytes(muscle_img)
        used_placeholders = used_placeholders or is_placeholder
        logger.info("Muscles generated")

        # Step 5: Analyze which muscles are active in this pose (85%)
        await update_progress(85, "Analyzing active muscles...")
        analyzed_muscles = await self._analyze_muscles_from_image(
            photo_bytes, "image/png", "Yoga pose (use image as source of truth)"
        )
        logger.info(f"Muscle analysis complete: {len(analyzed_muscles)} muscles identified")

        await update_progress(100, "Completed!")

        return GenerationResult(
            photo_bytes=photo_bytes,
            muscles_bytes=muscle_bytes,
            used_placeholders=used_placeholders,
            analyzed_muscles=analyzed_muscles,
        )

    async def generate_all(
        self,
        pose_description: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
        additional_notes: Optional[str] = None,
    ) -> GenerationResult:
        """
        Generate 2 images from text description.

        Progress stages:
        - 5%: Starting generation
        - 25%: Generating studio photo
        - 55%: Generating muscle visualization
        - 85%: Analyzing active muscles
        - 100%: Completed
        """

        async def update_progress(progress: int, message: str):
            if progress_callback:
                result = progress_callback(progress, message)
                # Handle both sync and async callbacks
                if hasattr(result, "__await__"):
                    await result

        used_placeholders = False

        # Step 1: Initial progress (5%)
        await update_progress(5, "Starting generation...")

        # Step 2: Generate studio photo (25%)
        await update_progress(25, "Generating studio photo...")

        text_seed_material = sha256(
            f"pose:{pose_description.strip()}|notes:{(additional_notes or '').strip()}".encode(
                "utf-8"
            )
        ).hexdigest()

        photo_img, is_placeholder = await self._generate_image(
            self._build_photo_prompt(pose_description, additional_notes),
            generation_seed=self._seed_from_material(text_seed_material, "text-photo", 0),
            system_instruction=self.POSE_SYSTEM_INSTRUCTION,
        )
        if is_placeholder:
            raise RuntimeError("Gemini failed to generate studio photo from text.")
        photo_bytes = self._image_to_bytes(photo_img)
        used_placeholders = used_placeholders or is_placeholder
        logger.info("Photo generated")

        # Step 3: Generate muscle visualization (55%)
        await update_progress(55, "Generating muscle visualization...")

        muscle_img = None
        best_muscle_img: Optional[Image.Image] = None
        best_muscle_metrics: Optional[dict[str, float]] = None
        best_muscle_score = -1.0
        is_placeholder = False
        for attempt in range(3):
            muscle_prompt = self._build_muscle_prompt(additional_notes, attempt)
            muscle_img, is_placeholder = await self._generate_image(
                muscle_prompt,
                reference_image_bytes=photo_bytes,
                reference_mime_type="image/png",
                generation_seed=self._seed_from_material(
                    text_seed_material, "text-muscles", attempt
                ),
            )
            if is_placeholder:
                raise RuntimeError(
                    "Gemini failed to generate muscle visualization from text."
                )

            # Persist every muscle attempt to disk for later review
            try:
                storage = get_storage()
                muscle_candidate_bytes = self._image_to_bytes(muscle_img)
                attempt_key = f"generated/{task_id}_muscles_attempt{attempt + 1}.png"
                await storage.upload_bytes(muscle_candidate_bytes, attempt_key, "image/png")
                logger.info("Saved muscle attempt %d to %s", attempt + 1, attempt_key)
            except Exception as exc:
                logger.warning("Failed to save muscle attempt %d: %s", attempt + 1, exc)

            metrics = self._muscle_image_metrics(muscle_img)
            score = self._muscle_quality_score(metrics)
            if best_muscle_img is None or score > best_muscle_score:
                best_muscle_img = muscle_img
                best_muscle_metrics = metrics
                best_muscle_score = score
            if self._is_good_muscle_metrics(metrics):
                break
            logger.info(
                f"Muscle image quality check failed (attempt {attempt + 1}/3): {metrics}"
            )
        if not is_placeholder and best_muscle_img is not None:
            if muscle_img is None:
                muscle_img = best_muscle_img
            else:
                final_metrics = self._muscle_image_metrics(muscle_img)
                if not self._is_good_muscle_metrics(final_metrics):
                    muscle_img = best_muscle_img
                    logger.info(
                        "Using best available muscle image after retries: %s",
                        best_muscle_metrics,
                    )
        muscle_bytes = self._image_to_bytes(muscle_img)
        used_placeholders = used_placeholders or is_placeholder
        logger.info("Muscles generated")

        # Step 4: Analyze which muscles are active in this pose (85%)
        await update_progress(85, "Analyzing active muscles...")
        analyzed_muscles = await self._analyze_muscles_from_image(
            photo_bytes, "image/png", pose_description
        )
        logger.info(f"Muscle analysis complete: {len(analyzed_muscles)} muscles identified")

        await update_progress(100, "Completed!")

        return GenerationResult(
            photo_bytes=photo_bytes,
            muscles_bytes=muscle_bytes,
            used_placeholders=used_placeholders,
            analyzed_muscles=analyzed_muscles,
        )
