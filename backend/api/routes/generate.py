import asyncio
import logging
import os
import sys
import uuid
from typing import Optional

import config
from db.database import AsyncSessionLocal, get_db
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from models.generation_task import GenerationTask
from models.user import User
from schemas.generate import AnalyzedMuscleResponse, GenerateResponse, GenerateStatus
from schemas.validators import ensure_utf8_encodable
from services.auth import get_current_user
from services.error_sanitizer import sanitize_public_error_message
from services.image_validation import (
    normalize_image_mime_type,
    validate_uploaded_image_payload,
)
from services.storage import S3Storage, get_storage
from services.websocket_manager import ProgressUpdate, get_connection_manager
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generate"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB

def create_task_id() -> str:
    """Create unique task ID using UUID4."""
    return str(uuid.uuid4())


async def create_generation_task_with_retry(
    db: AsyncSession,
    user_id: int,
    additional_notes: Optional[str] = None,
    max_retries: int = 3,
) -> GenerationTask:
    """
    Create a generation task with retry on UUID collision.

    UUID4 collision probability is astronomically low (2^-122), but we handle
    it gracefully just in case. On collision (IntegrityError), we generate
    a new UUID and retry.

    Args:
        db: Database session
        user_id: User ID
        additional_notes: Optional additional notes for generation
        max_retries: Maximum number of retries on collision

    Returns:
        Created GenerationTask

    Raises:
        HTTPException: If max retries exceeded (should never happen in practice)
    """
    for attempt in range(max_retries):
        task_id = create_task_id()
        task = GenerationTask(
            task_id=task_id,
            user_id=user_id,
            status=GenerateStatus.PENDING.value,
            progress=0,
            status_message="In queue...",
            additional_notes=additional_notes,
        )
        db.add(task)

        try:
            await db.flush()  # Flush to detect IntegrityError before commit
            return task
        except IntegrityError as e:
            await db.rollback()
            # Check if it's a unique constraint violation on task_id
            if "task_id" in str(e).lower() or "unique" in str(e).lower():
                logger.warning(
                    f"UUID collision detected on task_id (attempt {attempt + 1}/{max_retries}), "
                    f"retrying with new UUID..."
                )
                if attempt == max_retries - 1:
                    logger.error("Max retries exceeded for task_id generation")
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Failed to create generation task. Please try again.",
                    )
                continue
            # Re-raise if it's a different IntegrityError
            raise

    # Should never reach here, but just in case
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create generation task. Please try again.",
    )


