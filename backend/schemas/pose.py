from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from .muscle import PoseMuscleResponse


class PoseMuscleCreate(BaseModel):
    muscle_id: int
    activation_level: int = Field(..., ge=0, le=100)


class PoseMuscleCreateByName(BaseModel):
    """Create muscle association by muscle name (for AI-analyzed muscles)"""
    name: str = Field(..., min_length=1, max_length=100)
    activation_level: int = Field(..., ge=0, le=100)


class PoseBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_id: Optional[int] = None
    description: Optional[str] = Field(None, max_length=5000)
    effect: Optional[str] = Field(None, max_length=2000)
    breathing: Optional[str] = Field(None, max_length=2000)

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("Code cannot be blank")
            return normalized
        return value

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("Name cannot be blank")
            return normalized
        return value

    @field_validator("name_en", "description", "effect", "breathing", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class PoseCreate(PoseBase):
    muscles: Optional[List[PoseMuscleCreate]] = None


class PoseUpdate(BaseModel):
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_id: Optional[int] = None
    description: Optional[str] = Field(None, max_length=5000)
    effect: Optional[str] = Field(None, max_length=2000)
    breathing: Optional[str] = Field(None, max_length=2000)
    photo_path: Optional[str] = Field(None, max_length=500)
    muscle_layer_path: Optional[str] = Field(None, max_length=500)
    muscles: Optional[List[PoseMuscleCreate]] = None
    # For AI-analyzed muscles (accepts muscle names instead of IDs)
    analyzed_muscles: Optional[List[PoseMuscleCreateByName]] = None
    # Versioning: optional note describing what changed
    change_note: Optional[str] = Field(None, max_length=500)
    # Optimistic locking: client must send current version to update
    # If version doesn't match, update is rejected (concurrent edit detected)
    version: Optional[int] = Field(None, ge=1, description="Current version for optimistic locking")

    @field_validator("code", "name", mode="before")
    @classmethod
    def normalize_required_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("Field cannot be blank")
            return normalized
        return value

    @field_validator("name_en", "description", "effect", "breathing", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class PoseResponse(PoseBase):
    id: int
    schema_path: Optional[str] = None
    photo_path: Optional[str] = None
    muscle_layer_path: Optional[str] = None
    skeleton_layer_path: Optional[str] = None
    # Optimistic locking version - client must send this back on update
    version: int = 1
    created_at: datetime
    updated_at: datetime
    category_name: Optional[str] = None
    muscles: List[PoseMuscleResponse] = []

    class Config:
        from_attributes = True


class PoseListResponse(BaseModel):
    id: int
    code: str
    name: str
    name_en: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    schema_path: Optional[str] = None
    photo_path: Optional[str] = None

    class Config:
        from_attributes = True


class PaginatedPoseResponse(BaseModel):
    """Paginated response for poses list."""
    items: List[PoseListResponse]
    total: int = Field(..., ge=0, description="Total number of poses matching the query")
    skip: int = Field(..., ge=0, description="Number of items skipped")
    limit: int = Field(..., ge=1, description="Maximum items per page")
