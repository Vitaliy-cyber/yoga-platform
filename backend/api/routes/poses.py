import html
import logging
import os
import uuid
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)
from db.database import get_db
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.muscle import PoseMuscleResponse
from schemas.pose import PaginatedPoseResponse, PoseCreate, PoseListResponse, PoseResponse, PoseUpdate
from services.auth import get_current_user, get_current_user_from_request
from services.storage import get_storage
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/poses", tags=["poses"])

ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


def sanitize_html(text: Optional[str]) -> Optional[str]:
    """
    Sanitize text to prevent XSS attacks by escaping HTML special characters.

    This is a defense-in-depth measure - even if frontend renders without escaping,
    the backend will have already escaped dangerous characters.
    """
    if text is None:
        return None
    return html.escape(text)


async def save_upload_file(file: UploadFile, subdir: str = "") -> str:
    """Upload file to S3 and return public URL."""
    ext = os.path.splitext(file.filename)[1] if file.filename else ".png"
    filename = f"{uuid.uuid4()}{ext}"

    prefix = f"uploads/{subdir}" if subdir else "uploads"
    key = f"{prefix}/{filename}"

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Max size is 10MB",
        )

    content_type = file.content_type or "image/png"

    storage = get_storage()
    return await storage.upload_bytes(content, key, content_type)


def build_pose_response(pose: Pose) -> PoseResponse:
    """Побудувати відповідь з пози"""
    muscles = []
    for pm in pose.pose_muscles:
        muscles.append(
            PoseMuscleResponse(
                muscle_id=pm.muscle.id,
                muscle_name=pm.muscle.name,
                muscle_name_ua=pm.muscle.name_ua,
                body_part=pm.muscle.body_part,
                activation_level=pm.activation_level,
            )
        )

    return PoseResponse(
        id=pose.id,
        code=pose.code,
        name=pose.name,
        name_en=pose.name_en,
        category_id=pose.category_id,
        category_name=pose.category.name if pose.category else None,
        # XSS protection: escape HTML in user-provided text fields
        description=sanitize_html(pose.description),
        effect=sanitize_html(pose.effect),
        breathing=sanitize_html(pose.breathing),
        schema_path=pose.schema_path,
        photo_path=pose.photo_path,
        muscle_layer_path=pose.muscle_layer_path,
        skeleton_layer_path=pose.skeleton_layer_path,
        # Optimistic locking version - client must send this back on update
        version=pose.version or 1,
        created_at=pose.created_at,
        updated_at=pose.updated_at,
        muscles=muscles,
    )


