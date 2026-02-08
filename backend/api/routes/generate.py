import json
import logging
import os
import sys
import uuid
from typing import Awaitable, Callable, Optional

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
from schemas.validators import ensure_utf8_encodable, normalize_optional_text
from services.auth import get_current_user
from services.error_sanitizer import sanitize_public_error_message
from services.generation_task_utils import (
    clamp_progress,
    normalize_generate_status,
    parse_analyzed_muscles_json,
    serialize_analyzed_muscles,
)
from services.image_validation import (
    MAX_UPLOAD_SIZE_BYTES,
    normalize_image_mime_type,
    validate_uploaded_image_payload,
)
from services.storage import get_storage
from services.websocket_manager import ProgressUpdate, get_connection_manager
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generate"])

MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_BYTES
ADDITIONAL_NOTES_MAX_LENGTH = 500

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


def _ensure_ai_generation_configured() -> None:
    settings = config.get_settings()
    if not settings.GOOGLE_API_KEY and "pytest" not in sys.modules:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation is not configured. Please set GOOGLE_API_KEY in .env",
        )


async def _create_pending_generation_task(
    db: AsyncSession,
    *,
    user_id: int,
    additional_notes: Optional[str],
) -> GenerationTask:
    task = await create_generation_task_with_retry(
        db=db,
        user_id=user_id,
        additional_notes=additional_notes,
    )
    await db.commit()
    return task


def _build_pending_generation_response(task_id: str) -> GenerateResponse:
    return GenerateResponse(
        task_id=task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


GenerateOutput = tuple[bytes, Optional[bytes], bool, Optional[str]]
ProgressCallback = Callable[[int, str], Awaitable[None]]
GenerateBuilder = Callable[[ProgressCallback], Awaitable[GenerateOutput]]


async def _load_generation_task(db: AsyncSession, task_id: str) -> Optional[GenerationTask]:
    result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == task_id)
    )
    return result.scalar_one_or_none()


async def _mark_task_processing(
    db: AsyncSession,
    task: GenerationTask,
    task_id: str,
) -> None:
    task.status = GenerateStatus.PROCESSING.value
    task.progress = 0
    task.status_message = "Initializing..."
    await db.commit()

    manager = get_connection_manager()
    await manager.broadcast_progress(
        ProgressUpdate(
            task_id=task_id,
            status=GenerateStatus.PROCESSING.value,
            progress=0,
            status_message="Initializing...",
        )
    )


def _build_progress_callback(
    db: AsyncSession,
    task: GenerationTask,
    task_id: str,
) -> ProgressCallback:
    manager = get_connection_manager()

    async def progress_callback(progress: int, message: str) -> None:
        task.progress = progress
        status_message = "Finalizing..." if progress >= 100 else message
        task.status_message = status_message
        await db.commit()

        await manager.broadcast_progress(
            ProgressUpdate(
                task_id=task_id,
                status=GenerateStatus.PROCESSING.value,
                progress=progress,
                status_message=status_message,
            )
        )

    return progress_callback


async def _finalize_generation_success(
    db: AsyncSession,
    task: GenerationTask,
    task_id: str,
    *,
    photo_bytes: bytes,
    muscles_bytes: Optional[bytes],
    used_placeholders: bool,
    analyzed_json: Optional[str],
) -> None:
    storage = get_storage()
    photo_key = f"generated/{task_id}_photo.png"

    task.photo_url = await storage.upload_bytes(photo_bytes, photo_key, "image/png")
    if muscles_bytes:
        muscles_key = f"generated/{task_id}_muscles.png"
        task.muscles_url = await storage.upload_bytes(
            muscles_bytes, muscles_key, "image/png"
        )
    else:
        task.muscles_url = None
    task.quota_warning = used_placeholders
    task.analyzed_muscles_json = analyzed_json or None

    task.status = GenerateStatus.COMPLETED.value
    task.progress = 100
    task.status_message = "Completed!"
    await db.commit()

    analyzed_muscles_for_ws = parse_analyzed_muscles_json(analyzed_json)
    manager = get_connection_manager()
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


async def _finalize_generation_failure(
    db: AsyncSession,
    task_id: str,
    public_error: str,
    *,
    failure_status_message: str = "Generation failed",
) -> None:
    await db.rollback()
    task = await _load_generation_task(db, task_id)
    if not task:
        return

    task.status = GenerateStatus.FAILED.value
    task.error_message = public_error
    task.status_message = failure_status_message
    await db.commit()

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


async def _run_generation_pipeline(task_id: str, build_output: GenerateBuilder) -> None:
    async with AsyncSessionLocal() as db:
        try:
            task = await _load_generation_task(db, task_id)
            if not task:
                return

            await _mark_task_processing(db, task, task_id)
            progress_callback = _build_progress_callback(db, task, task_id)
            photo_bytes, muscles_bytes, used_placeholders, analyzed_json = (
                await build_output(progress_callback)
            )
            await _finalize_generation_success(
                db,
                task,
                task_id,
                photo_bytes=photo_bytes,
                muscles_bytes=muscles_bytes,
                used_placeholders=used_placeholders,
                analyzed_json=analyzed_json,
            )
        except Exception as e:
            logger.exception("Generation failed (task_id=%s)", task_id)
            public_error = (
                sanitize_public_error_message(str(e), fallback="Generation failed")
                or "Generation failed"
            )
            await _finalize_generation_failure(db, task_id, public_error)


