"""Authentication service for JWT token management with refresh token rotation."""

import hashlib
import hmac
import json
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import and_, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import get_db
from models.auth_audit import AuthAuditLog
from models.refresh_token import RefreshToken
from models.token_blacklist import TokenBlacklist
from models.user import User

settings = get_settings()
security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


# CSRF token storage
# WARNING: This in-memory storage will NOT work correctly in multi-process deployments
# (e.g., gunicorn with multiple workers, kubernetes with multiple pods).
# Each process will have its own copy of this dict, causing token validation failures.
# For production multi-process deployments, use Redis or database storage instead.
_csrf_tokens: dict[str, tuple[int, float]] = {}  # token -> (user_id, expiry_timestamp)


def _constant_time_compare(a: str, b: str) -> bool:
    """
    Constant-time string comparison to prevent timing attacks.
    Uses hmac.compare_digest for cryptographically secure comparison.
    """
    return hmac.compare_digest(a.encode('utf-8'), b.encode('utf-8'))


def generate_csrf_token(user_id: int) -> str:
    """Generate a CSRF token for the given user."""
    token = secrets.token_urlsafe(32)
    expiry = datetime.now(timezone.utc).timestamp() + 3600  # 1 hour expiry
    _csrf_tokens[token] = (user_id, expiry)

    # Cleanup expired tokens periodically
    # NOTE: This cleanup is not fully thread-safe in multi-threaded environments.
    # We use list() to create a snapshot and pop() with default to avoid RuntimeError
    # from dictionary size changing during iteration. For full thread safety in
    # multi-threaded deployments, consider using threading.Lock or Redis storage.
    current_time = datetime.now(timezone.utc).timestamp()
    expired_tokens = [t for t, (_, exp) in list(_csrf_tokens.items()) if exp < current_time]
    for t in expired_tokens:
        _csrf_tokens.pop(t, None)

    return token


def verify_csrf_token(token: str, user_id: int) -> bool:
    """Verify a CSRF token for the given user."""
    if not token or token not in _csrf_tokens:
        return False

    stored_user_id, expiry = _csrf_tokens[token]
    current_time = datetime.now(timezone.utc).timestamp()

    if expiry < current_time:
        del _csrf_tokens[token]
        return False

    # Constant-time comparison for user_id
    if stored_user_id != user_id:
        return False

    return True


def create_signed_image_url(
    pose_id: int,
    image_type: str,
    user_id: int,
    expires_in_seconds: int = 300,  # 5 minutes default
) -> str:
    """
    Create a signed temporary URL for image access.

    This replaces passing the full JWT token in query parameters,
    which would leak the token to logs, browser history, and referrer headers.

    Args:
        pose_id: The pose ID
        image_type: Type of image (schema, photo, muscle_layer, skeleton_layer)
        user_id: The user ID requesting access
        expires_in_seconds: URL validity period (default 5 minutes)

    Returns:
        Query string with signature parameters
    """
    expires_at = int((datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)).timestamp())

    # Create message to sign
    message = f"{pose_id}:{image_type}:{user_id}:{expires_at}"

    # Create HMAC signature
    signature = hmac.new(
        settings.SECRET_KEY.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    params = {
        'user_id': user_id,
        'expires': expires_at,
        'sig': signature,
    }

    return urlencode(params)


def verify_signed_image_url(
    pose_id: int,
    image_type: str,
    user_id: int,
    expires: int,
    signature: str,
) -> bool:
    """
    Verify a signed image URL.

    Returns:
        True if the signature is valid and not expired, False otherwise
    """
    # Check expiration
    current_time = int(datetime.now(timezone.utc).timestamp())
    if current_time > expires:
        logger.warning(f"Signed URL expired for pose {pose_id}, image_type {image_type}")
        return False

    # Recreate and verify signature
    message = f"{pose_id}:{image_type}:{user_id}:{expires}"
    expected_signature = hmac.new(
        settings.SECRET_KEY.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Constant-time comparison to prevent timing attacks
    if not _constant_time_compare(signature, expected_signature):
        logger.warning(f"Invalid signature for pose {pose_id}, image_type {image_type}")
        return False

    return True


@dataclass
class TokenPair:
    """Represents a pair of access and refresh tokens."""
    access_token: str
    refresh_token: str
    access_token_expires_at: datetime
    refresh_token_expires_at: datetime


def _hash_token(token: str) -> str:
    """Create SHA-256 hash of token for secure storage."""
    return hashlib.sha256(token.encode()).hexdigest()


def _create_access_token_data(
    user_id: int,
    expires_delta: Optional[timedelta] = None,
    user_token: Optional[str] = None,
) -> tuple[str, str, datetime]:
    """
    Create JWT access token for user.

    Returns:
        Tuple of (token, jti, expiration_datetime)
    """
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.effective_access_token_expire_minutes
        )

    jti = str(uuid4())
    to_encode = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "jti": jti,
        "type": "access",
    }
    if user_token:
        to_encode["token"] = user_token
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt, jti, expire