@router.get("", response_model=PaginatedPoseResponse)
async def get_poses(
    category_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get paginated list of poses for the current user.

    Returns a standardized paginated response with items, total count,
    skip offset, and limit.
    """
    # Base query for user's poses
    base_query = select(Pose).where(Pose.user_id == current_user.id)

    if category_id:
        base_query = base_query.where(Pose.category_id == category_id)

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated items
    query = (
        base_query
        .options(selectinload(Pose.category))
        .order_by(Pose.code)
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    items = [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]

    return PaginatedPoseResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


def escape_like_pattern(pattern: str) -> str:
    """
    Escape special characters for SQL LIKE patterns.

    SQL LIKE uses % (any sequence), _ (any single char), and \ (escape).
    These must be escaped to be treated as literals in search queries.
    """
    # Escape backslash first (since it's the escape character)
    pattern = pattern.replace("\\", "\\\\")
    # Escape LIKE wildcards
    pattern = pattern.replace("%", "\\%")
    pattern = pattern.replace("_", "\\_")
    return pattern


@router.get("/search", response_model=List[PoseListResponse])
async def search_poses(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пошук поз за назвою або кодом"""
    # Escape LIKE special characters to prevent pattern injection
    escaped_query = escape_like_pattern(q)
    search_term = f"%{escaped_query}%"

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(
            and_(
                Pose.user_id == current_user.id,
                or_(
                    Pose.name.ilike(search_term, escape="\\"),
                    Pose.name_en.ilike(search_term, escape="\\"),
                    Pose.code.ilike(search_term, escape="\\"),
                ),
            )
        )
        .order_by(Pose.code)
        .limit(50)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    return [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]


@router.get("/category/{category_id}", response_model=List[PoseListResponse])
async def get_poses_by_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати пози за категорією"""
    # Перевірити чи категорія існує і належить користувачу
    category = await db.execute(
        select(Category).where(
            and_(Category.id == category_id, Category.user_id == current_user.id)
        )
    )
    if not category.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(and_(Pose.category_id == category_id, Pose.user_id == current_user.id))
        .order_by(Pose.code)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    return [
        PoseListResponse(
            id=p.id,
            code=p.code,
            name=p.name,
            name_en=p.name_en,
            category_id=p.category_id,
            category_name=p.category.name if p.category else None,
            schema_path=p.schema_path,
            photo_path=p.photo_path,
        )
        for p in poses
    ]


@router.get("/{pose_id}", response_model=PoseResponse)
async def get_pose(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати позу за ID"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.get("/code/{code}", response_model=PoseResponse)
async def get_pose_by_code(
    code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати позу за кодом"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.code == code, Pose.user_id == current_user.id))
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.post("", response_model=PoseResponse, status_code=status.HTTP_201_CREATED)
async def create_pose(
    pose_data: PoseCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Створити нову позу"""
    # Перевірка на унікальність коду для цього користувача
    existing = await db.execute(
        select(Pose).where(
            and_(Pose.code == pose_data.code, Pose.user_id == current_user.id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pose with this code already exists",
        )

    # Перевірка категорії (якщо вказана)
    if pose_data.category_id:
        category = await db.execute(
            select(Category).where(
                and_(
                    Category.id == pose_data.category_id,
                    Category.user_id == current_user.id,
                )
            )
        )
        if not category.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Category not found"
            )

    # Створення пози
    pose_dict = pose_data.model_dump(exclude={"muscles"})
    pose = Pose(user_id=current_user.id, **pose_dict)
    db.add(pose)
    await db.flush()

    # Додавання м'язів (batch validation to avoid N+1 queries)
    if pose_data.muscles:
        muscle_ids = [m.muscle_id for m in pose_data.muscles]
        result = await db.execute(
            select(Muscle.id).where(Muscle.id.in_(muscle_ids))
        )
        valid_muscle_ids = set(result.scalars().all())

        # Batch create all pose_muscle associations
        pose_muscles_to_add = [
            PoseMuscle(
                pose_id=pose.id,
                muscle_id=muscle_data.muscle_id,
                activation_level=muscle_data.activation_level,
            )
            for muscle_data in pose_data.muscles
            if muscle_data.muscle_id in valid_muscle_ids
        ]
        db.add_all(pose_muscles_to_add)

    await db.flush()

    # Отримати позу з усіма зв'язками
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    await db.commit()
    return build_pose_response(pose)


@router.put("/{pose_id}", response_model=PoseResponse)
async def update_pose(
    pose_id: int,
    pose_data: PoseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Оновити позу.

    Implements optimistic locking to prevent lost updates:
    - Client must send the current version number
    - If version doesn't match, the update is rejected (409 Conflict)
    - This prevents concurrent edits from overwriting each other

    Uses nested transaction (savepoint) to ensure atomicity:
    - If version creation succeeds but pose update fails, the version is rolled back
    - This prevents orphan versions from being created
    """
    from services.versioning import versioning_service

    # Get pose with all relationships for versioning
    query = (
        select(Pose)
        .options(
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle)
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # OPTIMISTIC LOCKING: Check version to prevent concurrent edit conflicts
    # If client sends a version, verify it matches current database version
    if pose_data.version is not None:
        current_version = pose.version or 1
        if pose_data.version != current_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Conflict: pose has been modified by another user. "
                       f"Your version: {pose_data.version}, current version: {current_version}. "
                       f"Please refresh and try again.",
            )

    # Use nested transaction (savepoint) for atomic version + update
    # This ensures if the pose update fails, the version is also rolled back
    async with db.begin_nested():
        # Create version snapshot BEFORE making changes
        # This preserves the current state so it can be restored later
        await versioning_service.create_version(
            db, pose, current_user.id,
            change_note=pose_data.change_note,
            check_for_changes=True  # Skip if nothing will change
        )

        # Оновлення полів (exclude version from update data - we manage it separately)
        update_data = pose_data.model_dump(exclude={"muscles", "analyzed_muscles", "change_note", "version"}, exclude_unset=True)

        # Перевірка на унікальність коду для цього користувача
        if "code" in update_data:
            if update_data["code"] is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Pose code cannot be empty",
                )
            existing = await db.execute(
                select(Pose).where(
                    and_(
                        Pose.code == update_data["code"],
                        Pose.user_id == current_user.id,
                        Pose.id != pose_id,
                    )
                )
            )
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Pose with this code already exists",
                )

        if "name" in update_data and update_data["name"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pose name cannot be empty",
            )

        # Перевірка категорії (якщо оновлюється)
        if "category_id" in update_data and update_data["category_id"] is not None:
            category = await db.execute(
                select(Category).where(
                    and_(
                        Category.id == update_data["category_id"],
                        Category.user_id == current_user.id,
                    )
                )
            )
            if not category.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Category not found",
                )

        for field, value in update_data.items():
            setattr(pose, field, value)

        # Оновлення м'язів (за ID) - using batch operations for performance
        if pose_data.muscles is not None:
            # Bulk delete old associations (single DELETE statement)
            await db.execute(
                delete(PoseMuscle).where(PoseMuscle.pose_id == pose_id)
            )
            # Clear the ORM relationship cache
            pose.pose_muscles.clear()

            # Batch validate muscle IDs (single SELECT instead of N queries)
            muscle_ids = [m.muscle_id for m in pose_data.muscles]
            result = await db.execute(
                select(Muscle.id).where(Muscle.id.in_(muscle_ids))
            )
            valid_muscle_ids = set(result.scalars().all())

            # Batch create new associations
            pose_muscles_to_add = [
                PoseMuscle(
                    pose_id=pose.id,
                    muscle_id=muscle_data.muscle_id,
                    activation_level=muscle_data.activation_level,
                )
                for muscle_data in pose_data.muscles
                if muscle_data.muscle_id in valid_muscle_ids
            ]
            db.add_all(pose_muscles_to_add)

        # Оновлення м'язів за назвою (з AI-аналізу)
        elif pose_data.analyzed_muscles is not None:
            # Bulk delete old associations (single DELETE statement)
            await db.execute(
                delete(PoseMuscle).where(PoseMuscle.pose_id == pose_id)
            )
            # Clear the ORM relationship cache
            pose.pose_muscles.clear()

            # Batch запит для всіх м'язів (оптимізація N+1)
            muscle_names = [m.name.lower() for m in pose_data.analyzed_muscles]
            result = await db.execute(
                select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
            )
            muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}

            # Batch create new associations
            pose_muscles_to_add = [
                PoseMuscle(
                    pose_id=pose.id,
                    muscle_id=muscles_by_name[analyzed.name.lower()].id,
                    activation_level=analyzed.activation_level,
                )
                for analyzed in pose_data.analyzed_muscles
                if analyzed.name.lower() in muscles_by_name
            ]
            db.add_all(pose_muscles_to_add)

        # OPTIMISTIC LOCKING: Increment version on successful update
        # This ensures the next update will see a different version
        pose.version = (pose.version or 1) + 1

        await db.flush()

    # Отримати оновлену позу (outside nested transaction)
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    await db.commit()
    return build_pose_response(pose)


@router.delete("/{pose_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pose(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Видалити позу"""
    query = select(Pose).where(
        and_(Pose.id == pose_id, Pose.user_id == current_user.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    await db.delete(pose)
    await db.commit()


@router.post("/{pose_id}/schema", response_model=PoseResponse)
async def upload_pose_schema(
    pose_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Завантажити схему для пози"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Validate file type
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Allowed: PNG, JPG, WEBP",
        )

    # Зберегти файл
    file_path = await save_upload_file(file, "schemas")
    pose.schema_path = file_path

    await db.flush()
    await db.commit()
    await db.refresh(pose)

    return build_pose_response(pose)


@router.get("/{pose_id}/image/{image_type}")
async def get_pose_image(
    pose_id: int,
    image_type: str,
    current_user: User = Depends(get_current_user_from_request),
    db: AsyncSession = Depends(get_db),
):
    """
    Proxy endpoint to serve S3 images avoiding CORS issues.
    image_type: schema, photo, muscle_layer, skeleton_layer

    Note: This endpoint requires Authorization header. For <img> tags that can't
    send headers, use the S3 presigned URLs returned in pose.photo_path etc.
    """
    # Validate image_type
    valid_types = ["schema", "photo", "muscle_layer", "skeleton_layer"]
    if image_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image type. Must be one of: {valid_types}",
        )

    # Get pose (check user ownership)
    query = select(Pose).where(
        and_(Pose.id == pose_id, Pose.user_id == current_user.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pose not found",
        )

    # Get the URL based on image type
    url_map = {
        "schema": pose.schema_path,
        "photo": pose.photo_path,
        "muscle_layer": pose.muscle_layer_path,
        "skeleton_layer": pose.skeleton_layer_path,
    }
    image_url = url_map.get(image_type)

    if not image_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {image_type} image for this pose",
        )

    # Check if it's a local file path (starts with /storage/)
    if image_url.startswith("/storage/"):
        from pathlib import Path
        import aiofiles
        import mimetypes

        # Build local file path
        storage_base = Path(__file__).parent.parent.parent / "storage"
        local_path = storage_base / image_url[9:]  # Remove "/storage/" prefix

        # SECURITY: Validate resolved path is within storage directory to prevent path traversal
        try:
            resolved_path = local_path.resolve()
            resolved_base = storage_base.resolve()
            if not str(resolved_path).startswith(str(resolved_base) + os.sep) and resolved_path != resolved_base:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid image path",
                )
        except (OSError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image path",
            )

        if not local_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Image file not found: {image_url}",
            )

        try:
            async with aiofiles.open(local_path, "rb") as f:
                content = await f.read()

            # Guess content type from file extension
            content_type, _ = mimetypes.guess_type(str(local_path))
            if not content_type:
                content_type = "image/png"

            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                },
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to read local file: {str(e)}",
            )

    # Fetch image from S3 (remote URL)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(image_url, timeout=30.0)
            response.raise_for_status()

            # Determine content type
            content_type = response.headers.get("content-type", "image/jpeg")

            return Response(
                content=response.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",  # Cache for 1 day
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch image from storage: {str(e)}",
        )


@router.post("/{pose_id}/reanalyze-muscles", response_model=PoseResponse)
async def reanalyze_pose_muscles(
    pose_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-analyze muscles for an existing pose using AI.

    This is useful for poses that were saved before muscles were seeded,
    or when you want to update the muscle analysis.
    """
    from services.google_generator import GoogleGeminiGenerator

    # Get pose with current data
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    if not pose.photo_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose has no generated photo to analyze",
        )

    # Download the photo
    storage = get_storage()
    try:
        photo_bytes = await storage.download_bytes(pose.photo_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to download pose photo: {str(e)}",
        )

    # Analyze muscles using AI
    try:
        generator = GoogleGeminiGenerator()
        pose_description = f"{pose.name}"
        if pose.description:
            pose_description += f" - {pose.description}"

        analyzed_muscles = await generator._analyze_muscles_from_image(
            photo_bytes, "image/png", pose_description
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze muscles: {str(e)}",
        )

    if not analyzed_muscles:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not identify any muscles in the pose",
        )

    # Delete existing muscle associations
    await db.execute(
        delete(PoseMuscle).where(PoseMuscle.pose_id == pose.id)
    )

    # Get muscle IDs from database
    muscle_names = [m.name.lower() for m in analyzed_muscles]
    logger.info(f"Reanalyze: looking for muscles: {muscle_names}")

    result = await db.execute(
        select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
    )
    muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
    logger.info(f"Reanalyze: found {len(muscles_by_name)} muscles in database: {list(muscles_by_name.keys())}")

    # Create new muscle associations
    pose_muscles_to_add = [
        PoseMuscle(
            pose_id=pose.id,
            muscle_id=muscles_by_name[m.name.lower()].id,
            activation_level=m.activation_level,
        )
        for m in analyzed_muscles
        if m.name.lower() in muscles_by_name
    ]
    logger.info(f"Reanalyze: creating {len(pose_muscles_to_add)} PoseMuscle associations for pose {pose.id}")
    db.add_all(pose_muscles_to_add)

    await db.flush()

    # Refresh pose with new muscle data
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    await db.commit()
    return build_pose_response(pose)


@router.post("/{pose_id}/apply-generation/{task_id}", response_model=PoseResponse)
async def apply_generation_to_pose(
    pose_id: int,
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Apply generation results to an existing pose.

    This updates the pose with the generated photo and muscle layer,
    and creates PoseMuscle associations from the analyzed muscles.

    Use this after generating from an existing pose to update it
    with the generation results instead of creating a new pose.
    """
    import json
    from models.generation_task import GenerationTask

    # Get the pose
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.id == pose_id, Pose.user_id == current_user.id))
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Get the generation task
    task_result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == task_id)
    )
    task = task_result.scalar_one_or_none()

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
    if task.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Generation task is not completed yet",
        )

    # Update pose with generation results
    if task.photo_url:
        pose.photo_path = task.photo_url
        logger.info(f"Applied photo to pose {pose_id}: {task.photo_url[:50]}...")

    if task.muscles_url:
        pose.muscle_layer_path = task.muscles_url
        logger.info(f"Applied muscle layer to pose {pose_id}: {task.muscles_url[:50]}...")

    # Delete existing muscle associations and create new ones
    if task.analyzed_muscles_json:
        logger.info(f"Applying analyzed muscles to pose {pose_id}")

        # Delete existing associations
        await db.execute(
            delete(PoseMuscle).where(PoseMuscle.pose_id == pose_id)
        )

        try:
            muscles_data = json.loads(task.analyzed_muscles_json)
            logger.info(f"Parsed {len(muscles_data)} muscles from generation task")

            # Batch query for all muscles by name
            muscle_names = [m["name"].lower() for m in muscles_data]
            result = await db.execute(
                select(Muscle).where(func.lower(Muscle.name).in_(muscle_names))
            )
            muscles_by_name = {m.name.lower(): m for m in result.scalars().all()}
            logger.info(f"Found {len(muscles_by_name)} muscles in database")

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
            logger.info(f"Creating {len(pose_muscles_to_add)} PoseMuscle associations for pose {pose_id}")
            db.add_all(pose_muscles_to_add)

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to parse analyzed muscles: {e}")

    await db.flush()

    # Refresh pose with updated data
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one()

    await db.commit()
    return build_pose_response(pose)
