"""Analytics API routes for dashboard statistics and visualizations."""

from collections import defaultdict
from typing import List

from db.database import get_db
from fastapi import APIRouter, Depends, Query
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User
from schemas.analytics import (
    AnalyticsSummary,
    BodyPartBalance,
    CategoryStats,
    MuscleHeatmapData,
    MuscleStats,
    OverviewStats,
    RecentActivity,
)
from services.auth import get_current_user
from sqlalchemy import and_, case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview", response_model=OverviewStats)
async def get_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get overview statistics for the dashboard.
    Returns total poses, categories, poses with photos, and poses with muscles.
    """
    # Count total poses for this user
    total_poses_result = await db.execute(
        select(func.count(Pose.id)).where(Pose.user_id == current_user.id)
    )
    total_poses = total_poses_result.scalar() or 0

    # Count total categories for this user
    total_categories_result = await db.execute(
        select(func.count(Category.id)).where(Category.user_id == current_user.id)
    )
    total_categories = total_categories_result.scalar() or 0

    # Count poses with photos
    poses_with_photos_result = await db.execute(
        select(func.count(Pose.id)).where(
            and_(
                Pose.user_id == current_user.id,
                Pose.photo_path.isnot(None),
                Pose.photo_path != "",
            )
        )
    )
    poses_with_photos = poses_with_photos_result.scalar() or 0

    # Count poses with muscle data
    poses_with_muscles_subquery = (
        select(PoseMuscle.pose_id).distinct().subquery()
    )
    poses_with_muscles_result = await db.execute(
        select(func.count(Pose.id)).where(
            and_(
                Pose.user_id == current_user.id,
                Pose.id.in_(select(poses_with_muscles_subquery.c.pose_id)),
            )
        )
    )
    poses_with_muscles = poses_with_muscles_result.scalar() or 0

    # Count total muscles
    total_muscles_result = await db.execute(select(func.count(Muscle.id)))
    total_muscles = total_muscles_result.scalar() or 0

    # Calculate completion rate
    completion_rate = (poses_with_photos / total_poses * 100) if total_poses > 0 else 0

    return OverviewStats(
        total_poses=total_poses,
        total_categories=total_categories,
        poses_with_photos=poses_with_photos,
        poses_with_muscles=poses_with_muscles,
        total_muscles=total_muscles,
        completion_rate=round(completion_rate, 1),
    )


@router.get("/muscles", response_model=List[MuscleStats])
async def get_muscle_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get muscle statistics - activation counts and average levels.
    Shows which muscles are most/least trained.

    Required database indexes for optimal performance:
    - CREATE INDEX idx_pose_muscle_muscle_id ON pose_muscles(muscle_id);
    - CREATE INDEX idx_pose_muscle_pose_id ON pose_muscles(pose_id);
    - CREATE INDEX idx_pose_user_id ON poses(user_id);

    These indexes ensure the JOIN and subquery operations perform efficiently.
    Consider adding a migration if these indexes do not exist.
    """
    # Get all muscles with their activation stats for this user's poses
    query = (
        select(
            Muscle.id,
            Muscle.name,
            Muscle.name_ua,
            Muscle.body_part,
            func.count(PoseMuscle.pose_id).label("total_activations"),
            func.coalesce(func.avg(PoseMuscle.activation_level), 0).label(
                "avg_activation_level"
            ),
            func.count(func.distinct(PoseMuscle.pose_id)).label("pose_count"),
        )
        .outerjoin(
            PoseMuscle,
            and_(
                Muscle.id == PoseMuscle.muscle_id,
                PoseMuscle.pose_id.in_(
                    select(Pose.id).where(Pose.user_id == current_user.id)
                ),
            ),
        )
        .group_by(Muscle.id, Muscle.name, Muscle.name_ua, Muscle.body_part)
        .order_by(desc("total_activations"), Muscle.name)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        MuscleStats(
            muscle_id=row.id,
            name=row.name,
            name_ua=row.name_ua,
            body_part=row.body_part,
            total_activations=row.total_activations or 0,
            avg_activation_level=round(float(row.avg_activation_level or 0), 1),
            pose_count=row.pose_count or 0,
        )
        for row in rows
    ]


