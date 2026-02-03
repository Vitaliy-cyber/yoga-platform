"""Authentication routes with JWT token management and refresh token rotation."""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import get_db
from models.auth_audit import AuthAuditLog
from models.user import User, hash_user_token
from schemas.user import TokenResponse, UserLogin, UserResponse, UserUpdate
from services.auth import (
    AuditService,
    TokenService,
    create_access_token,
    generate_csrf_token,
    get_client_info,
    get_current_user,
    verify_csrf_token,
)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


# Background task for periodic token cleanup
_cleanup_task: Optional[asyncio.Task] = None
CLEANUP_INTERVAL_SECONDS = 3600  # Run cleanup every hour


async def _periodic_token_cleanup():
    """Background task to periodically clean up expired tokens."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            # Import here to avoid circular imports
            from db.database import async_session_maker
            async with async_session_maker() as db:
                token_service = TokenService(db)
                refresh_count, blacklist_count = await token_service.cleanup_expired_tokens()
                await db.commit()
                if refresh_count > 0 or blacklist_count > 0:
                    logger.info(
                        f"Token cleanup completed: {refresh_count} expired refresh tokens, "
                        f"{blacklist_count} expired blacklist entries removed"
                    )
        except asyncio.CancelledError:
            logger.info("Token cleanup task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in token cleanup task: {e}")
            # Continue running despite errors


def start_cleanup_task():
    """Start the periodic token cleanup background task."""
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_periodic_token_cleanup())
        logger.info("Started periodic token cleanup task")


def stop_cleanup_task():
    """Stop the periodic token cleanup background task."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        logger.info("Stopped periodic token cleanup task")



async def verify_csrf(
    request: Request,
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Dependency to verify CSRF token for state-changing operations.

    Implements Double-Submit Cookie pattern:
    - CSRF token is sent in a cookie on login
    - Client must include the token in X-CSRF-Token header for state-changing requests
    - We verify the header token matches what we issued

    SECURITY: This prevents CSRF attacks where a malicious site tries to make
    authenticated requests on behalf of the user.
    """
    if not x_csrf_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing. Include X-CSRF-Token header.",
        )

    if not verify_csrf_token(x_csrf_token, current_user.id):
        logger.warning(f"CSRF token verification failed for user {current_user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid CSRF token",
        )

    return current_user


# === Pydantic Schemas for new endpoints ===


class TokenPairResponse(BaseModel):
    """Response containing both access and refresh tokens."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token expiration in seconds")
    user: UserResponse


class RefreshTokenRequest(BaseModel):
    """Request body for token refresh (optional - can also use httpOnly cookie)."""

    refresh_token: Optional[str] = None


class LogoutRequest(BaseModel):
    """Request body for logout with refresh token."""

    refresh_token: Optional[str] = None


class SessionResponse(BaseModel):
    """Response for a single session."""

    id: int
    device_info: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    last_used_at: Optional[datetime] = None
    is_current: bool = False

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    """Response for session list."""

    sessions: List[SessionResponse]
    total: int


# === Auth Endpoints ===


