from typing import Optional

from pydantic import BaseModel, Field, field_validator


class MuscleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    name_ua: Optional[str] = Field(None, max_length=100)
    body_part: Optional[str] = Field(None, max_length=50)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("Name cannot be blank")
            return normalized
        return value

    @field_validator("name_ua", mode="before")
    @classmethod
    def normalize_name_ua(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @field_validator("body_part", mode="before")
    @classmethod
    def normalize_body_part(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip().lower()
            return normalized or None
        return value


class MuscleCreate(MuscleBase):
    pass


class MuscleResponse(MuscleBase):
    id: int

    class Config:
        from_attributes = True


class PoseMuscleResponse(BaseModel):
    muscle_id: int
    muscle_name: str
    muscle_name_ua: Optional[str] = None
    body_part: Optional[str] = None
    activation_level: int = Field(..., ge=0, le=100)

    class Config:
        from_attributes = True
