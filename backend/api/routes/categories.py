import logging
from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, status
from models.category import Category
from models.pose import Pose
from models.user import User
from schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from services.auth import get_current_user
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/categories", tags=["categories"])
logger = logging.getLogger(__name__)


# Default categories to create for users
DEFAULT_CATEGORIES = [
    {"name": "Стоячі пози", "description": "Пози, що виконуються стоячи (Standing poses)"},
    {"name": "Сидячі пози", "description": "Пози, що виконуються сидячи (Seated poses)"},
    {"name": "Баланс", "description": "Пози на баланс (Balance poses)"},
    {"name": "Прогини", "description": "Пози з прогином назад (Backbends)"},
    {"name": "Нахили", "description": "Нахили вперед (Forward bends)"},
    {"name": "Скручування", "description": "Пози зі скручуванням (Twists)"},
    {"name": "Інверсії", "description": "Перевернуті пози (Inversions)"},
    {"name": "Відновлювальні", "description": "Відновлювальні та розслаблюючі пози (Restorative)"},
]


async def ensure_default_categories(db: AsyncSession, user_id: int) -> int:
    """
    Ensure user has default categories. Creates them if missing.

    Args:
        db: Database session
        user_id: ID of the user

    Returns:
        Number of categories created (0 if user already had categories)
    """
    # Check if user already has categories
    count_query = select(func.count(Category.id)).where(Category.user_id == user_id)
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count > 0:
        return 0

    # Create default categories
    categories_created = 0
    for cat_data in DEFAULT_CATEGORIES:
        category = Category(
            user_id=user_id,
            name=cat_data["name"],
            description=cat_data["description"],
        )
        db.add(category)
        categories_created += 1

    await db.flush()
    logger.info(f"Created {categories_created} default categories for user {user_id}")
    return categories_created


@router.get("", response_model=List[CategoryResponse])
async def get_categories(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати список категорій поточного користувача"""
    # Auto-create default categories if user has none
    created = await ensure_default_categories(db, current_user.id)
    if created > 0:
        await db.commit()

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
                name=category.name,
                description=category.description,
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
        name=category.name,
        description=category.description,
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
    existing = await db.execute(
        select(Category).where(
            and_(
                func.lower(Category.name) == func.lower(category_data.name),
                Category.user_id == current_user.id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category with this name already exists",
        )

    category = Category(user_id=current_user.id, **category_data.model_dump())
    db.add(category)
    await db.flush()
    await db.refresh(category)
    await db.commit()

    return CategoryResponse(
        id=category.id,
        name=category.name,
        description=category.description,
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
        existing = await db.execute(
            select(Category).where(
                and_(
                    func.lower(Category.name) == func.lower(update_data["name"]),
                    Category.user_id == current_user.id,
                    Category.id != category_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category with this name already exists",
            )

    for field, value in update_data.items():
        setattr(category, field, value)

    await db.flush()
    await db.refresh(category)
    await db.commit()

    # Підрахунок поз користувача
    pose_count_query = select(func.count(Pose.id)).where(
        and_(Pose.category_id == category_id, Pose.user_id == current_user.id)
    )
    pose_count_result = await db.execute(pose_count_query)
    pose_count = pose_count_result.scalar() or 0

    return CategoryResponse(
        id=category.id,
        name=category.name,
        description=category.description,
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
    await db.commit()
