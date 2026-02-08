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
import json
import logging
import re
import sys

logger = logging.getLogger(__name__)

GEMINI_VISION_MODEL = "models/gemini-3-pro-preview"
API_TIMEOUT_SECONDS = 60

_VISION_PROMPT = """\
Jesteś analitykiem pozy i tworzysz GOTOWY prompt do generatora obrazów.
Na podstawie obrazu referencyjnego zwróć jeden precyzyjny prompt po polsku, który odtwarza pozę jak najdokładniej.

Wymagania dla promptu:
- Jedna kobieta w studiu.
- Poza ma dokładnie odpowiadać pozy z obrazu referencyjnego (geometria ciała, kąty stawów, punkty podparcia).
- Tło w 100% białe.
- Brak dekoracji i brak akcesoriów.
- Białe ubranie i biała czapka.
- Bez cieni.
- Realistyczne zdjęcie studyjne, pełna sylwetka.

Zasady odpowiedzi:
- Zwróć wyłącznie jeden gotowy prompt po polsku.
- Bez nagłówków, bez list, bez komentarzy, bez wielu wariantów.
- Bez JSON i bez bloków markdown.
"""


def _extract_prompt_text(raw_text: str) -> str:
    """
    Normalize Gemini output to a plain prompt string.

    Gemini may return tool-style wrappers like:
    {"action": "...", "action_input": "{\\"prompt\\": \\"...\\"}"}
    """
    text = (raw_text or "").strip()
    if not text:
        return ""

    # Remove optional markdown fences around JSON payloads.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    def _from_payload(payload: object) -> str | None:
        if isinstance(payload, dict):
            prompt = payload.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                return prompt.strip()

            action_input = payload.get("action_input")
            if isinstance(action_input, dict):
                nested_prompt = action_input.get("prompt")
                if isinstance(nested_prompt, str) and nested_prompt.strip():
                    return nested_prompt.strip()
            elif isinstance(action_input, str):
                nested_text = action_input.strip()
                if nested_text:
                    try:
                        nested_payload = json.loads(nested_text)
                    except Exception:
                        nested_payload = None
                    if isinstance(nested_payload, dict):
                        nested_prompt = nested_payload.get("prompt")
                        if isinstance(nested_prompt, str) and nested_prompt.strip():
                            return nested_prompt.strip()
        return None

    try:
        payload = json.loads(text)
    except Exception:
        payload = None

    extracted = _from_payload(payload)
    if extracted:
        return extracted

    # Common fallback: assistant returns markdown with "Prompt (English)"
    # and a quoted/bold prompt line.
    english_prompt_match = re.search(
        r"(?is)prompt\s*\(english\)\s*:\s*(?:\n|\r\n)\s*>\s*\*\*(.*?)\*\*",
        text,
    )
    if english_prompt_match:
        return " ".join(english_prompt_match.group(1).split())

    # Another fallback: first markdown quote block often contains the final prompt.
    quote_lines = re.findall(r"(?m)^\s*>\s*(.+)\s*$", text)
    if quote_lines:
        first_quote = " ".join(quote_lines[0].split())
        first_quote = re.sub(r"^\*+|\*+$", "", first_quote).strip()
        if first_quote:
            return first_quote

    # Fallback: extract first JSON-like "prompt": "..."
    match = re.search(r'"prompt"\s*:\s*"((?:\\.|[^"\\])*)"', text)
    if match:
        try:
            return json.loads(f'"{match.group(1)}"').strip()
        except Exception:
            return match.group(1).strip()

    # Last-resort guard for verbose multi-option answers.
    noisy_markers = (
        "###",
        "варіант",
        "поради для генерації",
        "ось кілька варіантів",
        "wariant",
        "wskazówki",
        "oto kilka wariantów",
    )
    lowered = text.lower()
    if any(marker in lowered for marker in noisy_markers):
        # Keep only the first meaningful line to avoid feeding essay text to image model.
        for line in text.splitlines():
            cleaned = line.strip().lstrip("-* ").strip()
            if not cleaned:
                continue
            if cleaned.startswith("#"):
                continue
            if cleaned.lower().startswith(
                ("ось кілька варіантів", "поради для генерації", "oto kilka wariantów", "wskazówki")
            ):
                continue
            return " ".join(cleaned.split())

    return text


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

        raw_text = (response.text or "").strip() if response.text else ""
        text = _extract_prompt_text(raw_text)
        if text:
            if raw_text != text:
                logger.info(
                    "Vision output normalized from structured payload to prompt text "
                    "(raw=%d chars, prompt=%d chars)",
                    len(raw_text),
                    len(text),
                )
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
