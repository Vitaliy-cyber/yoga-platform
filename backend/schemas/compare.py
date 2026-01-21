"""Schemas for pose comparison feature."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from .muscle import PoseMuscleResponse


class PoseComparisonItem(BaseModel):
    """A pose item in the comparison result."""

    id: int
    name: str
    name_en: Optional[str] = None
    category_name: Optional[str] = None
    photo_path: Optional[str] = None
    muscle_layer_path: Optional[str] = None
    muscles: List[PoseMuscleResponse] = []

    class Config:
        from_attributes = True


class MuscleComparison(BaseModel):
    """Comparison of muscle activation across poses."""

    muscle_id: int
    muscle_name: str
    muscle_name_ua: Optional[str] = None
    body_part: Optional[str] = None
    activations: Dict[int, int] = Field(
        default_factory=dict,
        description="Mapping of pose_id to activation_level (0-100)",
    )

    @field_validator("activations")
    @classmethod
    def validate_activation_range(cls, v: Dict[int, int]) -> Dict[int, int]:
        """Ensure all activation values are within the valid range 0-100."""
        for pose_id, activation in v.items():
            if not isinstance(activation, int):
                raise ValueError(
                    f"Activation level for pose {pose_id} must be an integer, got {type(activation).__name__}"
                )
            if activation < 0 or activation > 100:
                raise ValueError(
                    f"Activation level for pose {pose_id} must be between 0 and 100, got {activation}"
                )
        return v


class ComparisonResult(BaseModel):
    """Complete comparison result for multiple poses."""

    poses: List[PoseComparisonItem]
    muscle_comparison: List[MuscleComparison]
    common_muscles: List[str] = Field(
        default_factory=list,
        description="Muscle names that are active in all compared poses",
    )
    unique_muscles: Dict[int, List[str]] = Field(
        default_factory=dict,
        description="Mapping of pose_id to list of muscles unique to that pose",
    )