async def update_task_progress(task_id: str, progress: int, message: str) -> bool:
    """
    Update task progress in database and broadcast via WebSocket.

    Returns True if task was updated, False if task no longer exists.
    This handles the race condition where a task may be deleted or
    polled after cleanup while generation is still in progress.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(GenerationTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        if task:
            task.progress = progress
            task.status_message = message
            await db.commit()

            # Broadcast progress via WebSocket
            manager = get_connection_manager()
            await manager.broadcast_progress(
                ProgressUpdate(
                    task_id=task_id,
                    status=task.status,
                    progress=progress,
                    status_message=message,
                )
            )

            return True
        return False


async def run_generation(
    task_id: str,
    image_bytes: bytes,
    mime_type: str,
    additional_notes: Optional[str] = None,
    pose_description: Optional[str] = None,
):
    """
    Run generation using Google Gemini API.

    Generates:
    1. Studio photo (realistic render from schema)
    2. Body paint muscles visualization
    """
    async with AsyncSessionLocal() as db:
        try:
            # Get task from DB
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return

            task.status = GenerateStatus.PROCESSING.value
            task.progress = 0
            task.status_message = "Initializing..."
            await db.commit()

            # Broadcast initial processing status via WebSocket
            manager = get_connection_manager()
            await manager.broadcast_progress(
                ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.PROCESSING.value,
                    progress=0,
                    status_message="Initializing...",
                )
            )

            storage = get_storage()

            async def progress_callback(progress: int, message: str):
                task.progress = progress
                status_message = "Finalizing..." if progress >= 100 else message
                task.status_message = status_message
                await db.commit()

                # Broadcast progress via WebSocket
                await manager.broadcast_progress(
                    ProgressUpdate(
                        task_id=task_id,
                        status=GenerateStatus.PROCESSING.value,
                        progress=progress,
                        status_message=status_message,
                    )
                )

            async def fast_placeholder_generation():
                import binascii
                import json
                import struct
                import zlib

                async def progress(p: int, msg: str):
                    await progress_callback(p, msg)

                def _png_1x1_rgb(r: int, g: int, b: int) -> bytes:
                    """
                    Create a minimal valid 1x1 RGB PNG.

                    Must be *structurally valid* so downstream consumers (ReportLab/PIL)
                    never crash on corrupted placeholders.
                    """
                    signature = b"\x89PNG\r\n\x1a\n"
                    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # RGB
                    ihdr = (
                        struct.pack(">I", len(ihdr_data))
                        + b"IHDR"
                        + ihdr_data
                        + struct.pack(
                            ">I", binascii.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF
                        )
                    )
                    raw = bytes([0, r & 0xFF, g & 0xFF, b & 0xFF])  # filter 0 + RGB
                    compressed = zlib.compress(raw)
                    idat = (
                        struct.pack(">I", len(compressed))
                        + b"IDAT"
                        + compressed
                        + struct.pack(
                            ">I", binascii.crc32(b"IDAT" + compressed) & 0xFFFFFFFF
                        )
                    )
                    iend = (
                        struct.pack(">I", 0)
                        + b"IEND"
                        + struct.pack(">I", binascii.crc32(b"IEND") & 0xFFFFFFFF)
                    )
                    return signature + ihdr + idat + iend

                await progress(5, "Analyzing pose...")
                # Create small deterministic placeholder images without heavy dependencies.
                # Large in-memory images under high concurrency can OOM-kill the dev server,
                # which breaks atomic suites with connection refusals.
                photo_png = _png_1x1_rgb(255, 255, 255)
                muscles_png = _png_1x1_rgb(255, 80, 80)

                # Keep names aligned with seeded muscles
                analyzed = [
                    {"name": "quadriceps", "activation_level": 85},
                    {"name": "gluteus_maximus", "activation_level": 70},
                    {"name": "hamstrings", "activation_level": 45},
                ]

                await progress(25, "Generating studio photo...")
                await progress(55, "Generating muscle visualization...")
                await progress(85, "Analyzing active muscles...")
                await progress(100, "Completed!")

                return photo_png, muscles_png, True, json.dumps(analyzed)

            if os.getenv("E2E_FAST_AI") == "1":
                (
                    photo_bytes,
                    muscles_bytes,
                    used_placeholders,
                    analyzed_json,
                ) = await fast_placeholder_generation()
                result_gen = None
            else:
                from services.google_generator import GoogleGeminiGenerator

                generator = GoogleGeminiGenerator.get_instance()

                result_gen = await generator.generate_all_from_image(
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    task_id=task_id,
                    progress_callback=progress_callback,
                    additional_notes=additional_notes,
                    pose_description=pose_description,
                )
                photo_bytes = result_gen.photo_bytes
                muscles_bytes = result_gen.muscles_bytes
                used_placeholders = result_gen.used_placeholders
                if used_placeholders:
                    raise RuntimeError(
                        "Generation returned placeholders instead of real AI output."
                    )
                analyzed_json = None
                if result_gen.analyzed_muscles:
                    import json

                    analyzed_json = json.dumps(
                        [
                            {"name": m.name, "activation_level": m.activation_level}
                            for m in result_gen.analyzed_muscles
                        ]
                    )

            photo_key = f"generated/{task_id}_photo.png"
            muscles_key = f"generated/{task_id}_muscles.png"

            task.photo_url = await storage.upload_bytes(
                photo_bytes, photo_key, "image/png"
            )
            task.muscles_url = await storage.upload_bytes(
                muscles_bytes, muscles_key, "image/png"
            )
            task.quota_warning = used_placeholders

            # Save analyzed muscles as JSON (if available)
            if analyzed_json:
                task.analyzed_muscles_json = analyzed_json

            task.status = GenerateStatus.COMPLETED.value
            task.progress = 100
            task.status_message = "Completed!"
            await db.commit()

            # Parse analyzed muscles for WebSocket broadcast
            analyzed_muscles_for_ws = None
            if analyzed_json:
                import json

                try:
                    analyzed_muscles_for_ws = json.loads(analyzed_json)
                except Exception:
                    analyzed_muscles_for_ws = None

            # Broadcast completion via WebSocket
            await manager.broadcast_progress(
                ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.COMPLETED.value,
                    progress=100,
                    status_message="Completed!",
                    photo_url=task.photo_url,
                    muscles_url=task.muscles_url,
                    quota_warning=task.quota_warning or False,
                    analyzed_muscles=analyzed_muscles_for_ws,
                )
            )

        except Exception as e:
            logger.exception("Generation failed (task_id=%s)", task_id)
            public_error = (
                sanitize_public_error_message(str(e), fallback="Generation failed")
                or "Generation failed"
            )
            failure_status_message = "Generation failed"

            # Re-fetch task in case session was invalidated
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = GenerateStatus.FAILED.value
                task.error_message = public_error
                task.status_message = failure_status_message
                await db.commit()

                # Broadcast failure via WebSocket
                manager = get_connection_manager()
                await manager.broadcast_progress(
                    ProgressUpdate(
                        task_id=task_id,
                        status=GenerateStatus.FAILED.value,
                        progress=task.progress,
                        status_message=failure_status_message,
                        error_message=public_error,
                    )
                )


@router.post("", response_model=GenerateResponse)
async def generate(
    background_tasks: BackgroundTasks,
    schema_file: UploadFile = File(
        ..., description="Schema image file (PNG, JPG, WEBP)"
    ),
    additional_notes: Optional[str] = Form(
        None, description="Additional instructions for AI generation"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate all layers from uploaded schema image.

    Uses Google Gemini API for image generation.

    Accepts: PNG, JPG, WEBP images up to 10MB
    """
    claimed_mime_type = normalize_image_mime_type(schema_file.content_type or "")
    if (
        claimed_mime_type
        and claimed_mime_type != "application/octet-stream"
        and not claimed_mime_type.startswith("image/")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    # Check if AI generation is configured
    settings = config.get_settings()
    if not settings.GOOGLE_API_KEY and "pytest" not in sys.modules:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation is not configured. Please set GOOGLE_API_KEY in .env",
        )

    # Read uploaded file into memory
    try:
        content = await schema_file.read()
    except Exception:
        logger.exception("Failed to read uploaded schema file")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read uploaded file",
        )

    # Check for empty file upload
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file uploaded. Please select a valid image file.",
        )

    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Max size is 10MB",
        )

    image_info = validate_uploaded_image_payload(
        content,
        claimed_mime_type=claimed_mime_type or None,
    )
    mime_type = image_info.mime_type

    # Normalize user-provided additional notes:
    # - Trim whitespace
    # - Convert empty -> None
    # - Reject invalid Unicode (e.g., unpaired surrogates) to avoid 500s on DB/JSON encoding
    if additional_notes is not None and isinstance(additional_notes, str):
        normalized = additional_notes.strip()
        if normalized:
            if len(normalized) > 500:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Additional notes too long (max 500 characters)",
                )
            try:
                additional_notes = ensure_utf8_encodable(normalized)
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(e),
                )
        else:
            additional_notes = None

    # Create task in database with retry on UUID collision
    task = await create_generation_task_with_retry(
        db=db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )
    await db.commit()

    # Start background generation (skip during tests to avoid background DB access)
    if "pytest" not in sys.modules:
        background_tasks.add_task(
            run_generation, task.task_id, content, mime_type, additional_notes
        )

    return GenerateResponse(
        task_id=task.task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


from pydantic import BaseModel, Field, field_validator


class GenerateFromPoseRequest(BaseModel):
    additional_notes: Optional[str] = Field(
        None, max_length=500, description="Additional instructions for AI generation"
    )

    @field_validator("additional_notes", mode="before")
    @classmethod
    def normalize_additional_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            return ensure_utf8_encodable(normalized)
        return value


class GenerateFromTextRequest(BaseModel):
    description: str = Field(
        ..., min_length=10, max_length=2000, description="Detailed pose description"
    )
    additional_notes: Optional[str] = Field(
        None, max_length=500, description="Additional instructions for AI generation"
    )

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        if isinstance(value, str):
            normalized = value.strip()
            return ensure_utf8_encodable(normalized)
        return value

    @field_validator("additional_notes", mode="before")
    @classmethod
    def normalize_additional_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            return ensure_utf8_encodable(normalized)
        return value


class SaveToGalleryRequest(BaseModel):
    """Request to save generation results as a new pose in gallery."""

    task_id: str = Field(..., description="Generation task ID")
    name: str = Field(..., min_length=1, max_length=200, description="Pose name")
    code: str = Field(
        ..., min_length=1, max_length=20, description="Pose code (unique)"
    )
    name_en: Optional[str] = Field(None, max_length=200, description="English name")
    category_id: Optional[int] = Field(None, description="Category ID")
    description: Optional[str] = Field(
        None, max_length=2000, description="Pose description"
    )


class SaveToGalleryResponse(BaseModel):
    """Response after saving to gallery."""

    pose_id: int
    message: str


async def run_generation_from_text(
    task_id: str, description: str, additional_notes: Optional[str] = None
):
    """
    Run generation using Google Gemini API from text description.

    Generates:
    1. Studio photo (realistic render from description)
    2. Body paint muscles visualization
    """
    async with AsyncSessionLocal() as db:
        try:
            # Get task from DB
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return

            task.status = GenerateStatus.PROCESSING.value
            task.progress = 0
            task.status_message = "Initializing..."
            await db.commit()

            # Broadcast initial processing status via WebSocket
            manager = get_connection_manager()
            await manager.broadcast_progress(
                ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.PROCESSING.value,
                    progress=0,
                    status_message="Initializing...",
                )
            )

            storage = get_storage()

            async def progress_callback(progress: int, message: str):
                task.progress = progress
                status_message = "Finalizing..." if progress >= 100 else message
                task.status_message = status_message
                await db.commit()

                # Broadcast progress via WebSocket
                await manager.broadcast_progress(
                    ProgressUpdate(
                        task_id=task_id,
                        status=GenerateStatus.PROCESSING.value,
                        progress=progress,
                        status_message=status_message,
                    )
                )

            if os.getenv("E2E_FAST_AI") == "1":
                import json
                from io import BytesIO

                from PIL import Image, ImageDraw

                await progress_callback(5, "Starting generation...")
                photo = Image.new("RGB", (1024, 1024), color=(245, 238, 230))
                ImageDraw.Draw(photo).text(
                    (32, 32), "E2E FAST AI PHOTO (TEXT)", fill=(30, 30, 30)
                )
                muscles = Image.new("RGB", (1024, 1024), color=(230, 245, 238))
                ImageDraw.Draw(muscles).text(
                    (32, 32), "E2E FAST AI MUSCLES (TEXT)", fill=(30, 30, 30)
                )
                b1 = BytesIO()
                b2 = BytesIO()
                photo.save(b1, format="PNG")
                muscles.save(b2, format="PNG")
                await progress_callback(100, "Completed!")

                photo_bytes = b1.getvalue()
                muscles_bytes = b2.getvalue()
                used_placeholders = True
                analyzed_json = json.dumps(
                    [
                        {"name": "rectus_abdominis", "activation_level": 75},
                        {"name": "obliques", "activation_level": 55},
                    ]
                )
            else:
                from services.google_generator import GoogleGeminiGenerator

                generator = GoogleGeminiGenerator.get_instance()
                result_gen = await generator.generate_all(
                    pose_description=description,
                    task_id=task_id,
                    progress_callback=progress_callback,
                    additional_notes=additional_notes,
                )
                photo_bytes = result_gen.photo_bytes
                muscles_bytes = result_gen.muscles_bytes
                used_placeholders = result_gen.used_placeholders
                if used_placeholders:
                    raise RuntimeError(
                        "Generation returned placeholders instead of real AI output."
                    )
                analyzed_json = None
                if result_gen.analyzed_muscles:
                    import json

                    analyzed_json = json.dumps(
                        [
                            {"name": m.name, "activation_level": m.activation_level}
                            for m in result_gen.analyzed_muscles
                        ]
                    )

            photo_key = f"generated/{task_id}_photo.png"
            muscles_key = f"generated/{task_id}_muscles.png"

            task.photo_url = await storage.upload_bytes(
                photo_bytes, photo_key, "image/png"
            )
            task.muscles_url = await storage.upload_bytes(
                muscles_bytes, muscles_key, "image/png"
            )
            task.quota_warning = used_placeholders

            if analyzed_json:
                task.analyzed_muscles_json = analyzed_json

            task.status = GenerateStatus.COMPLETED.value
            task.progress = 100
            task.status_message = "Completed!"
            await db.commit()

            # Parse analyzed muscles for WebSocket broadcast
            analyzed_muscles_for_ws = None
            if analyzed_json:
                import json

                try:
                    analyzed_muscles_for_ws = json.loads(analyzed_json)
                except Exception:
                    analyzed_muscles_for_ws = None

            # Broadcast completion via WebSocket
            await manager.broadcast_progress(
                ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.COMPLETED.value,
                    progress=100,
                    status_message="Completed!",
                    photo_url=task.photo_url,
                    muscles_url=task.muscles_url,
                    quota_warning=task.quota_warning or False,
                    analyzed_muscles=analyzed_muscles_for_ws,
                )
            )

        except Exception as e:
            logger.exception("Generation failed (task_id=%s)", task_id)
            public_error = (
                sanitize_public_error_message(str(e), fallback="Generation failed")
                or "Generation failed"
            )

            # Re-fetch task in case session was invalidated
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = GenerateStatus.FAILED.value
                task.error_message = public_error
                task.status_message = "Generation failed"
                await db.commit()

                # Broadcast failure via WebSocket
                manager = get_connection_manager()
                await manager.broadcast_progress(
                    ProgressUpdate(
                        task_id=task_id,
                        status=GenerateStatus.FAILED.value,
                        progress=task.progress,
                        status_message="Generation failed",
                        error_message=public_error,
                    )
                )


