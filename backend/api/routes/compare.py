"""API routes for pose comparison feature."""

import logging
from collections import defaultdict
from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, HTTPException, Query, status

logger = logging.getLogger(__name__)
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.compare import ComparisonResult, MuscleComparison, PoseComparisonItem
from schemas.muscle import PoseMuscleResponse
from services.auth import get_current_user
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/compare", tags=["compare"])

MAX_POSES_FOR_COMPARISON = 4
MIN_POSES_FOR_COMPARISON = 2


def build_pose_comparison_item(pose: Pose) -> PoseComparisonItem:
    """Build a PoseComparisonItem from a Pose model."""
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

    return PoseComparisonItem(
        id=pose.id,
        name=pose.name,
        name_en=pose.name_en,
        category_name=pose.category.name if pose.category else None,
        photo_path=pose.photo_path,
        muscle_layer_path=pose.muscle_layer_path,
        muscles=muscles,
    )


def compute_muscle_comparison(
    poses: List[PoseComparisonItem],
) -> tuple[List[MuscleComparison], List[str], dict[int, List[str]]]:
    """
    Compute muscle comparison data from a list of poses.

    Returns:
        - List of MuscleComparison objects
        - List of common muscle names (active in all poses)
        - Dict mapping pose_id to list of unique muscle names
    """
    pose_ids = [p.id for p in poses]

    # Gather all muscles across all poses
    all_muscles: dict[int, MuscleComparison] = {}
    pose_muscle_sets: dict[int, set[str]] = {pid: set() for pid in pose_ids}

    for pose in poses:
        for muscle in pose.muscles:
            # Track which muscles each pose has
            pose_muscle_sets[pose.id].add(muscle.muscle_name)

            # Build or update MuscleComparison
            if muscle.muscle_id not in all_muscles:
                all_muscles[muscle.muscle_id] = MuscleComparison(
                    muscle_id=muscle.muscle_id,
                    muscle_name=muscle.muscle_name,
                    muscle_name_ua=muscle.muscle_name_ua,
                    body_part=muscle.body_part,
                    activations={},
                )

            all_muscles[muscle.muscle_id].activations[pose.id] = muscle.activation_level

    # Convert to list sorted by muscle name
    muscle_comparison = sorted(all_muscles.values(), key=lambda m: m.muscle_name)

    # Find common muscles (present in ALL poses)
    if pose_ids:
        common_muscle_names = set.intersection(*pose_muscle_sets.values())
    else:
        common_muscle_names = set()

    # Find unique muscles for each pose
    unique_muscles: dict[int, List[str]] = {}
    for pose_id in pose_ids:
        other_muscles = set()
        for other_id in pose_ids:
            if other_id != pose_id:
                other_muscles.update(pose_muscle_sets[other_id])

        unique = pose_muscle_sets[pose_id] - other_muscles
        unique_muscles[pose_id] = sorted(unique)

    return muscle_comparison, sorted(common_muscle_names), unique_muscles


def _dedupe_pose_ids(ids: List[int], *, user_id: int, log_label: str) -> List[int]:
    """Remove duplicate pose IDs while preserving order (avoids redundant work)."""
    seen: set[int] = set()
    unique_ids: List[int] = []
    duplicate_ids: List[int] = []
    for pid in ids:
        if pid not in seen:
            seen.add(pid)
            unique_ids.append(pid)
        else:
            duplicate_ids.append(pid)

    if duplicate_ids:
        logger.warning(
            "Duplicate pose IDs removed from %s request: %s (user_id=%s)",
            log_label,
            duplicate_ids,
            user_id,
        )
    return unique_ids


@router.get("/poses", response_model=ComparisonResult)
async def compare_poses(
    ids: str = Query(
        ...,
        description="Comma-separated list of pose IDs to compare (2-4 poses)",
        examples=["1,2,3"],
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Compare multiple poses side-by-side.

    Returns detailed comparison data including:
    - Pose details for each pose
    - Muscle activation comparison across all poses
    - Common muscles (active in all poses)
    - Unique muscles for each pose
    """
    # Parse and validate IDs
    try:
        pose_ids = [int(id_str.strip()) for id_str in ids.split(",") if id_str.strip()]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pose IDs. Please provide comma-separated integers.",
        )

    pose_ids = _dedupe_pose_ids(pose_ids, user_id=current_user.id, log_label="comparison")

    if len(pose_ids) < MIN_POSES_FOR_COMPARISON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least {MIN_POSES_FOR_COMPARISON} poses are required for comparison.",
        )

    if len(pose_ids) > MAX_POSES_FOR_COMPARISON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {MAX_POSES_FOR_COMPARISON} poses can be compared at once.",
        )

    # SECURITY: Avoid differentiating between "missing" and "belongs to another user".
    # Treat both as 404 to prevent ID enumeration.
    query = (
        select(Pose)
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.user_id == current_user.id, Pose.id.in_(pose_ids)))
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    if len(poses) != len(pose_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more poses not found",
        )

    # Build comparison items (preserve requested order)
    pose_map = {p.id: p for p in poses}
    pose_items = [build_pose_comparison_item(pose_map[pid]) for pid in pose_ids]

    # Compute muscle comparison
    muscle_comparison, common_muscles, unique_muscles = compute_muscle_comparison(
        pose_items
    )

    return ComparisonResult(
        poses=pose_items,
        muscle_comparison=muscle_comparison,
        common_muscles=common_muscles,
        unique_muscles=unique_muscles,
    )


@router.get("/muscles", response_model=List[MuscleComparison])
async def compare_muscles(
    pose_ids: str = Query(
        ...,
        description="Comma-separated list of pose IDs to compare muscles",
        examples=["1,2"],
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get muscle activation comparison between poses.

    Returns a list of muscles with their activation levels for each pose.
    This is a lighter endpoint if you only need muscle data.
    """
    # Parse and validate IDs
    try:
        ids = [int(id_str.strip()) for id_str in pose_ids.split(",") if id_str.strip()]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pose IDs. Please provide comma-separated integers.",
        )

    ids = _dedupe_pose_ids(ids, user_id=current_user.id, log_label="muscle comparison")

    if len(ids) < MIN_POSES_FOR_COMPARISON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least {MIN_POSES_FOR_COMPARISON} poses are required for comparison.",
        )

    if len(ids) > MAX_POSES_FOR_COMPARISON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {MAX_POSES_FOR_COMPARISON} poses can be compared at once.",
        )

    # SECURITY: Avoid differentiating between "missing" and "belongs to another user".
    # Treat both as 404 to prevent ID enumeration.
    query = (
        select(Pose)
        # IMPORTANT: build_pose_comparison_item() reads `pose.category` as well.
        # Without eager loading, async SQLAlchemy may attempt a lazy load and crash
        # with MissingGreenlet under concurrency.
        .options(
            selectinload(Pose.category),
            selectinload(Pose.pose_muscles).selectinload(PoseMuscle.muscle),
        )
        .where(and_(Pose.user_id == current_user.id, Pose.id.in_(ids)))
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    if len(poses) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more poses not found",
        )

    # Build comparison items
    pose_items = [build_pose_comparison_item(p) for p in poses]

    # Compute muscle comparison (only need the first return value)
    muscle_comparison, _, _ = compute_muscle_comparison(pose_items)

    return muscle_comparison
