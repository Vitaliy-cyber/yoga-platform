from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserLogin(BaseModel):
    """Login request - just a token"""

    token: str = Field(..., min_length=1, max_length=100)


class UserResponse(BaseModel):
    """User info response"""

    id: int
    token: str
    name: Optional[str] = None
    created_at: datetime
    last_login: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    """JWT token response"""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse
