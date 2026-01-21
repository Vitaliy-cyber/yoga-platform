from typing import List, Optional

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, status
from models.muscle import Muscle
from models.user import User
from schemas.muscle import MuscleCreate, MuscleResponse
from services.auth import get_current_user
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/muscles", tags=["muscles"])


@router.get("", response_model=List[MuscleResponse])
async def get_muscles(
    body_part: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати список всіх м'язів"""
    query = select(Muscle)

    if body_part:
        normalized_body_part = body_part.strip().lower()
        query = query.where(Muscle.body_part == normalized_body_part)

    query = query.order_by(Muscle.body_part, Muscle.name)

    result = await db.execute(query)
    muscles = result.scalars().all()

    return [MuscleResponse.model_validate(m) for m in muscles]


@router.get("/{muscle_id}", response_model=MuscleResponse)
async def get_muscle(
    muscle_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отримати м'яз за ID"""
    query = select(Muscle).where(Muscle.id == muscle_id)
    result = await db.execute(query)
    muscle = result.scalar_one_or_none()

    if not muscle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Muscle not found"
        )

    return MuscleResponse.model_validate(muscle)


@router.post("", response_model=MuscleResponse, status_code=status.HTTP_201_CREATED)
async def create_muscle(
    muscle_data: MuscleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Створити новий м'яз"""
    # Перевірка на унікальність назви (case-insensitive)
    existing = await db.execute(
        select(Muscle).where(func.lower(Muscle.name) == func.lower(muscle_data.name))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Muscle with this name already exists",
        )

    muscle = Muscle(**muscle_data.model_dump())
    db.add(muscle)
    await db.flush()
    await db.refresh(muscle)
    await db.commit()

    return MuscleResponse.model_validate(muscle)


@router.delete("/{muscle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_muscle(
    muscle_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Видалити м'яз"""
    query = select(Muscle).where(Muscle.id == muscle_id)
    result = await db.execute(query)
    muscle = result.scalar_one_or_none()

    if not muscle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Muscle not found"
        )

    await db.delete(muscle)
    await db.commit()


@router.post("/seed", response_model=List[MuscleResponse])
async def seed_muscles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заповнити базу даних стандартними м'язами"""
    default_muscles = [
        {"name": "erector_spinae", "name_ua": "Прямий м'яз спини", "body_part": "back"},
        {
            "name": "latissimus_dorsi",
            "name_ua": "Найширший м'яз спини",
            "body_part": "back",
        },
        {"name": "trapezius", "name_ua": "Трапецієподібний м'яз", "body_part": "back"},
        {"name": "rhomboids", "name_ua": "Ромбоподібні м'язи", "body_part": "back"},
        {
            "name": "rectus_abdominis",
            "name_ua": "Прямий м'яз живота",
            "body_part": "core",
        },
        {"name": "obliques", "name_ua": "Косі м'язи живота", "body_part": "core"},
        {
            "name": "transverse_abdominis",
            "name_ua": "Поперечний м'яз живота",
            "body_part": "core",
        },
        {
            "name": "quadriceps",
            "name_ua": "Чотириголовий м'яз стегна",
            "body_part": "legs",
        },
        {"name": "hamstrings", "name_ua": "Задня поверхня стегна", "body_part": "legs"},
        {
            "name": "gluteus_maximus",
            "name_ua": "Великий сідничний м'яз",
            "body_part": "legs",
        },
        {
            "name": "gluteus_medius",
            "name_ua": "Середній сідничний м'яз",
            "body_part": "legs",
        },
        {"name": "calves", "name_ua": "Литкові м'язи", "body_part": "legs"},
        {"name": "hip_flexors", "name_ua": "Згиначі стегна", "body_part": "legs"},
        {
            "name": "deltoids",
            "name_ua": "Дельтоподібний м'яз",
            "body_part": "shoulders",
        },
        {
            "name": "rotator_cuff",
            "name_ua": "Ротаторна манжета",
            "body_part": "shoulders",
        },
        {"name": "biceps", "name_ua": "Біцепс", "body_part": "arms"},
        {"name": "triceps", "name_ua": "Тріцепс", "body_part": "arms"},
        {"name": "forearms", "name_ua": "М'язи передпліччя", "body_part": "arms"},
        {"name": "pectoralis", "name_ua": "Грудні м'язи", "body_part": "chest"},
        {
            "name": "serratus_anterior",
            "name_ua": "Передній зубчастий м'яз",
            "body_part": "chest",
        },
    ]

    created_muscles = []
    for muscle_data in default_muscles:
        # Перевірити чи вже існує
        existing = await db.execute(
            select(Muscle).where(Muscle.name == muscle_data["name"])
        )
        if existing.scalar_one_or_none():
            continue

        muscle = Muscle(**muscle_data)
        db.add(muscle)
        created_muscles.append(muscle)

    await db.flush()

    for muscle in created_muscles:
        await db.refresh(muscle)

    await db.commit()
    return [MuscleResponse.model_validate(m) for m in created_muscles]
