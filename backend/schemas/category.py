from datetime import datetime
from typing import Optional
import unicodedata

from pydantic import BaseModel, Field, field_validator

from .validators import ensure_utf8_encodable


def _strip_invisible_edges(value: str) -> str:
    """
    Strip leading/trailing whitespace and Unicode format characters (Cf).

    This prevents visually-identical names like "\\u200bYoga" or "\\ufeffYoga"
    from bypassing uniqueness and confusing users.
    """
    if not isinstance(value, str):
        return value
    start = 0
    end = len(value)
    while start < end and (
        value[start].isspace() or unicodedata.category(value[start]) == "Cf"
    ):
        start += 1
    while end > start and (
        value[end - 1].isspace() or unicodedata.category(value[end - 1]) == "Cf"
    ):
        end -= 1
    return value[start:end]


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if isinstance(value, str):
            normalized = _strip_invisible_edges(value)
            if not normalized:
                raise ValueError("Name cannot be blank")
            return ensure_utf8_encodable(normalized)
        return value

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = _strip_invisible_edges(value)
            if not normalized:
                return None
            return ensure_utf8_encodable(normalized)
        return value


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = _strip_invisible_edges(value)
            if not normalized:
                raise ValueError("Name cannot be blank")
            return ensure_utf8_encodable(normalized)
        return value

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = _strip_invisible_edges(value)
            if not normalized:
                return None
            return ensure_utf8_encodable(normalized)
        return value


class CategoryResponse(CategoryBase):
    id: int
    created_at: datetime
    pose_count: Optional[int] = None

    class Config:
        from_attributes = True
