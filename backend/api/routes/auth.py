"""Authentication routes with JWT token management and refresh token rotation."""

import asyncio
import ipaddress
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

import services.auth as auth_service
from config import get_settings
from db.database import get_db
from models.auth_audit import AuthAuditLog
from models.user import User, hash_user_token
from schemas.user import TokenResponse, UserLogin, UserResponse, UserUpdate
from services.auth import (
    AuditService,
    TokenService,
    blacklist_token,
    create_access_token,
    generate_csrf_token,
    get_client_info,
    get_current_user,
    get_optional_user,
    is_token_blacklisted,
    verify_csrf_token,
)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
AUTH_COOKIE_MAX_AGE = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


# Background task for periodic token cleanup
_cleanup_task: Optional[asyncio.Task] = None
CLEANUP_INTERVAL_SECONDS = 3600  # Run cleanup every hour


async def _periodic_token_cleanup():
    """Background task to periodically clean up expired tokens."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            # Import here to avoid circular imports
            from db.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
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
        logger.debug("Started periodic token cleanup task")


def stop_cleanup_task():
    """Stop the periodic token cleanup background task."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        logger.debug("Stopped periodic token cleanup task")


def _extract_bearer_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization") or ""
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return None


def _is_trusted_proxy_request(request: Request) -> bool:
    """Return True when request comes from a configured trusted proxy."""
    if not settings.TRUSTED_PROXIES or not request.client:
        return False

    proxy_strings = [p.strip() for p in settings.TRUSTED_PROXIES.split(",") if p.strip()]
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for proxy in proxy_strings:
        try:
            networks.append(ipaddress.ip_network(proxy, strict=False))
        except ValueError:
            logger.warning("Invalid TRUSTED_PROXIES network: %s", proxy)

    if not networks:
        return False

    try:
        direct_ip = ipaddress.ip_address(request.client.host)
    except ValueError:
        return False

    return any(direct_ip in network for network in networks)


def _effective_request_scheme_host(request: Request) -> tuple[str, str]:
    """
    Return best-effort (scheme, host) for the current request.

    Uses X-Forwarded-* only when the direct client is in TRUSTED_PROXIES.
    """
    scheme = request.url.scheme.lower()
    host = (request.url.hostname or "").lower()

    if not host:
        host_header = request.headers.get("host", "")
        host = host_header.split(":", 1)[0].strip().lower()

    if _is_trusted_proxy_request(request):
        forwarded_proto = request.headers.get("x-forwarded-proto")
        if forwarded_proto:
            proto = forwarded_proto.split(",", 1)[0].strip().lower()
            if proto in {"http", "https"}:
                scheme = proto

        forwarded_host = request.headers.get("x-forwarded-host")
        if forwarded_host:
            candidate = forwarded_host.split(",", 1)[0].strip()
            parsed = urllib.parse.urlparse(f"//{candidate}")
            if parsed.hostname:
                host = parsed.hostname.lower()

    return scheme, host


def _is_cross_site_cookie_context(request: Request) -> bool:
    """
    Detect whether cookie context is cross-site.

    Priority:
    1) `Sec-Fetch-Site: cross-site` (browser-provided signal)
    2) Compare `Origin` with effective request scheme/host.
    """
    fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
    if fetch_site == "cross-site":
        return True
    if fetch_site in {"same-site", "same-origin"}:
        return False

    origin = (request.headers.get("origin") or "").strip()
    if not origin:
        return False

    parsed_origin = urllib.parse.urlparse(origin)
    if not parsed_origin.scheme or not parsed_origin.hostname:
        return False

    req_scheme, req_host = _effective_request_scheme_host(request)
    return (
        parsed_origin.scheme.lower() != req_scheme.lower()
        or parsed_origin.hostname.lower() != req_host.lower()
    )


def _cookie_security_params(request: Request) -> tuple[bool, str, str]:
    """
    Return (secure, refresh_samesite, csrf_samesite) for auth cookies.
    """
    # Production deployments often run frontend and API on different hosts.
    # To keep refresh/csrf cookies usable in those cross-site browser contexts,
    # enforce `SameSite=None; Secure` in prod.
    if settings.APP_MODE.value == "prod":
        return True, "none", "none"

    request_scheme, _ = _effective_request_scheme_host(request)
    is_cross_site = _is_cross_site_cookie_context(request)
    secure = (
        settings.APP_MODE.value == "prod"
        or request_scheme == "https"
        or is_cross_site
    )
    if is_cross_site:
        return secure, "none", "none"
    return secure, "lax", "strict"