@router.post("/login", response_model=TokenPairResponse)
async def login(
    login_data: UserLogin,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Login with token.

    If user with this token doesn't exist, create a new one.
    Returns JWT access token and refresh token.
    The refresh token is also set as an httpOnly cookie.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Check if user exists by hashed token
    token_hash = hash_user_token(login_data.token)
    result = await db.execute(select(User).where(User.token_hash == token_hash))
    user = result.scalar_one_or_none()

    is_new_user = user is None
    if is_new_user:
        # Create new user with hashed token
        user = User.create_with_token(login_data.token)
        db.add(user)
        await db.flush()
        await db.refresh(user)

    # Update last login
    user.last_login = datetime.now(timezone.utc)
    await db.flush()

    # Create token pair
    tokens = await token_service.create_tokens(
        user_id=user.id,
        device_info=user_agent,
        ip_address=ip_address,
        user_token=login_data.token,
    )

    # Log the login
    await audit.log(
        action=AuthAuditLog.ACTION_LOGIN,
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata={"is_new_user": is_new_user},
    )

    # Clear legacy cookie path to avoid duplicate refresh_token cookies (path=/api vs path=/)
    response.delete_cookie(key="refresh_token", path="/api")

    # Set refresh token as httpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=tokens.refresh_token,
        httponly=True,
        secure=settings.APP_MODE.value == "prod",  # HTTPS only in production
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/",
    )

    # Generate and set CSRF token for Double-Submit Cookie pattern
    csrf_token = generate_csrf_token(user.id)
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,  # JavaScript needs to read this
        secure=settings.APP_MODE.value == "prod",
        samesite="strict",  # Strict for CSRF token
        max_age=3600,  # 1 hour
        path="/",
    )

    # Commit all changes (user, refresh token, audit log)
    await db.commit()

    setattr(user, "token", login_data.token)

    return TokenPairResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=settings.effective_access_token_expire_minutes * 60,
        user=UserResponse.model_validate(user),
    )


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh_tokens(
    request: Request,
    response: Response,
    body: Optional[RefreshTokenRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh access token using refresh token.

    The refresh token can be provided either:
    - In the request body (for mobile/SPA apps)
    - As an httpOnly cookie (more secure for web apps)

    Implements token rotation: the old refresh token is invalidated
    and a new one is issued.
    """
    # Get refresh token from body or cookie
    refresh_token = None
    if body and body.refresh_token:
        refresh_token = body.refresh_token
    elif refresh_token_cookie:
        refresh_token = refresh_token_cookie

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refresh token is required",
        )

    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    try:
        # Refresh tokens (with rotation)
        tokens = await token_service.refresh_tokens(
            refresh_token=refresh_token,
            device_info=user_agent,
            ip_address=ip_address,
        )

        # Get user for response
        from services.auth import decode_token
        payload = decode_token(tokens.access_token, expected_type="access")
        user_id = int(payload["sub"])
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        # Log the refresh
        await audit.log(
            action=AuthAuditLog.ACTION_TOKEN_REFRESH,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        # Clear legacy cookie path to avoid duplicate refresh_token cookies (path=/api vs path=/)
        response.delete_cookie(key="refresh_token", path="/api")

        # Update refresh token cookie
        response.set_cookie(
            key="refresh_token",
            value=tokens.refresh_token,
            httponly=True,
            secure=settings.APP_MODE.value == "prod",
            samesite="lax",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            path="/",
        )

        # Regenerate CSRF token on refresh
        csrf_token = generate_csrf_token(user.id)
        response.set_cookie(
            key="csrf_token",
            value=csrf_token,
            httponly=False,
            secure=settings.APP_MODE.value == "prod",
            samesite="strict",
            max_age=3600,
            path="/",
        )

        # Commit all changes (old token revocation, new token, audit log)
        await db.commit()

        return TokenPairResponse(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_in=settings.effective_access_token_expire_minutes * 60,
            user=UserResponse.model_validate(user),
        )

    except HTTPException:
        raise
    except Exception as e:
        # Log failed refresh attempt
        await audit.log(
            action=AuthAuditLog.ACTION_TOKEN_REFRESH,
            ip_address=ip_address,
            user_agent=user_agent,
            success=False,
            error_message=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to refresh token",
        )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    body: Optional[LogoutRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout current session.

    Revokes the current refresh token and clears the cookie.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Get refresh token from body or cookie
    refresh_token = None
    if body and body.refresh_token:
        refresh_token = body.refresh_token
    elif refresh_token_cookie:
        refresh_token = refresh_token_cookie

    if refresh_token:
        # Revoke the refresh token
        await token_service.revoke_token(refresh_token, reason="logout")

    # Log the logout
    await audit.log(
        action=AuthAuditLog.ACTION_LOGOUT,
        user_id=current_user.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    # Clear the cookies
    response.delete_cookie(
        key="refresh_token",
        path="/",
    )
    response.delete_cookie(
        key="refresh_token",
        path="/api",
    )
    response.delete_cookie(
        key="csrf_token",
        path="/",
    )

    await db.commit()
    return {"message": "Successfully logged out"}


@router.post("/logout-all")
async def logout_all(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout from all sessions.

    Revokes all refresh tokens for the current user.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Revoke all user's refresh tokens
    count = await token_service.revoke_all_user_tokens(current_user.id, reason="logout_all")

    # Log the logout
    await audit.log(
        action=AuthAuditLog.ACTION_LOGOUT_ALL,
        user_id=current_user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata={"sessions_revoked": count},
    )

    # Clear the cookies
    response.delete_cookie(
        key="refresh_token",
        path="/",
    )
    response.delete_cookie(
        key="refresh_token",
        path="/api",
    )
    response.delete_cookie(
        key="csrf_token",
        path="/",
    )

    await db.commit()
    return {"message": f"Successfully logged out from all {count} sessions"}


@router.get("/sessions", response_model=SessionListResponse)
async def get_sessions(
    current_user: User = Depends(get_current_user),
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get list of active sessions for the current user.

    Each session represents a device/browser with an active refresh token.
    """
    token_service = TokenService(db)
    sessions = await token_service.get_user_sessions(current_user.id)

    # Determine current session by comparing token hashes
    current_token_hash = None
    if refresh_token_cookie:
        import hashlib
        current_token_hash = hashlib.sha256(refresh_token_cookie.encode()).hexdigest()

    session_responses = []
    for session in sessions:
        session_responses.append(
            SessionResponse(
                id=session.id,
                device_info=session.device_info,
                ip_address=session.ip_address,
                created_at=session.created_at,
                last_used_at=session.last_used_at,
                is_current=session.token_hash == current_token_hash,
            )
        )

    return SessionListResponse(
        sessions=session_responses,
        total=len(session_responses),
    )


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke a specific session (refresh token) by ID.

    Cannot revoke the current session - use /logout for that.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    success = await token_service.revoke_session(
        user_id=current_user.id,
        session_id=session_id,
        reason="manual_revoke",
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or already revoked",
        )

    # Log the session revocation
    await audit.log(
        action=AuthAuditLog.ACTION_SESSION_REVOKE,
        user_id=current_user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata={"session_id": session_id},
    )

    await db.commit()
    return {"message": "Session revoked successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user info."""
    return UserResponse.model_validate(current_user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user's name."""
    if update_data.name is not None:
        current_user.name = update_data.name
        await db.flush()
        await db.refresh(current_user)
        await db.commit()

    return UserResponse.model_validate(current_user)
