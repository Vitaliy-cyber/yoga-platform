from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class UserLogin(BaseModel):
    """Login request - just a token"""

    token: str = Field(..., min_length=1, max_length=100)

    @field_validator("token", mode="before")
    @classmethod
    def normalize_token(cls, value: str) -> str:
        if isinstance(value, str):
            return value.strip()
        return value


class UserResponse(BaseModel):
    """User info response"""

    id: int
    # Note: token is not returned - user already knows their own token
    # and we only store token_hash in the database for security
    name: Optional[str] = None
    created_at: datetime
    last_login: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """User update request"""

    name: Optional[str] = Field(default=None, max_length=200)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class TokenResponse(BaseModel):
    """JWT token response"""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse
