"""Analytics schemas for dashboard statistics and visualizations."""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class OverviewStats(BaseModel):
    """Overview statistics for the dashboard."""

    total_poses: int = Field(..., ge=0, description="Total number of poses")
    total_categories: int = Field(..., ge=0, description="Total number of categories")
    poses_with_photos: int = Field(
        ..., ge=0, description="Number of poses with generated photos"
    )
    poses_with_muscles: int = Field(
        ..., ge=0, description="Number of poses with muscle data"
    )
    total_muscles: int = Field(..., ge=0, description="Total number of muscles in DB")
    completion_rate: float = Field(
        ..., ge=0, le=100, description="Percentage of poses with photos"
    )


class MuscleStats(BaseModel):
    """Statistics for a single muscle."""

    muscle_id: int = Field(..., description="Muscle ID")
    name: str = Field(..., description="Muscle name (English)")
    name_ua: Optional[str] = Field(None, description="Muscle name (Ukrainian)")
    body_part: Optional[str] = Field(None, description="Body part category")
    total_activations: int = Field(
        ..., ge=0, description="Total number of poses using this muscle"
    )
    avg_activation_level: float = Field(
        ..., ge=0, le=100, description="Average activation level across poses"
    )
    pose_count: int = Field(
        ..., ge=0, description="Number of poses that activate this muscle"
    )


class MuscleHeatmapData(BaseModel):
    """Data for muscle heatmap visualization."""

    muscles: List[MuscleStats] = Field(
        default_factory=list, description="All muscle statistics"
    )
    muscle_groups: Dict[str, List[MuscleStats]] = Field(
        default_factory=dict, description="Muscles grouped by body part"
    )
    most_trained: List[MuscleStats] = Field(
        default_factory=list, description="Top 5 most trained muscles"
    )
    least_trained: List[MuscleStats] = Field(
        default_factory=list, description="Top 5 least trained (neglected) muscles"
    )
    balance_score: float = Field(
        ..., ge=0, le=100, description="Balance score across muscle groups"
    )


class CategoryStats(BaseModel):
    """Statistics for a single category."""

    id: int = Field(..., description="Category ID")
    name: str = Field(..., description="Category name")
    description: Optional[str] = Field(None, description="Category description")
    pose_count: int = Field(..., ge=0, description="Number of poses in this category")
    percentage: float = Field(
        ..., ge=0, le=100, description="Percentage of total poses"
    )
    poses_with_photos: int = Field(
        ..., ge=0, description="Poses with photos in this category"
    )


class RecentActivity(BaseModel):
    """Recent activity item."""

    id: int = Field(..., description="Activity item ID (pose ID)")
    pose_code: str = Field(..., description="Pose code")
    pose_name: str = Field(..., description="Pose name")
    category_name: Optional[str] = Field(None, description="Category name")
    action: str = Field(
        ..., description="Action type: 'created', 'updated', 'photo_generated'"
    )
    timestamp: datetime = Field(..., description="When the activity occurred")
    has_photo: bool = Field(..., description="Whether pose has a generated photo")


class BodyPartBalance(BaseModel):
    """Balance statistics for body parts."""

    body_part: str = Field(..., description="Body part name")
    total_activations: int = Field(..., ge=0, description="Total muscle activations")
    muscle_count: int = Field(..., ge=0, description="Number of muscles in this part")
    avg_activation: float = Field(
        ..., ge=0, le=100, description="Average activation level"
    )
    percentage_of_total: float = Field(
        ..., ge=0, le=100, description="Percentage of total training focus"
    )


class AnalyticsSummary(BaseModel):
    """Complete analytics summary for the dashboard."""

    overview: OverviewStats
    muscle_heatmap: MuscleHeatmapData
    categories: List[CategoryStats]
    recent_activity: List[RecentActivity]
    body_part_balance: List[BodyPartBalance]
