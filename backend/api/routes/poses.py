import os
import os
import uuid
from typing import List, Optional

from db.database import get_db
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from schemas.muscle import PoseMuscleResponse
from schemas.pose import PoseCreate, PoseListResponse, PoseResponse, PoseUpdate
from services.storage import S3Storage
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/api/poses", tags=["poses"])


async def save_upload_file(file: UploadFile, subdir: str = "") -> str:
    """Upload file to S3 and return public URL."""
    ext = os.path.splitext(file.filename)[1] if file.filename else ".png"
    filename = f"{uuid.uuid4()}{ext}"

    prefix = f"uploads/{subdir}" if subdir else "uploads"
    key = f"{prefix}/{filename}"

    content = await file.read()
    content_type = file.content_type or "image/png"

    storage = S3Storage.get_instance()
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
    db: AsyncSession = Depends(get_db),
):
    """Отримати список всіх поз"""
    query = select(Pose).options(selectinload(Pose.category)).order_by(Pose.code)

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
    q: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)
):
    """Пошук поз за назвою або кодом"""
    search_term = f"%{q}%"

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(
            or_(
                Pose.name.ilike(search_term),
                Pose.name_en.ilike(search_term),
                Pose.code.ilike(search_term),
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
async def get_poses_by_category(category_id: int, db: AsyncSession = Depends(get_db)):
    """Отримати пози за категорією"""
    # Перевірити чи категорія існує
    category = await db.execute(select(Category).where(Category.id == category_id))
    if not category.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(Pose.category_id == category_id)
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
async def get_pose(pose_id: int, db: AsyncSession = Depends(get_db)):
    """Отримати позу за ID"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.get("/code/{code}", response_model=PoseResponse)
async def get_pose_by_code(code: str, db: AsyncSession = Depends(get_db)):
    """Отримати позу за кодом"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.code == code)
    )

    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    return build_pose_response(pose)


@router.post("", response_model=PoseResponse, status_code=status.HTTP_201_CREATED)
async def create_pose(pose_data: PoseCreate, db: AsyncSession = Depends(get_db)):
    """Створити нову позу"""
    # Перевірка на унікальність коду
    existing = await db.execute(select(Pose).where(Pose.code == pose_data.code))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pose with this code already exists",
        )

    # Перевірка категорії
    if pose_data.category_id:
        category = await db.execute(
            select(Category).where(Category.id == pose_data.category_id)
        )
        if not category.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Category not found"
            )

    # Створення пози
    pose_dict = pose_data.model_dump(exclude={"muscles"})
    pose = Pose(**pose_dict)
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
    pose_id: int, pose_data: PoseUpdate, db: AsyncSession = Depends(get_db)
):
    """Оновити позу"""
    query = select(Pose).where(Pose.id == pose_id)
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Оновлення полів
    update_data = pose_data.model_dump(exclude={"muscles"}, exclude_unset=True)
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
async def delete_pose(pose_id: int, db: AsyncSession = Depends(get_db)):
    """Видалити позу"""
    query = select(Pose).where(Pose.id == pose_id)
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    await db.delete(pose)


@router.post("/{pose_id}/schema", response_model=PoseResponse)
async def upload_pose_schema(
    pose_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)
):
    """Завантажити схему для пози"""
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(Pose.id == pose_id)
    )
    result = await db.execute(query)
    pose = result.scalar_one_or_none()

    if not pose:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pose not found"
        )

    # Зберегти файл
    file_path = await save_upload_file(file, "schemas")
    pose.schema_path = file_path

    await db.flush()
    await db.refresh(pose)

    return build_pose_response(pose)
