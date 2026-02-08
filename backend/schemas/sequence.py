"""Pydantic schemas for sequences."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from models.sequence import DifficultyLevel
from .validators import normalize_optional_text, normalize_required_text


# ============== SequencePose Schemas ==============

class SequencePoseBase(BaseModel):
    """Base schema for a pose in a sequence."""
    pose_id: int
    order_index: int = Field(default=0, ge=0)
    duration_seconds: int = Field(default=30, gt=0, le=3600)  # Max 1 hour per pose
    transition_note: Optional[str] = Field(None, max_length=500)

    @field_validator("transition_note", mode="before")
    @classmethod
    def normalize_transition_note(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value, strip_html=True)


class SequencePoseCreate(SequencePoseBase):
    """Schema for adding a pose to a sequence."""
    pass


class SequencePoseUpdate(BaseModel):
    """Schema for updating a pose in a sequence."""
    duration_seconds: Optional[int] = Field(default=None, gt=0, le=3600)  # Max 1 hour per pose
    transition_note: Optional[str] = Field(None, max_length=500)

    @field_validator("transition_note", mode="before")
    @classmethod
    def normalize_transition_note(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value, strip_html=True)


class SequencePoseResponse(BaseModel):
    """Response schema for a pose in a sequence."""
    id: int
    pose_id: int
    order_index: int
    duration_seconds: int
    transition_note: Optional[str] = None
    # Pose details (from eager loading)
    pose_name: str
    pose_code: str
    pose_photo_path: Optional[str] = None
    pose_schema_path: Optional[str] = None

    model_config = {"from_attributes": True}


# ============== Sequence Schemas ==============

class SequenceBase(BaseModel):
    """Base schema for a sequence."""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    difficulty: DifficultyLevel = DifficultyLevel.BEGINNER

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return normalize_required_text(value, field_name="Name")

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value)


class SequenceCreate(SequenceBase):
    """Schema for creating a sequence."""
    poses: Optional[List[SequencePoseCreate]] = None


class SequenceUpdate(BaseModel):
    """Schema for updating a sequence."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    difficulty: Optional[DifficultyLevel] = None

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        return normalize_required_text(value, field_name="Name")

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value)


class SequenceResponse(SequenceBase):
    """Full response schema for a sequence."""
    id: int
    user_id: int
    duration_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    poses: List[SequencePoseResponse] = []

    model_config = {"from_attributes": True}


class SequenceListResponse(BaseModel):
    """List item response for a sequence (without full pose details)."""
    id: int
    name: str
    description: Optional[str] = None
    difficulty: DifficultyLevel
    duration_seconds: Optional[int] = None
    pose_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PaginatedSequenceResponse(BaseModel):
    """Paginated response for sequences."""
    items: List[SequenceListResponse]
    total: int
    skip: int
    limit: int


class ReorderPosesRequest(BaseModel):
    """Request schema for reordering poses in a sequence."""
    pose_ids: List[int] = Field(..., min_length=1, max_length=500)  # Reasonable limit for sequence size
