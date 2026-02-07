"""
Vision-based pose describer using Gemini Vision.

Sends a reference yoga-pose image to Gemini 3 Pro (vision) and returns a
detailed anatomical description of the pose as narrative text suitable for
direct insertion into an image-generation prompt.

This replaces the MediaPipe-based pose_context module for prompt enrichment,
delegating spatial understanding entirely to the vision model.
"""

from __future__ import annotations

import asyncio
import logging
import sys

logger = logging.getLogger(__name__)

GEMINI_VISION_MODEL = "models/gemini-3-pro-preview"
API_TIMEOUT_SECONDS = 60

_VISION_PROMPT = """\
Analyze this yoga pose reference image and produce a concise, dense \
anatomical description of the body position. The description will be \
embedded verbatim into an image-generation prompt, so write it as a \
continuous narrative paragraph (no bullet points, no headings).

Cover each of the following in order:

1. Overall posture: standing, seated, prone, supine, or inverted.
2. Body orientation relative to the camera (front-facing, profile left/right, \
three-quarter, rear view).
3. Head and neck: tilt direction, rotation, gaze direction.
4. Torso: spine curvature (straight, forward fold, backbend, lateral bend, \
twist), approximate angle of the torso relative to vertical.
5. Left arm: shoulder flexion/abduction angle, elbow bend in degrees, \
forearm direction, hand placement (on floor, on knee, overhead, etc.).
6. Right arm: same details.
7. Left leg: hip flexion/abduction angle, knee bend in degrees, foot \
placement and orientation (flat on floor, on toes, lifted, etc.).
8. Right leg: same details.
9. Weight distribution: which limbs bear the body weight and approximate \
split (e.g. "weight evenly on both feet" or "full weight on right foot \
and both palms").
10. Camera angle: eye-level, slightly elevated, low angle, overhead.

Be precise with angles (use approximate degrees). Keep the description \
under 200 words. Do not name the yoga pose. Do not add preamble or \
commentary outside the description itself."""


async def _run_with_timeout(call):
    """Run a blocking SDK call with timeout, matching the project pattern."""
    if "pytest" in sys.modules:
        return call()
    return await asyncio.wait_for(
        asyncio.to_thread(call), timeout=API_TIMEOUT_SECONDS
    )


async def describe_pose_from_image(
    client: object,
    image_bytes: bytes,
    mime_type: str,
) -> str:
    """
    Send *image_bytes* to Gemini Vision and return a narrative pose
    description suitable for prompt enrichment.

    Parameters
    ----------
    client:
        An initialized ``google.genai.Client`` instance.
    image_bytes:
        Raw bytes of the reference pose image.
    mime_type:
        MIME type of *image_bytes* (e.g. ``"image/png"``).

    Returns
    -------
    str
        A narrative anatomical description, or an empty string on failure.
    """
    if not image_bytes:
        return ""

    try:
        from google.genai import types
    except ImportError:
        logger.warning("google-genai not installed; skipping vision pose description")
        return ""

    try:
        response = await _run_with_timeout(
            lambda: client.models.generate_content(
                model=GEMINI_VISION_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    _VISION_PROMPT,
                ],
            )
        )

        text = (response.text or "").strip() if response.text else ""
        if text:
            logger.info(
                "Vision pose description received (%d chars): %.120s...",
                len(text),
                text,
            )
        else:
            logger.warning("Gemini returned empty vision pose description")
        return text

    except asyncio.TimeoutError:
        logger.warning(
            "Vision pose description timed out after %ds", API_TIMEOUT_SECONDS
        )
        return ""
    except Exception as exc:
        logger.warning("Vision pose description failed: %s", exc)
        return ""
