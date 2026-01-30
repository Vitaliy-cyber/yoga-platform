from enum import Enum
from typing import Optional, List

from pydantic import BaseModel, Field


class AnalyzedMuscleResponse(BaseModel):
    """Analyzed muscle with activation level"""
    name: str
    activation_level: int = Field(ge=0, le=100)


class LayerType(str, Enum):
    PHOTO = "photo"
    MUSCLES = "muscles"
    SKELETON = "skeleton"


class GenerateStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class GenerateRequest(BaseModel):
    """Запит на генерацію зображень"""

    pose_description: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="Текстовий опис пози (англійською для кращої якості)",
        examples=["warrior pose with arms raised", "tree pose standing on one leg"],
    )
    pose_id: Optional[int] = None


class GenerateResponse(BaseModel):
    """Відповідь з результатами генерації"""

    task_id: str
    status: GenerateStatus
    progress: int = Field(0, ge=0, le=100)
    status_message: Optional[str] = None
    error_message: Optional[str] = None
    # URLs - студійне фото та body paint м'язи
    photo_url: Optional[str] = None
    muscles_url: Optional[str] = None
    result_url: Optional[str] = None
    # Warning when placeholders are used due to quota
    quota_warning: bool = False
    # Analyzed muscles with activation levels
    analyzed_muscles: Optional[List[AnalyzedMuscleResponse]] = None