async def run_generation(
    task_id: str,
    image_bytes: bytes,
    mime_type: str,
    additional_notes: Optional[str] = None,
    pose_description: Optional[str] = None,
    generate_muscles: bool = True,
):
    """
    Run generation using Google Gemini API.

    Generates:
    1. Studio photo (realistic render from schema)
    2. Body paint muscles visualization
    """
    async def build_output(progress_callback: ProgressCallback) -> GenerateOutput:
        async def fast_placeholder_generation() -> GenerateOutput:
            import binascii
            import struct
            import zlib

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
                    + struct.pack(">I", binascii.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF)
                )
                raw = bytes([0, r & 0xFF, g & 0xFF, b & 0xFF])  # filter 0 + RGB
                compressed = zlib.compress(raw)
                idat = (
                    struct.pack(">I", len(compressed))
                    + b"IDAT"
                    + compressed
                    + struct.pack(">I", binascii.crc32(b"IDAT" + compressed) & 0xFFFFFFFF)
                )
                iend = (
                    struct.pack(">I", 0)
                    + b"IEND"
                    + struct.pack(">I", binascii.crc32(b"IEND") & 0xFFFFFFFF)
                )
                return signature + ihdr + idat + iend

            await progress_callback(5, "Starting generation...")
            photo_png = _png_1x1_rgb(255, 255, 255)
            if not generate_muscles:
                await progress_callback(25, "Generating studio photo...")
                await progress_callback(100, "Completed!")
                return photo_png, None, True, None

            muscles_png = _png_1x1_rgb(255, 80, 80)
            analyzed = [
                {"name": "quadriceps", "activation_level": 85},
                {"name": "gluteus_maximus", "activation_level": 70},
                {"name": "hamstrings", "activation_level": 45},
            ]
            await progress_callback(25, "Generating studio photo...")
            await progress_callback(55, "Generating muscle visualization...")
            await progress_callback(85, "Analyzing active muscles...")
            await progress_callback(100, "Completed!")
            return photo_png, muscles_png, True, json.dumps(analyzed)

        if os.getenv("E2E_FAST_AI") == "1":
            return await fast_placeholder_generation()

        from services.google_generator import GoogleGeminiGenerator

        generator = GoogleGeminiGenerator.get_instance()
        result_gen = await generator.generate_all_from_image(
            image_bytes=image_bytes,
            mime_type=mime_type,
            task_id=task_id,
            progress_callback=progress_callback,
            additional_notes=additional_notes,
            pose_description=pose_description,
            generate_muscles=generate_muscles,
        )
        if result_gen.used_placeholders:
            raise RuntimeError("Generation returned placeholders instead of real AI output.")
        return (
            result_gen.photo_bytes,
            result_gen.muscles_bytes if generate_muscles else None,
            result_gen.used_placeholders,
            serialize_analyzed_muscles(result_gen.analyzed_muscles)
            if generate_muscles
            else None,
        )

    await _run_generation_pipeline(task_id, build_output)


