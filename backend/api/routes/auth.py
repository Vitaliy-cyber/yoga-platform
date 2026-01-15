"""Authentication routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from models.user import User
from schemas.user import TokenResponse, UserLogin, UserResponse
from services.auth import create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(login_data: UserLogin, db: AsyncSession = Depends(get_db)):
    """
    Login with token.
    If user with this token doesn't exist, create a new one.
    Returns JWT access token.
    """
    # Check if user exists
    result = await db.execute(select(User).where(User.token == login_data.token))
    user = result.scalar_one_or_none()

    if user is None:
        # Create new user
        user = User(token=login_data.token)
        db.add(user)
        await db.flush()
        await db.refresh(user)

    # Update last login
    user.last_login = datetime.now(timezone.utc)
    await db.flush()

    # Create JWT token
    access_token = create_access_token(user.id)

    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user info."""
    return UserResponse.model_validate(current_user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    name: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user's name."""
    if name is not None:
        current_user.name = name
        await db.flush()
        await db.refresh(current_user)

    return UserResponse.model_validate(current_user)
