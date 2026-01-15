from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, status
from models.category import Category
from models.pose import Pose
from schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=List[CategoryResponse])
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Отримати список всіх категорій з кількістю поз"""
    # Підзапит для підрахунку поз
    pose_count_subq = (
        select(Pose.category_id, func.count(Pose.id).label("pose_count"))
        .group_by(Pose.category_id)
        .subquery()
    )

    query = (
        select(Category, pose_count_subq.c.pose_count)
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
async def get_category(category_id: int, db: AsyncSession = Depends(get_db)):
    """Отримати категорію за ID"""
    query = select(Category).where(Category.id == category_id)
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    # Підрахунок поз
    pose_count_query = select(func.count(Pose.id)).where(
        Pose.category_id == category_id
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
    category_data: CategoryCreate, db: AsyncSession = Depends(get_db)
):
    """Створити нову категорію"""
    # Перевірка на унікальність назви
    existing = await db.execute(
        select(Category).where(Category.name == category_data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category with this name already exists",
        )

    category = Category(**category_data.model_dump())
    db.add(category)
    await db.flush()
    await db.refresh(category)

    return CategoryResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        created_at=category.created_at,
        pose_count=0,
    )


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int, category_data: CategoryUpdate, db: AsyncSession = Depends(get_db)
):
    """Оновити категорію"""
    query = select(Category).where(Category.id == category_id)
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    update_data = category_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)

    await db.flush()
    await db.refresh(category)

    # Підрахунок поз
    pose_count_query = select(func.count(Pose.id)).where(
        Pose.category_id == category_id
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
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    """Видалити категорію"""
    query = select(Category).where(Category.id == category_id)
    result = await db.execute(query)
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
        )

    await db.delete(category)