@router.get("/muscle-heatmap", response_model=MuscleHeatmapData)
async def get_muscle_heatmap(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get data for muscle heatmap visualization.
    Includes grouping by body part and balance analysis.
    """
    # Get all muscle stats
    muscle_stats = await get_muscle_stats(current_user, db)

    # Group by body part
    muscle_groups: dict[str, list[MuscleStats]] = defaultdict(list)
    for stat in muscle_stats:
        part = stat.body_part or "other"
        muscle_groups[part].append(stat)

    # Get most trained (top 5)
    sorted_by_activation = sorted(
        muscle_stats, key=lambda x: x.total_activations, reverse=True
    )
    most_trained = sorted_by_activation[:5]

    # Get least trained (bottom 5 that have been used at least once, or all unused)
    used_muscles = [m for m in muscle_stats if m.total_activations > 0]
    unused_muscles = [m for m in muscle_stats if m.total_activations == 0]

    if unused_muscles:
        least_trained = unused_muscles[:5]
    else:
        least_trained = sorted(used_muscles, key=lambda x: x.total_activations)[:5]

    # Calculate balance score
    # Compare front vs back, upper vs lower body
    body_parts = {
        "front": ["chest", "core"],
        "back": ["back"],
        "upper": ["shoulders", "arms", "chest", "back"],
        "lower": ["legs"],
    }

    part_activations: dict[str, int] = defaultdict(int)
    for stat in muscle_stats:
        part = stat.body_part or "other"
        part_activations[part] += stat.total_activations

    # Calculate balance score (100 = perfectly balanced, 0 = very imbalanced)
    total_activations = sum(part_activations.values())
    if total_activations > 0:
        # Calculate standard deviation from ideal distribution
        num_parts = len([p for p in part_activations.values() if p > 0])
        if num_parts > 1:
            # Need at least 2 parts to calculate meaningful balance
            ideal_per_part = total_activations / num_parts
            variance = sum(
                (v - ideal_per_part) ** 2 for v in part_activations.values() if v > 0
            ) / num_parts
            std_dev = variance**0.5
            # max_std_dev is total_activations when all activations are in one part
            # Protect against division by zero (though total_activations > 0 here)
            max_std_dev = total_activations
            balance_score = max(0.0, 100.0 - (std_dev / max_std_dev * 100.0))
        else:
            # With 0 or 1 parts, balance is perfect (no comparison possible)
            balance_score = 100.0
    else:
        balance_score = 100.0  # No data means no imbalance

    return MuscleHeatmapData(
        muscles=muscle_stats,
        muscle_groups=dict(muscle_groups),
        most_trained=most_trained,
        least_trained=least_trained,
        balance_score=round(balance_score, 1),
    )


@router.get("/categories", response_model=List[CategoryStats])
async def get_category_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get statistics for all categories.
    Shows pose distribution across categories.
    """
    # Get total poses for percentage calculation
    total_poses_result = await db.execute(
        select(func.count(Pose.id)).where(Pose.user_id == current_user.id)
    )
    total_poses = total_poses_result.scalar() or 0

    # Get categories with pose counts
    query = (
        select(
            Category.id,
            Category.name,
            Category.description,
            func.count(Pose.id).label("pose_count"),
            func.sum(
                case((Pose.photo_path.isnot(None), 1), else_=0)
            ).label("poses_with_photos"),
        )
        .outerjoin(
            Pose,
            and_(Category.id == Pose.category_id, Pose.user_id == current_user.id),
        )
        .where(Category.user_id == current_user.id)
        .group_by(Category.id, Category.name, Category.description)
        .order_by(desc("pose_count"), Category.name)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        CategoryStats(
            id=row.id,
            name=row.name,
            description=row.description,
            pose_count=row.pose_count or 0,
            percentage=(
                round((row.pose_count or 0) / total_poses * 100, 1)
                if total_poses > 0
                else 0
            ),
            poses_with_photos=row.poses_with_photos or 0,
        )
        for row in rows
    ]


@router.get("/recent-activity", response_model=List[RecentActivity])
async def get_recent_activity(
    limit: int = Query(10, ge=1, le=50, description="Number of items to return"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get recent activity - recently added or modified poses.
    Shows the latest changes for activity feed.
    """
    # Get recently modified poses
    query = (
        select(Pose)
        .options(selectinload(Pose.category))
        .where(Pose.user_id == current_user.id)
        .order_by(desc(Pose.updated_at))
        .limit(limit)
    )

    result = await db.execute(query)
    poses = result.scalars().all()

    activities = []
    for pose in poses:
        # Determine action based on timestamps only.
        # Note: We only use "created" vs "updated" because we cannot reliably
        # determine if a photo was newly generated without storing the action
        # type in the database. The previous logic incorrectly showed
        # "photo_generated" even when the photo existed from creation.
        if pose.created_at == pose.updated_at:
            action = "created"
        else:
            action = "updated"

        activities.append(
            RecentActivity(
                id=pose.id,
                pose_code=pose.code,
                pose_name=pose.name,
                category_name=pose.category.name if pose.category else None,
                action=action,
                timestamp=pose.updated_at,
                has_photo=bool(pose.photo_path),
            )
        )

    return activities


@router.get("/body-part-balance", response_model=List[BodyPartBalance])
async def get_body_part_balance(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get balance statistics by body part.
    Shows distribution of training across different body areas.
    """
    # Get activations grouped by body part
    query = (
        select(
            Muscle.body_part,
            func.sum(PoseMuscle.activation_level).label("total_activations"),
            func.count(func.distinct(Muscle.id)).label("muscle_count"),
            func.coalesce(func.avg(PoseMuscle.activation_level), 0).label(
                "avg_activation"
            ),
        )
        .join(PoseMuscle, Muscle.id == PoseMuscle.muscle_id)
        .join(Pose, PoseMuscle.pose_id == Pose.id)
        .where(Pose.user_id == current_user.id)
        .group_by(Muscle.body_part)
        .order_by(desc("total_activations"))
    )

    result = await db.execute(query)
    rows = result.all()

    # Calculate total for percentages
    total_activations = sum(row.total_activations or 0 for row in rows)

    return [
        BodyPartBalance(
            body_part=row.body_part or "other",
            total_activations=row.total_activations or 0,
            muscle_count=row.muscle_count or 0,
            avg_activation=round(float(row.avg_activation or 0), 1),
            percentage_of_total=(
                round((row.total_activations or 0) / total_activations * 100, 1)
                if total_activations > 0
                else 0
            ),
        )
        for row in rows
    ]


@router.get("/summary", response_model=AnalyticsSummary)
async def get_analytics_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get complete analytics summary for the dashboard.
    Combines all analytics data in a single request.

    Note: Queries are executed sequentially because SQLAlchemy async sessions
    are not safe for concurrent use. Using asyncio.gather() with multiple
    queries on the same session can cause race conditions and data corruption.
    """
    # Execute queries sequentially - async sessions are not thread-safe
    overview = await get_overview(current_user, db)
    muscle_heatmap = await get_muscle_heatmap(current_user, db)
    categories = await get_category_stats(current_user, db)
    recent_activity = await get_recent_activity(10, current_user, db)
    body_part_balance = await get_body_part_balance(current_user, db)

    return AnalyticsSummary(
        overview=overview,
        muscle_heatmap=muscle_heatmap,
        categories=categories,
        recent_activity=recent_activity,
        body_part_balance=body_part_balance,
    )