def create_access_token(
    user_id: int, expires_delta: Optional[timedelta] = None, user_token: Optional[str] = None
) -> str:
    """
    Create JWT access token for user.

    Returns:
        Encoded JWT string
    """
    token, _, _ = _create_access_token_data(user_id, expires_delta, user_token=user_token)
    return token


def _create_refresh_token_data(
    user_id: int, expires_delta: Optional[timedelta] = None
) -> tuple[str, str, datetime]:
    """
    Create JWT refresh token for user.

    Returns:
        Tuple of (token, jti, expiration_datetime)
    """
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            days=settings.REFRESH_TOKEN_EXPIRE_DAYS
        )

    jti = str(uuid4())
    to_encode = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "jti": jti,
        "type": "refresh",
    }
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt, jti, expire


def create_refresh_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT refresh token for user.

    Returns:
        Encoded JWT string
    """
    token, _, _ = _create_refresh_token_data(user_id, expires_delta)
    return token


def decode_token(token: str, expected_type: str = "access") -> Optional[dict]:
    """
    Verify JWT token and return payload if valid.

    Args:
        token: The JWT token to verify
        expected_type: Expected token type ("access" or "refresh")

    Returns:
        Token payload dict if valid, None otherwise
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
        if payload.get("type") != expected_type:
            return None
        return payload
    except JWTError:
        return None


def verify_token(token: str, expected_type: str = "access") -> Optional[int]:
    """
    Verify JWT token and return user_id if valid.

    Args:
        token: The JWT token to verify
        expected_type: Expected token type ("access" or "refresh")

    Returns:
        User ID if valid, None otherwise
    """
    payload = decode_token(token, expected_type=expected_type)
    if payload is None:
        return None

    user_id = payload.get("sub")
    if user_id is None:
        return None

    try:
        return int(user_id)
    except (TypeError, ValueError):
        return None


