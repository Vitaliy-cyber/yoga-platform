import os
import uuid
from typing import List, Optional

import httpx
from db.database import get_db
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.muscle import PoseMuscleResponse
from schemas.pose import PoseCreate, PoseListResponse, PoseResponse, PoseUpdate
from services.auth import get_current_user, get_current_user_from_request
from services.storage import get_storage
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/api/poses", tags=["poses"])

ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


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
        description=pose.description,
        effect=pose.effect,
        breathing=pose.breathing,
        schema_path=pose.schema_path,
        photo_path=pose.photo_path,
        muscle_layer_path=pose.muscle_layer_path,
        skeleton_layer_path=pose.skeleton_layer_path,
        created_at=pose.created_at,
        updated_at=pose.updated_at,
        muscles=muscles,
    )


@router.get("", response_model=List[PoseListResponse])
async def get_poses(
    category_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати список поз поточного користувача"""
    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(Pose.user_id == current_user.id)
        .order_by(Pose.code)
    )

    if category_id:
        query = query.where(Pose.category_id == category_id)

    query = query.offset(skip).limit(limit)

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


@router.get("/search", response_model=List[PoseListResponse])
async def search_poses(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пошук поз за назвою або кодом"""
    search_term = f"%{q}%"

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(
            and_(
                Pose.user_id == current_user.id,
                or_(
                    Pose.name.ilike(search_term),
                    Pose.name_en.ilike(search_term),
                    Pose.code.ilike(search_term),
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
            status_code=status.HTTP_400_BAD_REQUEST,
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

    # Додавання м'язів
    if pose_data.muscles:
        for muscle_data in pose_data.muscles:
            # Перевірити чи м'яз існує
            muscle = await db.execute(
                select(Muscle).where(Muscle.id == muscle_data.muscle_id)
            )
            if not muscle.scalar_one_or_none():
                continue

            pose_muscle = PoseMuscle(
                pose_id=pose.id,
                muscle_id=muscle_data.muscle_id,
                activation_level=muscle_data.activation_level,
            )
            db.add(pose_muscle)

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

    return build_pose_response(pose)


@router.put("/{pose_id}", response_model=PoseResponse)
async def update_pose(
    pose_id: int,
    pose_data: PoseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Оновити позу"""
    query = select(Pose).where(
        and_(Pose.id == pose_id, Pose.user_id == current_user.id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Оновлення полів
    update_data = pose_data.model_dump(exclude={"muscles"}, exclude_unset=True)

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
                status_code=status.HTTP_400_BAD_REQUEST,
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

    # Оновлення м'язів
    if pose_data.muscles is not None:
        # Видалити старі зв'язки
        await db.execute(select(PoseMuscle).where(PoseMuscle.pose_id == pose_id))
        for pm in pose.pose_muscles:
            await db.delete(pm)

        # Додати нові
        for muscle_data in pose_data.muscles:
            muscle = await db.execute(
                select(Muscle).where(Muscle.id == muscle_data.muscle_id)
            )
            if not muscle.scalar_one_or_none():
                continue

            pose_muscle = PoseMuscle(
                pose_id=pose.id,
                muscle_id=muscle_data.muscle_id,
                activation_level=muscle_data.activation_level,
            )
            db.add(pose_muscle)

    await db.flush()

    # Отримати оновлену позу
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
        local_path = (
            Path(__file__).parent.parent.parent / "storage" / image_url[9:]
        )  # Remove "/storage/" prefix

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
