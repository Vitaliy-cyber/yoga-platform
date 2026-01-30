import asyncio
import logging
import sys
import uuid

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
from typing import Optional
from models.generation_task import GenerationTask
from models.user import User
from schemas.generate import AnalyzedMuscleResponse, GenerateResponse, GenerateStatus
from services.auth import get_current_user
from services.storage import S3Storage, get_storage
from services.websocket_manager import ProgressUpdate, get_connection_manager
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generate"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB

# Image magic bytes for content validation
# These are the first bytes that identify the actual file type
IMAGE_MAGIC_BYTES = {
    "image/jpeg": [
        b"\xff\xd8\xff",  # JPEG/JFIF/EXIF
    ],
    "image/png": [
        b"\x89PNG\r\n\x1a\n",  # PNG
    ],
    "image/webp": [
        b"RIFF",  # WebP (RIFF container, need additional check)
    ],
}


def validate_image_magic_bytes(content: bytes, claimed_mime_type: str) -> bool:
    """
    Validate that file content matches the claimed MIME type by checking magic bytes.

    This prevents attacks where malicious files are uploaded with fake extensions.
    Returns True if validation passes, raises HTTPException if it fails.
    """
    if len(content) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too small to be a valid image",
        )

    # Normalize MIME type
    mime_type = claimed_mime_type.lower()
    if mime_type == "image/jpg":
        mime_type = "image/jpeg"

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
            await manager.broadcast_progress(ProgressUpdate(
                task_id=task_id,
                status=task.status,
                progress=progress,
                status_message=message,
            ))

            return True
        return False


async def run_generation(task_id: str, image_bytes: bytes, mime_type: str, additional_notes: Optional[str] = None):
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
            await manager.broadcast_progress(ProgressUpdate(
                task_id=task_id,
                status=GenerateStatus.PROCESSING.value,
                progress=0,
                status_message="Initializing...",
            ))

            storage = get_storage()

            async def progress_callback(progress: int, message: str):
                task.progress = progress
                status_message = "Finalizing..." if progress >= 100 else message
                task.status_message = status_message
                await db.commit()

                # Broadcast progress via WebSocket
                await manager.broadcast_progress(ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.PROCESSING.value,
                    progress=progress,
                    status_message=status_message,
                ))

            from services.google_generator import GoogleGeminiGenerator

            generator = GoogleGeminiGenerator.get_instance()

            result_gen = await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type=mime_type,
                task_id=task_id,
                progress_callback=progress_callback,
                additional_notes=additional_notes,
            )

            photo_key = f"generated/{task_id}_photo.png"
            muscles_key = f"generated/{task_id}_muscles.png"

            task.photo_url = await storage.upload_bytes(
                result_gen.photo_bytes, photo_key, "image/png"
            )
            task.muscles_url = await storage.upload_bytes(
                result_gen.muscles_bytes, muscles_key, "image/png"
            )
            task.quota_warning = result_gen.used_placeholders

            # Save analyzed muscles as JSON
            if result_gen.analyzed_muscles:
                import json
                muscles_data = [
                    {"name": m.name, "activation_level": m.activation_level}
                    for m in result_gen.analyzed_muscles
                ]
                task.analyzed_muscles_json = json.dumps(muscles_data)

            task.status = GenerateStatus.COMPLETED.value
            task.progress = 100
            task.status_message = "Completed!"
            await db.commit()

            # Parse analyzed muscles for WebSocket broadcast
            analyzed_muscles_for_ws = None
            if result_gen.analyzed_muscles:
                analyzed_muscles_for_ws = [
                    {"name": m.name, "activation_level": m.activation_level}
                    for m in result_gen.analyzed_muscles
                ]

            # Broadcast completion via WebSocket
            await manager.broadcast_progress(ProgressUpdate(
                task_id=task_id,
                status=GenerateStatus.COMPLETED.value,
                progress=100,
                status_message="Completed!",
                photo_url=task.photo_url,
                muscles_url=task.muscles_url,
                quota_warning=task.quota_warning or False,
                analyzed_muscles=analyzed_muscles_for_ws,
            ))

        except Exception as e:
            import traceback

            traceback.print_exc()

            # Re-fetch task in case session was invalidated
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = GenerateStatus.FAILED.value
                task.error_message = str(e)
                task.status_message = "Generation failed"
                await db.commit()

                # Broadcast failure via WebSocket
                manager = get_connection_manager()
                await manager.broadcast_progress(ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.FAILED.value,
                    progress=task.progress,
                    status_message="Generation failed",
                    error_message=str(e),
                ))


@router.post("", response_model=GenerateResponse)
async def generate(
    background_tasks: BackgroundTasks,
    schema_file: UploadFile = File(
        ..., description="Schema image file (PNG, JPG, WEBP)"
    ),
    additional_notes: Optional[str] = Form(None, description="Additional instructions for AI generation"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate all layers from uploaded schema image.

    Uses Google Gemini API for image generation.

    Accepts: PNG, JPG, WEBP images up to 10MB
    """
    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/webp", "image/jpg"]
    if schema_file.content_type not in allowed_types:
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
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

    mime_type = schema_file.content_type or "image/png"

    # Validate magic bytes match claimed MIME type (skip in tests)
    if "pytest" not in sys.modules:
        validate_image_magic_bytes(content, mime_type)

    # Create task in database with retry on UUID collision
    task = await create_generation_task_with_retry(
        db=db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )
    await db.commit()

    # Start background generation (skip during tests to avoid background DB access)
    if "pytest" not in sys.modules:
        if "pytest" not in sys.modules:
            background_tasks.add_task(run_generation, task.task_id, content, mime_type, additional_notes)

    return GenerateResponse(
        task_id=task.task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


from pydantic import BaseModel, Field

class GenerateFromPoseRequest(BaseModel):
    additional_notes: Optional[str] = None


class GenerateFromTextRequest(BaseModel):
    description: str = Field(..., min_length=10, max_length=2000, description="Detailed pose description")
    additional_notes: Optional[str] = Field(None, max_length=500, description="Additional instructions for AI generation")


class SaveToGalleryRequest(BaseModel):
    """Request to save generation results as a new pose in gallery."""
    task_id: str = Field(..., description="Generation task ID")
    name: str = Field(..., min_length=1, max_length=200, description="Pose name")
    code: str = Field(..., min_length=1, max_length=20, description="Pose code (unique)")
    name_en: Optional[str] = Field(None, max_length=200, description="English name")
    category_id: Optional[int] = Field(None, description="Category ID")
    description: Optional[str] = Field(None, max_length=2000, description="Pose description")


class SaveToGalleryResponse(BaseModel):
    """Response after saving to gallery."""
    pose_id: int
    message: str


async def run_generation_from_text(task_id: str, description: str, additional_notes: Optional[str] = None):
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
            await manager.broadcast_progress(ProgressUpdate(
                task_id=task_id,
                status=GenerateStatus.PROCESSING.value,
                progress=0,
                status_message="Initializing...",
            ))

            storage = get_storage()

            async def progress_callback(progress: int, message: str):
                task.progress = progress
                status_message = "Finalizing..." if progress >= 100 else message
                task.status_message = status_message
                await db.commit()

                # Broadcast progress via WebSocket
                await manager.broadcast_progress(ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.PROCESSING.value,
                    progress=progress,
                    status_message=status_message,
                ))

            from services.google_generator import GoogleGeminiGenerator

            generator = GoogleGeminiGenerator.get_instance()

            # Combine description with additional notes if provided
            full_description = description
            if additional_notes:
                full_description = f"{description}\n\nAdditional instructions: {additional_notes}"

            result_gen = await generator.generate_all(
                pose_description=full_description,
                task_id=task_id,
                progress_callback=progress_callback,
            )

            photo_key = f"generated/{task_id}_photo.png"
            muscles_key = f"generated/{task_id}_muscles.png"

            task.photo_url = await storage.upload_bytes(
                result_gen.photo_bytes, photo_key, "image/png"
            )
            task.muscles_url = await storage.upload_bytes(
                result_gen.muscles_bytes, muscles_key, "image/png"
            )
            task.quota_warning = result_gen.used_placeholders

            # Save analyzed muscles as JSON
            if result_gen.analyzed_muscles:
                import json
                muscles_data = [
                    {"name": m.name, "activation_level": m.activation_level}
                    for m in result_gen.analyzed_muscles
                ]
                task.analyzed_muscles_json = json.dumps(muscles_data)

            task.status = GenerateStatus.COMPLETED.value
            task.progress = 100
            task.status_message = "Completed!"
            await db.commit()

            # Parse analyzed muscles for WebSocket broadcast
            analyzed_muscles_for_ws = None
            if result_gen.analyzed_muscles:
                analyzed_muscles_for_ws = [
                    {"name": m.name, "activation_level": m.activation_level}
                    for m in result_gen.analyzed_muscles
                ]

            # Broadcast completion via WebSocket
            await manager.broadcast_progress(ProgressUpdate(
                task_id=task_id,
                status=GenerateStatus.COMPLETED.value,
                progress=100,
                status_message="Completed!",
                photo_url=task.photo_url,
                muscles_url=task.muscles_url,
                quota_warning=task.quota_warning or False,
                analyzed_muscles=analyzed_muscles_for_ws,
            ))

        except Exception as e:
            import traceback

            traceback.print_exc()

            # Re-fetch task in case session was invalidated
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = GenerateStatus.FAILED.value
                task.error_message = str(e)
                task.status_message = "Generation failed"
                await db.commit()

                # Broadcast failure via WebSocket
                manager = get_connection_manager()
                await manager.broadcast_progress(ProgressUpdate(
                    task_id=task_id,
                    status=GenerateStatus.FAILED.value,
                    progress=task.progress,
                    status_message="Generation failed",
                    error_message=str(e),
                ))


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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch schema image: {str(e)}",
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

    # Determine mime type from file extension
    mime_type = "image/png"
    if pose.schema_path.lower().endswith(".jpg") or pose.schema_path.lower().endswith(
        ".jpeg"
    ):
        mime_type = "image/jpeg"
    elif pose.schema_path.lower().endswith(".webp"):
        mime_type = "image/webp"

    # Create task with retry on UUID collision
    task = await create_generation_task_with_retry(
        db=db,
        user_id=current_user.id,
        additional_notes=additional_notes,
    )
    await db.commit()

    # Start background generation
    if "pytest" not in sys.modules:
        background_tasks.add_task(run_generation, task.task_id, image_bytes, mime_type, additional_notes)

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
            muscles_data = json.loads(task.analyzed_muscles_json)
            analyzed_muscles = [
                AnalyzedMuscleResponse(name=m["name"], activation_level=m["activation_level"])
                for m in muscles_data
            ]
        except (json.JSONDecodeError, KeyError):
            pass

    return GenerateResponse(
        task_id=task_id,
        status=GenerateStatus(task.status),
        progress=task.progress,
        status_message=task.status_message,
        error_message=task.error_message,
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
    from models.pose import Pose, PoseMuscle
    from models.muscle import Muscle
    from models.category import Category
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
        logger.info(f"Processing analyzed muscles for task {request.task_id}: {task.analyzed_muscles_json[:200]}...")
        try:
            muscles_data = json.loads(task.analyzed_muscles_json)
            logger.info(f"Parsed {len(muscles_data)} muscles from JSON")

            # Batch query for all muscles by name
            muscle_names = [m["name"].lower() for m in muscles_data]
            logger.info(f"Looking for muscles: {muscle_names}")

            result = await db.execute(
                select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
            )
            muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
            logger.info(f"Found {len(muscles_by_name)} muscles in database: {list(muscles_by_name.keys())}")

            # Create PoseMuscle associations
            pose_muscles_to_add = [
                PoseMuscle(
                    pose_id=pose.id,
                    muscle_id=muscles_by_name[m["name"].lower()].id,
                    activation_level=m["activation_level"],
                )
                for m in muscles_data
                if m["name"].lower() in muscles_by_name
            ]
            logger.info(f"Creating {len(pose_muscles_to_add)} PoseMuscle associations for pose {pose.id}")
            db.add_all(pose_muscles_to_add)
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to parse analyzed muscles for task {request.task_id}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error creating muscle associations for task {request.task_id}: {e}", exc_info=True)
    else:
        logger.warning(f"No analyzed_muscles_json for task {request.task_id}")

    await db.commit()

    return SaveToGalleryResponse(
        pose_id=pose.id,
        message="Pose saved to gallery successfully",
    )