async def is_token_blacklisted(
    db: AsyncSession,
    jti: str,
    log_attempt: bool = True,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> bool:
    """
    Check if a token JTI is blacklisted.

    Args:
        db: Database session
        jti: JWT ID to check
        log_attempt: Whether to log blacklisted token usage attempts
        ip_address: Client IP for audit logging
        user_agent: Client user agent for audit logging

    Returns:
        True if token is blacklisted, False otherwise
    """
    result = await db.execute(
        select(TokenBlacklist).where(TokenBlacklist.jti == jti)
    )
    blacklisted_token = result.scalar_one_or_none()

    if blacklisted_token is not None and log_attempt:
        # Log attempted use of blacklisted token (security event)
        logger.warning(
            f"Attempted use of blacklisted token: jti={jti}, "
            f"user_id={blacklisted_token.user_id}, "
            f"reason={blacklisted_token.reason}, "
            f"ip={ip_address}"
        )
        # Create audit log entry
        audit_log = AuthAuditLog(
            user_id=blacklisted_token.user_id,
            action="blacklisted_token_attempt",
            ip_address=ip_address[:45] if ip_address else None,
            user_agent=user_agent[:500] if user_agent else None,
            success=False,
            error_message=f"Attempted use of blacklisted token (reason: {blacklisted_token.reason})",
            metadata_json=json.dumps({"jti": jti, "blacklist_reason": blacklisted_token.reason}),
        )
        db.add(audit_log)
        # Note: Don't flush here to avoid transaction issues; let the caller commit

    return blacklisted_token is not None


async def blacklist_token(
    db: AsyncSession,
    jti: str,
    user_id: Optional[int],
    token_type: str,
    expires_at: datetime,
    reason: str = "logout",
) -> None:
    """Add a token to the blacklist."""
    blacklisted = TokenBlacklist(
        jti=jti,
        user_id=user_id,
        token_type=token_type,
        expires_at=expires_at,
        reason=reason,
    )
    db.add(blacklisted)
    await db.flush()


class TokenService:
    """Service for managing JWT tokens with rotation and blacklisting."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_tokens(
        self,
        user_id: int,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_token: Optional[str] = None,
    ) -> TokenPair:
        """
        Create a new access + refresh token pair.

        Also stores the refresh token hash in the database for validation.
        """
        access_token, access_jti, access_expires = _create_access_token_data(
            user_id, user_token=user_token
        )
        refresh_token, refresh_jti, refresh_expires = _create_refresh_token_data(user_id)

        # Store refresh token hash
        token_hash = _hash_token(refresh_token)
        stored_token = RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            device_info=device_info[:200] if device_info else None,
            ip_address=ip_address[:45] if ip_address else None,
            expires_at=refresh_expires,
        )
        self.db.add(stored_token)
        await self.db.flush()

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            access_token_expires_at=access_expires,
            refresh_token_expires_at=refresh_expires,
        )

    async def refresh_tokens(
        self,
        refresh_token: str,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> TokenPair:
        """
        Refresh token pair using a valid refresh token.

        Implements token rotation:
        1. Validate the refresh token
        2. Check if it's in the database and not revoked
        3. Check for session fixation (device/IP changes)
        4. Update last_used_at timestamp
        5. Invalidate the old refresh token
        6. Create new token pair

        Raises:
            HTTPException: If refresh token is invalid or expired
        """
        # Verify JWT structure and signature
        payload = decode_token(refresh_token, expected_type="refresh")
        if payload is None:
            logger.warning("Invalid or expired refresh token presented")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
            )

        user_id = int(payload["sub"])
        jti = payload["jti"]

        # Check if token is blacklisted (with audit logging)
        if await is_token_blacklisted(self.db, jti, log_attempt=True, ip_address=ip_address):
            logger.warning(f"Attempt to use blacklisted refresh token for user {user_id}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
            )

        # Find the stored refresh token
        token_hash = _hash_token(refresh_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
            )
        )
        stored_token = result.scalar_one_or_none()

        if stored_token is None:
            # Token not found or already revoked - potential token reuse attack
            logger.warning(
                f"Refresh token not found in DB for user {user_id}. "
                "Possible token reuse attack. Revoking all user tokens."
            )
            # Log the security event
            audit_log = AuthAuditLog(
                user_id=user_id,
                action="potential_token_reuse_attack",
                ip_address=ip_address[:45] if ip_address else None,
                user_agent=device_info[:500] if device_info else None,
                success=False,
                error_message="Refresh token not found - possible token reuse attack",
                metadata_json=json.dumps({"jti": jti}),
            )
            self.db.add(audit_log)
            # Revoke all user's refresh tokens as a security measure
            await self.revoke_all_user_tokens(user_id, reason="potential_reuse_attack")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token. All sessions have been terminated.",
            )

        # Session fixation detection: Log anomaly if device_info or ip_address changed significantly
        session_anomaly_detected = False
        anomaly_details = {}

        if stored_token.ip_address and ip_address:
            if stored_token.ip_address != ip_address:
                anomaly_details["ip_changed"] = {
                    "from": stored_token.ip_address,
                    "to": ip_address,
                }
                session_anomaly_detected = True

        if stored_token.device_info and device_info:
            # Check if User-Agent changed (could indicate session hijacking)
            if stored_token.device_info != device_info:
                anomaly_details["device_changed"] = {
                    "from": stored_token.device_info[:100],
                    "to": device_info[:100] if device_info else None,
                }
                session_anomaly_detected = True

        if session_anomaly_detected:
            logger.warning(
                f"Session anomaly detected for user {user_id}: {anomaly_details}"
            )
            # Log the anomaly but allow the refresh (could be legitimate, e.g., mobile network change)
            audit_log = AuthAuditLog(
                user_id=user_id,
                action="session_anomaly_detected",
                ip_address=ip_address[:45] if ip_address else None,
                user_agent=device_info[:500] if device_info else None,
                success=True,  # We're still allowing it, just logging
                error_message="Session context changed during token refresh",
                metadata_json=json.dumps(anomaly_details),
            )
            self.db.add(audit_log)

        # Update last_used_at timestamp (Issue #7)
        stored_token.last_used_at = datetime.now(timezone.utc)

        # Revoke the old refresh token
        stored_token.is_revoked = True
        stored_token.revoked_at = datetime.now(timezone.utc)
        stored_token.revoke_reason = "rotation"
        await self.db.flush()

        # Create new token pair
        return await self.create_tokens(user_id, device_info, ip_address)

    async def revoke_token(
        self,
        refresh_token: str,
        reason: str = "logout",
    ) -> bool:
        """
        Revoke a specific refresh token.

        Returns:
            True if token was found and revoked, False otherwise
        """
        token_hash = _hash_token(refresh_token)
        result = await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == token_hash)
            .values(
                is_revoked=True,
                revoked_at=datetime.now(timezone.utc),
                revoke_reason=reason,
            )
            .returning(RefreshToken.id)
        )
        revoked_id = result.scalar_one_or_none()
        await self.db.flush()
        return revoked_id is not None

    async def revoke_all_user_tokens(
        self,
        user_id: int,
        reason: str = "logout_all",
    ) -> int:
        """
        Revoke all refresh tokens for a user.

        Returns:
            Number of tokens revoked
        """
        result = await self.db.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked == False,
                )
            )
            .values(
                is_revoked=True,
                revoked_at=datetime.now(timezone.utc),
                revoke_reason=reason,
            )
        )
        await self.db.flush()
        return result.rowcount

    async def revoke_session(
        self,
        user_id: int,
        session_id: int,
        reason: str = "session_revoke",
    ) -> bool:
        """
        Revoke a specific session (refresh token) by ID.

        Returns:
            True if session was found and revoked, False otherwise
        """
        result = await self.db.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.id == session_id,
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked == False,
                )
            )
            .values(
                is_revoked=True,
                revoked_at=datetime.now(timezone.utc),
                revoke_reason=reason,
            )
            .returning(RefreshToken.id)
        )
        revoked_id = result.scalar_one_or_none()
        await self.db.flush()
        return revoked_id is not None

    async def get_user_sessions(
        self,
        user_id: int,
        include_revoked: bool = False,
    ) -> list[RefreshToken]:
        """Get all sessions (refresh tokens) for a user."""
        query = select(RefreshToken).where(RefreshToken.user_id == user_id)

        if not include_revoked:
            query = query.where(
                and_(
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
            )

        query = query.order_by(RefreshToken.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def cleanup_expired_tokens(self) -> tuple[int, int]:
        """
        Clean up expired tokens from database.

        Returns:
            Tuple of (expired_refresh_tokens_deleted, expired_blacklist_entries_deleted)
        """
        now = datetime.now(timezone.utc)

        # Delete expired refresh tokens
        result1 = await self.db.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < now)
        )

        # Delete expired blacklist entries
        result2 = await self.db.execute(
            delete(TokenBlacklist).where(TokenBlacklist.expires_at < now)
        )

        await self.db.flush()
        return result1.rowcount, result2.rowcount


class AuditService:
    """Service for logging authentication events."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def log(
        self,
        action: str,
        user_id: Optional[int] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> AuthAuditLog:
        """Log an authentication event."""
        log_entry = AuthAuditLog(
            user_id=user_id,
            action=action,
            ip_address=ip_address[:45] if ip_address else None,
            user_agent=user_agent[:500] if user_agent else None,
            success=success,
            error_message=error_message,
            metadata_json=json.dumps(metadata) if metadata else None,
        )
        self.db.add(log_entry)
        await self.db.flush()
        return log_entry


def get_client_info(request: Request) -> tuple[str, str]:
    """Extract client IP and User-Agent from request."""
    # Get IP address
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        ip_address = forwarded_for.split(",")[0].strip()
    else:
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            ip_address = real_ip.strip()
        elif request.client:
            ip_address = request.client.host
        else:
            ip_address = "unknown"

    # Get User-Agent
    user_agent = request.headers.get("User-Agent", "unknown")

    return ip_address, user_agent


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency to get current authenticated user from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    token = credentials.credentials.strip()
    payload = decode_token(token, expected_type="access")

    if payload is None:
        raise credentials_exception

    user_id = payload.get("sub")
    jti = payload.get("jti")
    token_value = payload.get("token")

    if user_id is None:
        raise credentials_exception

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        raise credentials_exception

    # Check if token is blacklisted
    if jti and await is_token_blacklisted(db, jti):
        raise credentials_exception

    # Get user from database
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    if token_value:
        setattr(user, "token", token_value)

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        HTTPBearer(auto_error=False)
    ),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Dependency to get current user if authenticated, or None if not."""
    if credentials is None:
        return None

    token = credentials.credentials.strip()
    payload = decode_token(token, expected_type="access")

    if payload is None:
        return None

    user_id = payload.get("sub")
    jti = payload.get("jti")
    token_value = payload.get("token")

    if user_id is None:
        return None

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return None

    # Check if token is blacklisted
    if jti and await is_token_blacklisted(db, jti):
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user and token_value:
        setattr(user, "token", token_value)
    return user


async def verify_signed_image_request(
    request: Request,
    pose_id: int,
    image_type: str,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Verify a signed image URL request.

    This replaces token-in-query-parameter authentication to prevent token leakage
    to logs, browser history, and referrer headers.

    Args:
        request: The FastAPI request object
        pose_id: The pose ID from the path
        image_type: The image type from the path
        db: Database session

    Returns:
        The authenticated User

    Raises:
        HTTPException: If signature is invalid, expired, or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired image URL",
    )

    # First, check for Bearer token in header (preferred method)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        payload = decode_token(token, expected_type="access")
        if payload:
            user_id = payload.get("sub")
            token_value = payload.get("token")
            if user_id:
                try:
                    user_id = int(user_id)
                    result = await db.execute(select(User).where(User.id == user_id))
                    user = result.scalar_one_or_none()
                    if user:
                        if token_value:
                            setattr(user, "token", token_value)
                        return user
                except (TypeError, ValueError):
                    pass

    # Fall back to signed URL verification
    user_id_param = request.query_params.get("user_id")
    expires_param = request.query_params.get("expires")
    sig_param = request.query_params.get("sig")

    if not all([user_id_param, expires_param, sig_param]):
        raise credentials_exception

    try:
        user_id = int(user_id_param)
        expires = int(expires_param)
    except (TypeError, ValueError):
        raise credentials_exception

    # Verify the signature
    if not verify_signed_image_url(pose_id, image_type, user_id, expires, sig_param):
        raise credentials_exception

    # Get the user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user


async def get_current_user_from_request(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        HTTPBearer(auto_error=False)
    ),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get current user from Authorization header only.

    SECURITY: Query parameter token authentication has been REMOVED to prevent
    token leakage to logs, browser history, and referrer headers. Use signed
    URLs for image access instead (see verify_signed_image_request).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    raw_token = credentials.credentials

    if not raw_token:
        raise credentials_exception

    payload = decode_token(raw_token.strip(), expected_type="access")
    if payload is None:
        raise credentials_exception

    user_id = payload.get("sub")
    jti = payload.get("jti")
    token_value = payload.get("token")

    if user_id is None:
        raise credentials_exception

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        raise credentials_exception

    # Check if token is blacklisted
    if jti and await is_token_blacklisted(db, jti):
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception

    if token_value:
        setattr(user, "token", token_value)

    return user
