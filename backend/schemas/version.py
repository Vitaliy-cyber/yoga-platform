"""
Pydantic schemas for pose versioning API.

Provides data transfer objects for:
- Version listing and details
- Version comparison (diff)
- Version restoration
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class VersionMuscleSnapshot(BaseModel):
    """Muscle data as stored in a version snapshot."""
    muscle_id: int
    muscle_name: Optional[str] = Field(None, max_length=100)
    muscle_name_ua: Optional[str] = Field(None, max_length=100)
    body_part: Optional[str] = Field(None, max_length=50)
    activation_level: int


class PoseVersionBase(BaseModel):
    """Base fields for pose version."""
    id: int
    version_number: int
    name: str
    change_note: Optional[str] = None
    changed_by_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PoseVersionListResponse(PoseVersionBase):
    """Version info for list display."""
    pass


class PoseVersionDetailResponse(PoseVersionBase):
    """Full version details including all snapshot data."""
    name_en: Optional[str] = None
    code: str
    category_id: Optional[int] = None
    description: Optional[str] = None
    effect: Optional[str] = None
    breathing: Optional[str] = None
    schema_path: Optional[str] = None
    photo_path: Optional[str] = None
    muscle_layer_path: Optional[str] = None
    skeleton_layer_path: Optional[str] = None
    muscles: List[VersionMuscleSnapshot] = []


class VersionDiff(BaseModel):
    """Single field difference between versions."""
    field: str
    old_value: Any
    new_value: Any
    # For muscle changes, additional detail
    changes: Optional[List[Dict[str, Any]]] = None


class VersionSummary(BaseModel):
    """Summary of a version for comparison display."""
    id: int
    version_number: int
    change_note: Optional[str] = None
    changed_by_name: Optional[str] = None
    created_at: Optional[str] = None


class VersionComparisonResult(BaseModel):
    """Result of comparing two versions."""
    version_1: VersionSummary
    version_2: VersionSummary
    differences: List[VersionDiff]


class RestoreVersionRequest(BaseModel):
    """Request body for version restore."""
    change_note: Optional[str] = Field(
        None,
        max_length=500,
        description="Optional note explaining the restore"
    )


class VersionCountResponse(BaseModel):
    """Response for version count query."""
    pose_id: int
    version_count: int


class PaginatedVersionResponse(BaseModel):
    """Paginated response for version history."""
    items: List[PoseVersionListResponse]
    total: int = Field(..., ge=0, description="Total number of versions")
    skip: int = Field(..., ge=0, description="Number of items skipped")
    limit: int = Field(..., ge=1, description="Maximum items per page")