@router.post("", response_model=GenerateResponse)
async def generate(
    background_tasks: BackgroundTasks,
    schema_file: UploadFile = File(
        ..., description="Schema image file (PNG, JPG, WEBP)"
    ),
    generate_muscles: bool = Form(
        True, description="Generate muscles visualization and active muscles analysis"
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

    _ensure_ai_generation_configured()

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

    try:
        additional_notes = _normalize_additional_notes(additional_notes)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )

    task = await _create_pending_generation_task(
        db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )

    # Start background generation (skip during tests to avoid background DB access)
    if "pytest" not in sys.modules:
        background_tasks.add_task(
            run_generation,
            task.task_id,
            content,
            mime_type,
            additional_notes,
            None,
            generate_muscles,
        )

    return _build_pending_generation_response(task.task_id)


from pydantic import BaseModel, Field, field_validator


def _normalize_additional_notes(value: Optional[str]) -> Optional[str]:
    normalized = normalize_optional_text(value)
    if normalized is None:
        return None
    if not isinstance(normalized, str):
        return None
    if len(normalized) > ADDITIONAL_NOTES_MAX_LENGTH:
        raise ValueError(
            f"Additional notes too long (max {ADDITIONAL_NOTES_MAX_LENGTH} characters)"
        )
    return normalized


class GenerateFromPoseRequest(BaseModel):
    generate_muscles: bool = Field(
        True, description="Generate muscles visualization and active muscles analysis"
    )
    additional_notes: Optional[str] = Field(
        None,
        max_length=ADDITIONAL_NOTES_MAX_LENGTH,
        description="Additional instructions for AI generation",
    )

    @field_validator("additional_notes", mode="before")
    @classmethod
    def normalize_additional_notes(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_additional_notes(value)


class GenerateFromTextRequest(BaseModel):
    description: str = Field(
        ..., min_length=10, max_length=2000, description="Detailed pose description"
    )
    additional_notes: Optional[str] = Field(
        None,
        max_length=ADDITIONAL_NOTES_MAX_LENGTH,
        description="Additional instructions for AI generation",
    )
    generate_muscles: bool = Field(
        True, description="Generate muscles visualization and active muscles analysis"
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
        return _normalize_additional_notes(value)


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
    task_id: str,
    description: str,
    additional_notes: Optional[str] = None,
    generate_muscles: bool = True,
):
    """
    Run generation using Google Gemini API from text description.

    Generates:
    1. Studio photo (realistic render from description)
    2. Body paint muscles visualization
    """
    async def build_output(progress_callback: ProgressCallback) -> GenerateOutput:
        if os.getenv("E2E_FAST_AI") == "1":
            from io import BytesIO

            from PIL import Image, ImageDraw

            await progress_callback(5, "Starting generation...")
            photo = Image.new("RGB", (1024, 1024), color=(245, 238, 230))
            ImageDraw.Draw(photo).text(
                (32, 32), "E2E FAST AI PHOTO (TEXT)", fill=(30, 30, 30)
            )
            b1 = BytesIO()
            photo.save(b1, format="PNG")
            if not generate_muscles:
                await progress_callback(100, "Completed!")
                return (b1.getvalue(), None, True, None)

            muscles = Image.new("RGB", (1024, 1024), color=(230, 245, 238))
            ImageDraw.Draw(muscles).text(
                (32, 32), "E2E FAST AI MUSCLES (TEXT)", fill=(30, 30, 30)
            )
            b2 = BytesIO()
            muscles.save(b2, format="PNG")
            await progress_callback(100, "Completed!")

            return (
                b1.getvalue(),
                b2.getvalue(),
                True,
                json.dumps(
                    [
                        {"name": "rectus_abdominis", "activation_level": 75},
                        {"name": "obliques", "activation_level": 55},
                    ]
                ),
            )

        from services.google_generator import GoogleGeminiGenerator

        generator = GoogleGeminiGenerator.get_instance()
        result_gen = await generator.generate_all(
            pose_description=description,
            task_id=task_id,
            progress_callback=progress_callback,
            additional_notes=additional_notes,
            generate_muscles=generate_muscles,
        )
        if result_gen.used_placeholders:
            raise RuntimeError("Generation returned placeholders instead of real AI output.")
        return (
            result_gen.photo_bytes,
            result_gen.muscles_bytes if generate_muscles else None,
            result_gen.used_placeholders,
            serialize_analyzed_muscles(result_gen.analyzed_muscles)
            if generate_muscles
            else None,
        )

    await _run_generation_pipeline(task_id, build_output)


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
    _ensure_ai_generation_configured()

    task = await _create_pending_generation_task(
        db,
        user_id=current_user.id,
        additional_notes=request.additional_notes,
    )

    # Start background generation
    background_tasks.add_task(
        run_generation_from_text,
        task.task_id,
        request.description,
        request.additional_notes,
        request.generate_muscles,
    )

    return _build_pending_generation_response(task.task_id)


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
    generate_muscles = request.generate_muscles if request else True
    from models.pose import Pose
    from sqlalchemy import and_

    _ensure_ai_generation_configured()

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
    # Pass only an explicit user-authored description here.
    # Pose name alone is not reliable geometric guidance and previously caused
    # false positives where the pipeline believed a description existed.
    pose_description = (pose.description or "").strip() or None

    task = await _create_pending_generation_task(
        db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )

    # Start background generation
    if "pytest" not in sys.modules:
        background_tasks.add_task(
            run_generation,
            task.task_id,
            image_bytes,
            mime_type,
            additional_notes,
            pose_description,
            generate_muscles,
        )

    return _build_pending_generation_response(task.task_id)


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

    muscles_data = parse_analyzed_muscles_json(task.analyzed_muscles_json)
    analyzed_muscles = (
        [
            AnalyzedMuscleResponse(
                name=item["name"], activation_level=item["activation_level"]
            )
            for item in muscles_data
        ]
        if muscles_data
        else None
    )

    status_enum = GenerateStatus(
        normalize_generate_status(task.status, default=GenerateStatus.FAILED.value)
    )
    progress_int = clamp_progress(task.progress or 0)

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
    muscles_data = parse_analyzed_muscles_json(task.analyzed_muscles_json) or []
    if muscles_data:
        muscle_names = [m["name"].lower() for m in muscles_data]
        result = await db.execute(
            select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
        )
        muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}

        pose_muscles_to_add = []
        for m in muscles_data:
            muscle = muscles_by_name.get(m["name"].lower())
            if not muscle:
                continue
            pose_muscles_to_add.append(
                PoseMuscle(
                    pose_id=pose.id,
                    muscle_id=muscle.id,
                    activation_level=m["activation_level"],
                )
            )
        db.add_all(pose_muscles_to_add)

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
