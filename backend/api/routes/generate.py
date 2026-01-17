import asyncio
import uuid

from config import get_settings
from db.database import AsyncSessionLocal, get_db
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from models.generation_task import GenerationTask
from models.user import User
from schemas.generate import GenerateResponse, GenerateStatus
from services.auth import get_current_user
from services.storage import get_storage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

settings = get_settings()
router = APIRouter(prefix="/api/generate", tags=["generate"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


def create_task_id() -> str:
    """Create unique task ID"""
    return str(uuid.uuid4())


async def update_task_progress(task_id: str, progress: int, message: str):
    """Update task progress in database"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(GenerationTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        if task:
            task.progress = progress
            task.status_message = message
            await db.commit()


async def run_generation(task_id: str, image_bytes: bytes, mime_type: str):
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

            storage = get_storage()

            async def progress_callback(progress: int, message: str):
                task.progress = 0
                task.status_message = "Finalizing..." if progress >= 100 else message
                await db.commit()

            from services.google_generator import GoogleGeminiGenerator

            generator = GoogleGeminiGenerator.get_instance()

            result_gen = await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type=mime_type,
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
            task.status = GenerateStatus.COMPLETED.value
            task.progress = 100
            task.status_message = "Completed!"
            await db.commit()

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


@router.post("", response_model=GenerateResponse)
async def generate(
    background_tasks: BackgroundTasks,
    schema_file: UploadFile = File(
        ..., description="Schema image file (PNG, JPG, WEBP)"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate all layers from uploaded schema image.

    Uses Google Gemini API for image generation.

    Accepts: PNG, JPG, WEBP images up to 10MB
    """
    # Check if AI generation is configured
    if not settings.GOOGLE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI generation is not configured. Please set GOOGLE_API_KEY in .env",
        )

    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/webp", "image/jpg"]
    if schema_file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    # Read uploaded file into memory
    task_id = create_task_id()

    try:
        content = await schema_file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )

    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Max size is 10MB",
        )

    mime_type = schema_file.content_type or "image/png"

    # Create task in database
    task = GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        status=GenerateStatus.PENDING.value,
        progress=0,
        status_message="In queue...",
    )
    db.add(task)
    await db.commit()

    # Start background generation
    background_tasks.add_task(run_generation, task_id, content, mime_type)

    return GenerateResponse(
        task_id=task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


@router.post("/from-pose/{pose_id}", response_model=GenerateResponse)
async def generate_from_pose(
    pose_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate layers from existing pose schema.

    This endpoint fetches the schema from the pose directly on the server,
    avoiding CORS issues with client-side fetch.
    """
    from models.pose import Pose
    from sqlalchemy import and_

    # Check if AI generation is configured
    if not settings.GOOGLE_API_KEY:
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

    # Create task
    task_id = create_task_id()
    task = GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        status=GenerateStatus.PENDING.value,
        progress=0,
        status_message="In queue...",
    )
    db.add(task)
    await db.commit()

    # Start background generation
    background_tasks.add_task(run_generation, task_id, image_bytes, mime_type)

    return GenerateResponse(
        task_id=task_id,
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

    return GenerateResponse(
        task_id=task_id,
        status=GenerateStatus(task.status),
        progress=task.progress,
        status_message=task.status_message,
        error_message=task.error_message,
        photo_url=task.photo_url,
        muscles_url=task.muscles_url,
        quota_warning=task.quota_warning,
    )
