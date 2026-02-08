from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from .validators import (
    normalize_optional_text,
    normalize_required_text,
)


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return normalize_required_text(
            value,
            field_name="Name",
            strip_invisible=True,
        )

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value, strip_invisible=True)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        return normalize_required_text(
            value,
            field_name="Name",
            strip_invisible=True,
        )

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        return normalize_optional_text(value, strip_invisible=True)


class CategoryResponse(CategoryBase):
    id: int
    created_at: datetime
    pose_count: Optional[int] = None

    class Config:
        from_attributes = True
