from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from .muscle import PoseMuscleResponse


class PoseMuscleCreate(BaseModel):
    muscle_id: int
    activation_level: int = Field(..., ge=0, le=100)


class PoseBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_id: Optional[int] = None
    description: Optional[str] = None
    effect: Optional[str] = None
    breathing: Optional[str] = None


class PoseCreate(PoseBase):
    muscles: Optional[List[PoseMuscleCreate]] = None


class PoseUpdate(BaseModel):
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    name_en: Optional[str] = Field(None, max_length=200)
    category_id: Optional[int] = None
    description: Optional[str] = None
    effect: Optional[str] = None
    breathing: Optional[str] = None
    schema_path: Optional[str] = None
    photo_path: Optional[str] = None
    muscle_layer_path: Optional[str] = None
    muscles: Optional[List[PoseMuscleCreate]] = None


class PoseResponse(PoseBase):
    id: int
    schema_path: Optional[str] = None
    photo_path: Optional[str] = None
    muscle_layer_path: Optional[str] = None
    skeleton_layer_path: Optional[str] = None
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
