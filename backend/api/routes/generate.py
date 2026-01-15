import asyncio
import uuid
from io import BytesIO
from typing import Dict

from config import get_settings
from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    status,
    UploadFile,
    File,
    Depends,
)
from models.user import User
from schemas.generate import GenerateResponse, GenerateStatus
from services.auth import get_current_user
from services.storage import S3Storage

settings = get_settings()
router = APIRouter(prefix="/api/generate", tags=["generate"])

# In-memory storage for generation tasks (use Redis in production)
generation_tasks: Dict[str, dict] = {}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


def create_task_id() -> str:
    """Create unique task ID"""
    return str(uuid.uuid4())


def update_task_progress(task_id: str, progress: int, message: str):
    """Update task progress"""
    if task_id in generation_tasks:
        generation_tasks[task_id]["progress"] = progress
        generation_tasks[task_id]["status_message"] = message


async def run_generation(task_id: str, image_bytes: bytes, mime_type: str):
    """
    Run generation using Google Gemini API.

    Generates:
    1. Studio photo (realistic render from schema)
    2. Body paint muscles visualization
    """
    try:
        generation_tasks[task_id]["status"] = GenerateStatus.PROCESSING
        generation_tasks[task_id]["progress"] = 5
        generation_tasks[task_id]["status_message"] = "Initializing..."

        storage = S3Storage.get_instance()

        def progress_callback(progress: int, message: str):
            update_task_progress(task_id, progress, message)

        from services.google_generator import GoogleGeminiGenerator

        generator = GoogleGeminiGenerator.get_instance()

        result = await generator.generate_all_from_image(
            image_bytes=image_bytes,
            mime_type=mime_type,
            task_id=task_id,
            progress_callback=progress_callback,
        )

        photo_key = f"generated/{task_id}_photo.png"
        muscles_key = f"generated/{task_id}_muscles.png"

        generation_tasks[task_id]["photo_url"] = await storage.upload_bytes(
            result.photo_bytes, photo_key, "image/png"
        )
        generation_tasks[task_id]["muscles_url"] = await storage.upload_bytes(
            result.muscles_bytes, muscles_key, "image/png"
        )
        generation_tasks[task_id]["quota_warning"] = result.used_placeholders

        generation_tasks[task_id]["status"] = GenerateStatus.COMPLETED
        generation_tasks[task_id]["progress"] = 100
        generation_tasks[task_id]["status_message"] = "Completed!"

    except Exception as e:
        import traceback

        traceback.print_exc()
        generation_tasks[task_id]["status"] = GenerateStatus.FAILED
        generation_tasks[task_id]["error_message"] = str(e)
        generation_tasks[task_id]["status_message"] = "Generation failed"


@router.post("", response_model=GenerateResponse)
async def generate(
    background_tasks: BackgroundTasks,
    schema_file: UploadFile = File(
        ..., description="Schema image file (PNG, JPG, WEBP)"
    ),
    current_user: User = Depends(get_current_user),
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
            detail=f"Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    # Read uploaded file into memory (no local storage)
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

    generation_tasks[task_id] = {
        "user_id": current_user.id,
        "status": GenerateStatus.PENDING,
        "progress": 0,
        "status_message": "In queue...",
        "error_message": None,
        "photo_url": None,
        "muscles_url": None,
        "quota_warning": False,
    }

    background_tasks.add_task(run_generation, task_id, content, mime_type)

    return GenerateResponse(
        task_id=task_id,
        status=GenerateStatus.PENDING,
        progress=0,
        status_message="In queue...",
    )


@router.get("/status/{task_id}", response_model=GenerateResponse)
async def get_status(task_id: str, current_user: User = Depends(get_current_user)):
    """Check generation status"""

    if task_id not in generation_tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    task = generation_tasks[task_id]
    if task.get("user_id") != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    return GenerateResponse(
        task_id=task_id,
        status=task["status"],
        progress=task["progress"],
        status_message=task.get("status_message"),
        error_message=task.get("error_message"),
        photo_url=task.get("photo_url"),
        muscles_url=task.get("muscles_url"),
        quota_warning=task.get("quota_warning", False),
    )
