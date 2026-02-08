import logging
from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, status
from models.category import Category
from models.pose import Pose
from models.user import User
from schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from schemas.validators import strip_invisible_edges
from services.auth import get_current_user
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/categories", tags=["categories"])
logger = logging.getLogger(__name__)


def _safe_category_name(value: object) -> str:
    if not isinstance(value, str):
        return "<invalid>"
    normalized = strip_invisible_edges(value)
    if not normalized:
        return "<invalid>"
    try:
        normalized.encode("utf-8")
    except UnicodeEncodeError:
        return "<invalid>"
    return normalized[:100]


def _safe_category_description(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    normalized = strip_invisible_edges(value)
    if not normalized:
        return None
    try:
        normalized.encode("utf-8")
    except UnicodeEncodeError:
        return None
    return normalized[:2000]


async def _category_name_exists_casefold(
    *,
    db: AsyncSession,
    user_id: int,
    name: str,
    exclude_category_id: int | None = None,
) -> bool:
    """
    Case-insensitive (Unicode-aware) uniqueness check for category names.

    SQLite's LOWER() is ASCII-only in many builds, so use Python casefold to
    correctly handle Cyrillic/Unicode names.
    """
    stmt = select(Category.name).where(Category.user_id == user_id)
    if exclude_category_id is not None:
        stmt = stmt.where(Category.id != exclude_category_id)

    result = await db.execute(stmt)
    target = name.casefold()
    for existing in result.scalars():
        if not isinstance(existing, str):
            continue
        normalized = strip_invisible_edges(existing)
        if normalized and normalized.casefold() == target:
            return True
    return False


@router.get("", response_model=List[CategoryResponse])
async def get_categories(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати список категорій поточного користувача"""
    # Підзапит для підрахунку поз користувача
    pose_count_subq = (
        select(Pose.category_id, func.count(Pose.id).label("pose_count"))
        .where(Pose.user_id == current_user.id)
        .group_by(Pose.category_id)
        .subquery()
    )

    query = (
        select(Category, pose_count_subq.c.pose_count)
        .where(Category.user_id == current_user.id)
        .outerjoin(pose_count_subq, Category.id == pose_count_subq.c.category_id)
        .order_by(Category.name)
    )

    result = await db.execute(query)
    rows = result.all()

    categories = []
    for row in rows:
        category = row[0]
        pose_count = row[1] or 0
        categories.append(
            CategoryResponse(
                id=category.id,
                name=_safe_category_name(category.name),
                description=_safe_category_description(category.description),
                created_at=category.created_at,
                pose_count=pose_count,
            )
        )

    return categories


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати категорію за ID"""
    query = select(Category).where(
        and_(Category.id == category_id, Category.user_id == current_user.id)
    )
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    # Підрахунок поз користувача
    pose_count_query = select(func.count(Pose.id)).where(
        and_(Pose.category_id == category_id, Pose.user_id == current_user.id)
    )
    pose_count_result = await db.execute(pose_count_query)
    pose_count = pose_count_result.scalar() or 0

    return CategoryResponse(
        id=category.id,
        name=_safe_category_name(category.name),
        description=_safe_category_description(category.description),
        created_at=category.created_at,
        pose_count=pose_count,
    )


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    category_data: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Створити нову категорію"""
    # Перевірка на унікальність назви для цього користувача (case-insensitive)
    if await _category_name_exists_casefold(
        db=db, user_id=current_user.id, name=category_data.name
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category with this name already exists",
        )

    category = Category(user_id=current_user.id, **category_data.model_dump())
    db.add(category)
    try:
        await db.flush()
        await db.refresh(category)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Handle race conditions where another request created the category
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category with this name already exists",
        )
    except OperationalError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while creating category. Please retry.",
        )

    return CategoryResponse(
        id=category.id,
        name=_safe_category_name(category.name),
        description=_safe_category_description(category.description),
        created_at=category.created_at,
        pose_count=0,
    )


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    category_data: CategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Оновити категорію"""
    query = select(Category).where(
        and_(Category.id == category_id, Category.user_id == current_user.id)
    )
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    update_data = category_data.model_dump(exclude_unset=True)

    # If name is being updated, ensure uniqueness for this user
    if "name" in update_data:
        if update_data["name"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category name cannot be empty",
            )
        if await _category_name_exists_casefold(
            db=db,
            user_id=current_user.id,
            name=update_data["name"],
            exclude_category_id=category_id,
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category with this name already exists",
            )

    for field, value in update_data.items():
        setattr(category, field, value)

    try:
        await db.flush()
        await db.refresh(category)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category with this name already exists",
        )
    except OperationalError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while updating category. Please retry.",
        )

    # Підрахунок поз користувача
    pose_count_query = select(func.count(Pose.id)).where(
        and_(Pose.category_id == category_id, Pose.user_id == current_user.id)
    )
    pose_count_result = await db.execute(pose_count_query)
    pose_count = pose_count_result.scalar() or 0

    return CategoryResponse(
        id=category.id,
        name=_safe_category_name(category.name),
        description=_safe_category_description(category.description),
        created_at=category.created_at,
        pose_count=pose_count,
    )


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Видалити категорію"""
    query = select(Category).where(
        and_(Category.id == category_id, Category.user_id == current_user.id)
    )
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    await db.delete(category)
    try:
        await db.commit()
    except OperationalError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict while deleting category. Please retry.",
        )
