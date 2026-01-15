from typing import Optional

from pydantic import BaseModel, Field


class MuscleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    name_ua: Optional[str] = Field(None, max_length=100)
    body_part: Optional[str] = Field(None, max_length=50)


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