def _delete_cookie_with_policy(
    response: Response,
    *,
    key: str,
    path: str,
    secure: bool,
    samesite: str,
) -> None:
    response.delete_cookie(
        key=key,
        path=path,
        secure=secure,
        samesite=samesite,
    )


def _clear_auth_cookies(response: Response, request: Request) -> None:
    secure_cookie, refresh_samesite, csrf_samesite = _cookie_security_params(request)
    _delete_cookie_with_policy(
        response,
        key="refresh_token",
        path="/",
        secure=secure_cookie,
        samesite=refresh_samesite,
    )
    _delete_cookie_with_policy(
        response,
        key="refresh_token",
        path="/api",
        secure=secure_cookie,
        samesite=refresh_samesite,
    )
    _delete_cookie_with_policy(
        response,
        key="csrf_token",
        path="/",
        secure=secure_cookie,
        samesite=csrf_samesite,
    )


async def _get_valid_bearer_user_id(request: Request, db: AsyncSession) -> Optional[int]:
    token = _extract_bearer_token(request)
    if not token:
        return None
    payload = auth_service.decode_token(token, expected_type="access")
    if payload is None:
        return None
    jti = payload.get("jti")
    if jti and await is_token_blacklisted(db, jti, log_attempt=False):
        return None
    user_id = payload.get("sub")
    if user_id is None:
        return None
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        return None
    result = await db.execute(select(User.id).where(User.id == user_id_int))
    return user_id_int if result.scalar_one_or_none() is not None else None



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
    import random

    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # SQLite can surface transient OperationalError (busy/locked) under heavy atomic stress.
    # Retry the whole login flow a few times so E2E can keep pushing without random 5xx.
    max_attempts = 6
    last_error: Exception | None = None

    for attempt in range(max_attempts):
        try:
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

            # Commit all changes (user, refresh token, audit log)
            await db.commit()

            # Only mutate cookies after successful commit so we never hand out a refresh token
            # that was rolled back.
            secure_cookie, refresh_samesite, csrf_samesite = _cookie_security_params(request)
            _delete_cookie_with_policy(
                response,
                key="refresh_token",
                path="/api",
                secure=secure_cookie,
                samesite=refresh_samesite,
            )
            response.set_cookie(
                key="refresh_token",
                value=tokens.refresh_token,
                httponly=True,
                secure=secure_cookie,
                samesite=refresh_samesite,
                max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
                path="/",
            )

            csrf_token = generate_csrf_token(user.id)
            response.set_cookie(
                key="csrf_token",
                value=csrf_token,
                httponly=False,  # JavaScript needs to read this
                secure=secure_cookie,
                samesite=csrf_samesite,
                max_age=AUTH_COOKIE_MAX_AGE,
                path="/",
            )

            setattr(user, "token", login_data.token)

            return TokenPairResponse(
                access_token=tokens.access_token,
                refresh_token=tokens.refresh_token,
                expires_in=settings.effective_access_token_expire_minutes * 60,
                user=UserResponse.model_validate(user),
            )
        except (IntegrityError, OperationalError) as e:
            last_error = e
            await db.rollback()
            if attempt < max_attempts - 1:
                base = min(0.05 * (2**attempt), 0.5)
                await asyncio.sleep(base + random.uniform(0, 0.05))
                continue
            break

    # Never leak raw DB error text.
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Conflict while logging in. Please retry.",
    ) from last_error


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
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    try:
        body_refresh_token = body.refresh_token if body and body.refresh_token else None

        bearer_user_id = await _get_valid_bearer_user_id(request, db)
        csrf_header = request.headers.get("X-CSRF-Token")
        refresh_user_id: Optional[int] = None
        cookie_invalid = False
        if refresh_token_cookie:
            payload = auth_service.decode_token(refresh_token_cookie, expected_type="refresh")
            if payload is None:
                cookie_invalid = True
            elif payload.get("sub") is not None:
                try:
                    refresh_user_id = int(payload["sub"])
                except (TypeError, ValueError):
                    refresh_user_id = None
        bearer_matches_refresh = (
            bearer_user_id is not None
            and refresh_user_id is not None
            and bearer_user_id == refresh_user_id
        )
        csrf_ok = False
        if csrf_header and refresh_user_id is not None:
            csrf_ok = verify_csrf_token(csrf_header, refresh_user_id)

        # If a body refresh token is present, ignore a revoked/expired cookie so API clients
        # are not blocked by stale cookies.
        if refresh_token_cookie and body_refresh_token and not cookie_invalid:
            import hashlib
            from models.refresh_token import RefreshToken

            token_hash = hashlib.sha256(refresh_token_cookie.encode()).hexdigest()
            result = await db.execute(
                select(RefreshToken.id).where(
                    and_(
                        RefreshToken.token_hash == token_hash,
                        RefreshToken.is_revoked == False,
                        RefreshToken.expires_at > datetime.now(timezone.utc),
                    )
                )
            )
            if result.scalar_one_or_none() is None:
                cookie_invalid = True

        # Token source selection:
        # - Cookie-based refresh is the browser flow and requires CSRF
        #   (unless a valid Bearer for the SAME user is present).
        # - Body-based refresh is the API-client flow and does not require CSRF.
        #
        # SECURITY/UX: If a refresh cookie exists but the request does NOT include X-CSRF-Token,
        # and a body refresh token is provided, treat it as body-based to avoid forcing CSRF for
        # non-browser API clients that happen to carry cookies (e.g., Playwright APIRequestContext).
        using_cookie = (
            refresh_token_cookie is not None
            and not cookie_invalid
            and (bearer_matches_refresh or csrf_ok or body_refresh_token is None)
        )

        refresh_token = refresh_token_cookie if using_cookie else body_refresh_token

        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Refresh token is required",
            )

        # SECURITY: cookie-based refresh is a browser flow and always requires
        # CSRF unless a valid bearer for the *same* user is present.
        requires_csrf = (
            using_cookie
            and refresh_token_cookie is not None
            and not bearer_matches_refresh
        )
        if requires_csrf:
            if not csrf_header:
                logger.warning(
                    "Refresh forbidden: missing CSRF header (cookie_refresh=%s body_refresh=%s cookie_invalid=%s bearer_match=%s ip=%s)",
                    bool(refresh_token_cookie),
                    bool(body_refresh_token),
                    bool(cookie_invalid),
                    bool(bearer_matches_refresh),
                    ip_address,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="CSRF token missing. Include X-CSRF-Token header.",
                )
            payload = auth_service.decode_token(refresh_token, expected_type="refresh")
            if payload is None or payload.get("sub") is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired refresh token",
                )
            try:
                refresh_user_id = int(payload["sub"])
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired refresh token",
                )
            if not verify_csrf_token(csrf_header, refresh_user_id):
                logger.warning(
                    "Refresh forbidden: invalid CSRF token (user_id=%s cookie_refresh=%s body_refresh=%s cookie_invalid=%s bearer_match=%s ip=%s)",
                    refresh_user_id,
                    bool(refresh_token_cookie),
                    bool(body_refresh_token),
                    bool(cookie_invalid),
                    bool(bearer_matches_refresh),
                    ip_address,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid CSRF token",
                )

        # Refresh tokens (with rotation)
        tokens = await token_service.refresh_tokens(
            refresh_token=refresh_token,
            device_info=user_agent,
            ip_address=ip_address,
        )

        # Get user for response
        payload = auth_service.decode_token(tokens.access_token, expected_type="access")
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

        # Commit all changes (old token revocation, new token, audit log)
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("Failed to commit refresh token rotation")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to refresh token",
            )

        secure_cookie, refresh_samesite, csrf_samesite = _cookie_security_params(request)
        # Clear legacy cookie path to avoid duplicate refresh_token cookies (path=/api vs path=/)
        _delete_cookie_with_policy(
            response,
            key="refresh_token",
            path="/api",
            secure=secure_cookie,
            samesite=refresh_samesite,
        )

        # Update refresh token cookie
        response.set_cookie(
            key="refresh_token",
            value=tokens.refresh_token,
            httponly=True,
            secure=secure_cookie,
            samesite=refresh_samesite,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            path="/",
        )

        # Regenerate CSRF token on refresh
        csrf_token = generate_csrf_token(user.id)
        response.set_cookie(
            key="csrf_token",
            value=csrf_token,
            httponly=False,
            secure=secure_cookie,
            samesite=csrf_samesite,
            max_age=AUTH_COOKIE_MAX_AGE,
            path="/",
        )

        return TokenPairResponse(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_in=settings.effective_access_token_expire_minutes * 60,
            user=UserResponse.model_validate(user),
        )

    except HTTPException as exc:
        if exc.status_code in {status.HTTP_400_BAD_REQUEST, status.HTTP_401_UNAUTHORIZED}:
            error_response = JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
            )
            _clear_auth_cookies(error_response, request)
            return error_response
        raise
    except Exception as e:
        # Log failed refresh attempt in a clean transaction
        await db.rollback()
        try:
            await audit.log(
                action=AuthAuditLog.ACTION_TOKEN_REFRESH,
                ip_address=ip_address,
                user_agent=user_agent,
                success=False,
                error_message=str(e),
            )
            await db.commit()
        except Exception:
            await db.rollback()
        error_response = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Failed to refresh token"},
        )
        _clear_auth_cookies(error_response, request)
        return error_response


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    body: Optional[LogoutRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout current session.

    Revokes the current refresh token (if present) and clears cookies.
    Access token is optional to allow logout even when access token is expired.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Get refresh token from cookie or body (prefer cookie when both present)
    body_refresh_token = body.refresh_token if body else None
    refresh_token = refresh_token_cookie or body_refresh_token

    user_id: Optional[int] = current_user.id if current_user else None

    refresh_token_user_id: Optional[int] = None
    cookie_ignored = False
    if refresh_token:
        payload = auth_service.decode_token(refresh_token, expected_type="refresh")
        if payload and payload.get("sub") is not None:
            try:
                refresh_token_user_id = int(payload["sub"])
            except (TypeError, ValueError):
                refresh_token_user_id = None
        elif refresh_token_cookie and body_refresh_token:
            # Cookie refresh token is invalid; allow body token path for authenticated users.
            cookie_ignored = True
            refresh_token = None
    body_token_user_id: Optional[int] = None
    if body_refresh_token:
        payload = auth_service.decode_token(body_refresh_token, expected_type="refresh")
        if payload and payload.get("sub") is not None:
            try:
                body_token_user_id = int(payload["sub"])
            except (TypeError, ValueError):
                body_token_user_id = None

    # If cookie is present but CSRF is missing, allow body-token logout for API clients.
    csrf_header = request.headers.get("X-CSRF-Token")
    if current_user is None and refresh_token_cookie and body_refresh_token and not csrf_header:
        cookie_ignored = True
        refresh_token = body_refresh_token
        refresh_token_user_id = body_token_user_id

    # If cookie is present but already revoked/expired, allow body fallback.
    if refresh_token_cookie and body_refresh_token and not cookie_ignored:
        import hashlib
        from models.refresh_token import RefreshToken

        token_hash = hashlib.sha256(refresh_token_cookie.encode()).hexdigest()
        result = await db.execute(
            select(RefreshToken.id).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
            )
        )
        if result.scalar_one_or_none() is None:
            cookie_ignored = True
            refresh_token = None

    requires_csrf = refresh_token_cookie is not None and current_user is None and not cookie_ignored

    if requires_csrf and refresh_token_user_id is not None:
        if not csrf_header:
            if body_refresh_token:
                cookie_ignored = True
                refresh_token = body_refresh_token
                refresh_token_user_id = body_token_user_id
                requires_csrf = False
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="CSRF token missing. Include X-CSRF-Token header.",
                )
        else:
            if not verify_csrf_token(csrf_header, refresh_token_user_id):
                if body_refresh_token:
                    cookie_ignored = True
                    refresh_token = body_refresh_token
                    refresh_token_user_id = body_token_user_id
                    requires_csrf = False
                else:
                    logger.warning(
                        f"CSRF token verification failed for user {refresh_token_user_id}"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Invalid CSRF token",
                    )

    # If we don't have a user yet, try to derive from refresh token (if provided)
    if user_id is None:
        if not cookie_ignored and refresh_token_user_id is not None:
            user_id = refresh_token_user_id
        elif body_token_user_id is not None:
            user_id = body_token_user_id

    # If we DO have a user, ensure the provided refresh token (if any) belongs to the same user.
    # Never allow a logout call to revoke another user's refresh token (even if passed in body).
    if (
        not cookie_ignored
        and user_id is not None
        and refresh_token_user_id is not None
        and refresh_token_user_id != user_id
    ):
        logger.warning(
            "Logout refresh token user mismatch",
            extra={"access_user_id": user_id, "refresh_user_id": refresh_token_user_id},
        )
        cookie_ignored = True
        refresh_token = None
    if user_id is not None and body_token_user_id is not None and body_token_user_id != user_id:
        logger.warning(
            "Logout body refresh token user mismatch",
            extra={"access_user_id": user_id, "refresh_user_id": body_token_user_id},
        )
        body_refresh_token = None

    # Blacklist the current access token so logout is immediate server-side.
    # This prevents "logged out but token still works" behavior.
    try:
        raw_access_token = _extract_bearer_token(request)
        if raw_access_token:
            payload = auth_service.decode_token(raw_access_token, expected_type="access")
            if payload:
                jti = payload.get("jti")
                exp = payload.get("exp")
                if user_id is None and payload.get("sub") is not None:
                    try:
                        user_id = int(payload["sub"])
                    except (TypeError, ValueError):
                        user_id = None
                if jti and exp:
                    expires_at = datetime.fromtimestamp(int(exp), tz=timezone.utc)
                    await blacklist_token(
                        db,
                        jti=jti,
                        user_id=user_id,
                        token_type="access",
                        expires_at=expires_at,
                        reason="logout",
                    )
    except Exception:
        logger.exception("Failed to blacklist access token during logout")

    revoked = False
    if refresh_token:
        # Revoke the refresh token
        revoked = await token_service.revoke_token(refresh_token, reason="logout")
    # SECURITY: Do not revoke additional refresh tokens from the body when a cookie is present,
    # and never revoke a token that was determined to belong to another user.
    if not revoked and body_refresh_token and (refresh_token_cookie is None or cookie_ignored):
        # When there is no authenticated user, and no cookie was provided, allow best-effort
        # logout based on the body token (if it decoded to a user id).
        revoked = await token_service.revoke_token(body_refresh_token, reason="logout")
        if body_token_user_id is not None:
            user_id = body_token_user_id

    # Log the logout
    await audit.log(
        action=AuthAuditLog.ACTION_LOGOUT,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    # Clear cookies with the same policy as we use for issuing them.
    _clear_auth_cookies(response, request)

    await db.commit()
    return {"message": "Successfully logged out"}


@router.post("/logout-all")
async def logout_all(
    request: Request,
    response: Response,
    body: Optional[LogoutRequest] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout from all sessions.

    Revokes all refresh tokens for the current user.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Prefer refresh token cookie over body (if provided)
    refresh_token = None
    body_refresh_token = body.refresh_token if body else None
    cookie_invalid = False

    user_id: Optional[int] = current_user.id if current_user else None

    refresh_token_user_id: Optional[int] = None
    if refresh_token_cookie:
        refresh_token = refresh_token_cookie
    elif body_refresh_token:
        refresh_token = body_refresh_token

    # If cookie is present but CSRF is missing, allow body-token logout-all for API clients.
    csrf_header = request.headers.get("X-CSRF-Token")
    if current_user is None and refresh_token_cookie and body_refresh_token and not csrf_header:
        cookie_invalid = True
        refresh_token = body_refresh_token

    def _decode_refresh_user_id(token: Optional[str]) -> Optional[int]:
        if not token:
            return None
        payload = auth_service.decode_token(token, expected_type="refresh")
        if payload and payload.get("sub") is not None:
            try:
                return int(payload["sub"])
            except (TypeError, ValueError):
                return None
        return None

    async def _lookup_valid_refresh_user_id(token: str) -> Optional[int]:
        import hashlib
        from models.refresh_token import RefreshToken

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        result = await db.execute(
            select(RefreshToken.user_id).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
            )
        )
        return result.scalar_one_or_none()

    # If we don't have a user yet, only accept a refresh token that is still valid in DB.
    if user_id is None and refresh_token:
        refresh_token_user_id = _decode_refresh_user_id(refresh_token)
        stored_user_id = await _lookup_valid_refresh_user_id(refresh_token)
        if stored_user_id is None and refresh_token_cookie and body_refresh_token:
            # Cookie is invalid/revoked; fall back to body token if present.
            cookie_invalid = True
            refresh_token = body_refresh_token
            refresh_token_user_id = _decode_refresh_user_id(body_refresh_token)
            stored_user_id = await _lookup_valid_refresh_user_id(body_refresh_token)
        if stored_user_id is None:
            error_response = JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
            _clear_auth_cookies(error_response, request)
            return error_response
        if refresh_token_user_id is not None and refresh_token_user_id != stored_user_id:
            logger.warning(
                "Logout-all refresh token user mismatch",
                extra={"refresh_user_id": refresh_token_user_id, "stored_user_id": stored_user_id},
            )
        user_id = stored_user_id

    requires_csrf = refresh_token_cookie is not None and current_user is None and not cookie_invalid

    if user_id is None:
        error_response = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"},
        )
        _clear_auth_cookies(error_response, request)
        return error_response

    if requires_csrf:
        csrf_header = request.headers.get("X-CSRF-Token")
        if not csrf_header:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF token missing. Include X-CSRF-Token header.",
            )
        if not verify_csrf_token(csrf_header, user_id):
            if body_refresh_token:
                cookie_invalid = True
                refresh_token = body_refresh_token
                refresh_token_user_id = _decode_refresh_user_id(body_refresh_token)
                stored_user_id = await _lookup_valid_refresh_user_id(body_refresh_token)
                if stored_user_id is None:
                    error_response = JSONResponse(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        content={"detail": "Not authenticated"},
                    )
                    _clear_auth_cookies(error_response, request)
                    return error_response
                user_id = stored_user_id
                requires_csrf = False
            else:
                logger.warning(f"CSRF token verification failed for user {user_id}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid CSRF token",
                )

    # Blacklist the current access token so logout-all is immediate server-side.
    try:
        raw_access_token = _extract_bearer_token(request)
        if raw_access_token:
            payload = auth_service.decode_token(raw_access_token, expected_type="access")
            if payload:
                jti = payload.get("jti")
                exp = payload.get("exp")
                if user_id is None and payload.get("sub") is not None:
                    try:
                        user_id = int(payload["sub"])
                    except (TypeError, ValueError):
                        user_id = None
                if jti and exp:
                    expires_at = datetime.fromtimestamp(int(exp), tz=timezone.utc)
                    await blacklist_token(
                        db,
                        jti=jti,
                        user_id=user_id,
                        token_type="access",
                        expires_at=expires_at,
                        reason="logout_all",
                    )
    except Exception:
        logger.exception("Failed to blacklist access token during logout-all")

    # Revoke all user's refresh tokens (if we know the user)
    count = 0
    if user_id is not None:
        count = await token_service.revoke_all_user_tokens(user_id, reason="logout_all")

    # Log the logout
    await audit.log(
        action=AuthAuditLog.ACTION_LOGOUT_ALL,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata={"sessions_revoked": count},
    )

    # Clear cookies with the same policy as we use for issuing them.
    _clear_auth_cookies(response, request)

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

    # Determine current session by comparing token hashes (if refresh cookie is present)
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
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke a specific session (refresh token) by ID.

    Cannot revoke the current session - use /logout for that.
    """
    ip_address, user_agent = get_client_info(request)
    audit = AuditService(db)
    token_service = TokenService(db)

    # Prevent revoking the current session (use /logout instead).
    if not refresh_token_cookie:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refresh token cookie required to revoke sessions",
        )

    current_token_hash = None
    if refresh_token_cookie:
        import hashlib
        current_token_hash = hashlib.sha256(refresh_token_cookie.encode()).hexdigest()

    from models.refresh_token import RefreshToken
    current_session = None
    if current_token_hash:
        result = await db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == current_user.id,
                    RefreshToken.token_hash == current_token_hash,
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
            )
        )
        current_session = result.scalar_one_or_none()
    if current_session is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refresh token cookie required to revoke sessions",
        )

    result = await db.execute(
        select(RefreshToken).where(
            and_(
                RefreshToken.id == session_id,
                RefreshToken.user_id == current_user.id,
                RefreshToken.is_revoked == False,
            )
        )
    )
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or already revoked",
        )

    if current_session and session.id == current_session.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot revoke current session. Use /logout instead.",
        )

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
async def get_me(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    """Get current authenticated user info."""
    csrf_cookie = request.cookies.get("csrf_token")
    csrf_valid = bool(csrf_cookie and verify_csrf_token(csrf_cookie, current_user.id))
    if not csrf_valid:
        secure_cookie, _, csrf_samesite = _cookie_security_params(request)
        csrf_token = generate_csrf_token(current_user.id)
        response.set_cookie(
            key="csrf_token",
            value=csrf_token,
            httponly=False,
            secure=secure_cookie,
            samesite=csrf_samesite,
            max_age=AUTH_COOKIE_MAX_AGE,
            path="/",
        )
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