@router.post("/from-text", response_model=GenerateResponse)
async def generate_from_text(
    background_tasks: BackgroundTasks,
    request: GenerateFromTextRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate all layers from text description.

    Uses Google Gemini API for image generation based on the provided
    pose description. No image upload required.
    """
    # Check if AI generation is configured
    settings = config.get_settings()
    if not settings.GOOGLE_API_KEY and "pytest" not in sys.modules:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation is not configured. Please set GOOGLE_API_KEY in .env",
        )

    # Create task in database with retry on UUID collision
    task = await create_generation_task_with_retry(
        db=db,
        user_id=current_user.id,
        additional_notes=request.additional_notes,
    )
    await db.commit()

    # Start background generation
    background_tasks.add_task(
        run_generation_from_text,
        task.task_id,
        request.description,
        request.additional_notes,
    )

    return GenerateResponse(
        task_id=task.task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


@router.post("/from-pose/{pose_id}", response_model=GenerateResponse)
async def generate_from_pose(
    pose_id: int,
    background_tasks: BackgroundTasks,
    request: Optional[GenerateFromPoseRequest] = Body(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate layers from existing pose schema.

    This endpoint fetches the schema from the pose directly on the server,
    avoiding CORS issues with client-side fetch.
    """
    additional_notes = request.additional_notes if request else None
    from models.pose import Pose
    from sqlalchemy import and_

    # Check if AI generation is configured
    settings = config.get_settings()
    if not settings.GOOGLE_API_KEY and "pytest" not in sys.modules:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation is not configured. Please set GOOGLE_API_KEY in .env",
        )

    # Get pose and verify ownership
    result = await db.execute(
        select(Pose).where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found",
        )

    if not pose.schema_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose has no schema image",
        )

    # Get schema image bytes from storage
    storage = get_storage()
    try:
        image_bytes = await storage.download_bytes(pose.schema_path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schema image not found",
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid schema image path",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch schema image",
        )

    # Check for empty or corrupted file
    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schema image is empty or corrupted. Please re-upload the schema.",
        )

    if len(image_bytes) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Schema image too large. Max size is 10MB",
        )

    image_info = validate_uploaded_image_payload(image_bytes, claimed_mime_type=None)
    mime_type = image_info.mime_type
    pose_description = " ".join(
        part.strip()
        for part in [pose.name or "", pose.description or ""]
        if part and part.strip()
    ) or None

    # Create task with retry on UUID collision
    task = await create_generation_task_with_retry(
        db=db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )
    await db.commit()

    # Start background generation
    if "pytest" not in sys.modules:
        background_tasks.add_task(
            run_generation,
            task.task_id,
            image_bytes,
            mime_type,
            additional_notes,
            pose_description,
        )

    return GenerateResponse(
        task_id=task.task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


@router.get("/status/{task_id}", response_model=GenerateResponse)
async def get_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check generation status"""
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    if task.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    # Parse analyzed muscles from JSON
    analyzed_muscles = None
    if task.analyzed_muscles_json:
        import json

        try:
            def _clamp_activation_level(raw: object) -> int:
                try:
                    level_int = int(raw)  # type: ignore[arg-type]
                except Exception:
                    return 50
                if level_int < 0:
                    return 0
                if level_int > 100:
                    return 100
                return level_int

            muscles_data = json.loads(task.analyzed_muscles_json)
            if isinstance(muscles_data, list):
                out: list[AnalyzedMuscleResponse] = []
                for m in muscles_data:
                    if not isinstance(m, dict):
                        continue
                    name = m.get("name")
                    if not isinstance(name, str):
                        continue
                    level = _clamp_activation_level(m.get("activation_level", 50))
                    out.append(AnalyzedMuscleResponse(name=name, activation_level=level))
                analyzed_muscles = out or None
        except Exception:
            analyzed_muscles = None

    try:
        status_enum = GenerateStatus(task.status)
    except Exception:
        status_enum = GenerateStatus.FAILED

    progress = task.progress or 0
    try:
        progress_int = int(progress)
    except Exception:
        progress_int = 0
    if progress_int < 0:
        progress_int = 0
    if progress_int > 100:
        progress_int = 100

    return GenerateResponse(
        task_id=task_id,
        status=status_enum,
        progress=progress_int,
        status_message=task.status_message,
        error_message=sanitize_public_error_message(
            task.error_message, fallback="Generation failed"
        ),
        photo_url=task.photo_url,
        muscles_url=task.muscles_url,
        quota_warning=task.quota_warning,
        analyzed_muscles=analyzed_muscles,
    )


@router.post("/save-to-gallery", response_model=SaveToGalleryResponse)
async def save_to_gallery(
    request: SaveToGalleryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save a completed generation task as a new pose in the gallery.

    This creates a new Pose record with the generated photo and muscle layer,
    and associates the analyzed muscles with the pose.
    """
    import json

    from models.category import Category
    from models.muscle import Muscle
    from models.pose import Pose, PoseMuscle
    from sqlalchemy import and_, func

    # Get the generation task
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == request.task_id)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generation task not found",
        )

    # Verify task belongs to current user
    if task.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generation task not found",
        )

    # Verify task is completed
    if task.status != GenerateStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot save incomplete generation. Please wait for generation to complete.",
        )

    # Verify at least photo was generated
    if not task.photo_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No photo generated. Cannot save to gallery.",
        )

    # Check for unique code
    existing = await db.execute(
        select(Pose).where(
            and_(Pose.code == request.code, Pose.user_id == current_user.id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pose with this code already exists. Choose a different code.",
        )

    # Validate category if provided
    if request.category_id:
        category = await db.execute(
            select(Category).where(
                and_(
                    Category.id == request.category_id,
                    Category.user_id == current_user.id,
                )
            )
        )
        if not category.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category not found",
            )

    # Create the new pose
    pose = Pose(
        user_id=current_user.id,
        code=request.code,
        name=request.name,
        name_en=request.name_en,
        category_id=request.category_id,
        description=request.description,
        photo_path=task.photo_url,
        muscle_layer_path=task.muscles_url,
    )
    db.add(pose)
    await db.flush()  # Get the pose ID

    # Add analyzed muscles if available
    if task.analyzed_muscles_json:
        logger.info(
            f"Processing analyzed muscles for task {request.task_id}: {task.analyzed_muscles_json[:200]}..."
        )
        try:
            def _clamp_activation_level(raw: object) -> int:
                try:
                    level_int = int(raw)  # type: ignore[arg-type]
                except Exception:
                    return 50
                if level_int < 0:
                    return 0
                if level_int > 100:
                    return 100
                return level_int

            muscles_data = json.loads(task.analyzed_muscles_json)
            logger.info(f"Parsed {len(muscles_data)} muscles from JSON")

            # Batch query for all muscles by name
            muscle_names = [m["name"].lower() for m in muscles_data]
            logger.info(f"Looking for muscles: {muscle_names}")

            result = await db.execute(
                select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
            )
            muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
            logger.info(
                f"Found {len(muscles_by_name)} muscles in database: {list(muscles_by_name.keys())}"
            )

            # Create PoseMuscle associations
            pose_muscles_to_add = []
            for m in muscles_data:
                name = m.get("name") if isinstance(m, dict) else None
                if not isinstance(name, str):
                    continue
                key = name.lower()
                muscle = muscles_by_name.get(key)
                if not muscle:
                    continue
                level = _clamp_activation_level(m.get("activation_level", 50))
                pose_muscles_to_add.append(
                    PoseMuscle(
                        pose_id=pose.id,
                        muscle_id=muscle.id,
                        activation_level=level,
                    )
                )
            logger.info(
                f"Creating {len(pose_muscles_to_add)} PoseMuscle associations for pose {pose.id}"
            )
            db.add_all(pose_muscles_to_add)
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(
                f"Failed to parse analyzed muscles for task {request.task_id}: {e}"
            )
        except Exception as e:
            logger.error(
                f"Unexpected error creating muscle associations for task {request.task_id}: {e}",
                exc_info=True,
            )
    else:
        logger.warning(f"No analyzed_muscles_json for task {request.task_id}")

    try:
        await db.commit()
    except (IntegrityError, OperationalError):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while saving to gallery. Please retry.",
        )

    return SaveToGalleryResponse(
        pose_id=pose.id,
        message="Pose saved to gallery successfully",
    )
