"""Rate limiting middleware and utilities.

Implements sliding window rate limiting for API protection.

SECURITY NOTES:
- In-memory rate limiter is lost on restart. For production with multiple
  instances, use Redis by setting REDIS_URL in environment.
- X-Forwarded-For header is only trusted when TRUSTED_PROXIES is configured.
  This prevents IP spoofing attacks.
"""

import asyncio
import ipaddress
import logging
import os
import sys
import time
from abc import ABC, abstractmethod
from collections import defaultdict
from functools import wraps
from typing import Callable, Dict, List, Optional, Tuple

from config import AppMode, get_settings
from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)
settings = get_settings()


# Default trusted proxy networks (loopback and private networks for development)
# In production, configure TRUSTED_PROXIES explicitly
#
# WARNING: Default trusted proxies include all private ranges.
# In production, explicitly configure TRUSTED_PROXIES to your actual proxy IPs.
# Leaving defaults allows any client on your private network to spoof X-Forwarded-For.
# Example production config: TRUSTED_PROXIES="10.0.1.5,10.0.1.6" (your load balancer IPs)
DEFAULT_TRUSTED_PROXIES = [
    "127.0.0.0/8",  # Loopback
    "10.0.0.0/8",  # Private Class A
    "172.16.0.0/12",  # Private Class B
    "192.168.0.0/16",  # Private Class C
    "::1/128",  # IPv6 loopback
    "fc00::/7",  # IPv6 private
]


class RateLimiterBackend(ABC):
    """Abstract base class for rate limiter storage backends."""

    @abstractmethod
    async def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> Tuple[bool, int, int]:
        """Check if request is allowed and record it if so."""
        pass

    @abstractmethod
    def reset(self, key: str) -> None:
        """Reset rate limit for a specific key."""
        pass


class InMemoryRateLimiterBackend(RateLimiterBackend):
    """
    In-memory rate limiter backend using sliding window algorithm.

    WARNING - NOT PROCESS-SAFE:
    This backend stores rate limit data in process memory, which means:
    1. Rate limits are lost on application restart
    2. Each worker process has its own independent rate limit counters
    3. With N workers, effective rate limit becomes N * configured_limit
    4. Load balancing across workers makes rate limiting inconsistent

    For production deployments with multiple workers (gunicorn, uvicorn --workers),
    you MUST use RedisRateLimiterBackend by setting REDIS_URL environment variable.

    MEMORY MANAGEMENT:
    This backend implements LRU eviction to prevent unbounded memory growth.
    When the number of tracked keys exceeds MAX_KEYS, the least recently used
    keys are evicted. For high-traffic production environments, use Redis instead.
    """

    # Maximum number of keys to track before LRU eviction kicks in
    # This prevents unbounded memory growth from tracking many unique IPs
    MAX_KEYS = 10000

    def __init__(self):
        self._requests: Dict[str, List[float]] = defaultdict(list)
        self._last_access: Dict[str, float] = {}  # Track last access time for LRU
        self._lock = asyncio.Lock()
        self._cleanup_interval = 60
        self._last_cleanup = time.time()

    async def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> Tuple[bool, int, int]:
        current_time = time.time()
        window_start = current_time - window_seconds

        async with self._lock:
            if current_time - self._last_cleanup > self._cleanup_interval:
                await self._cleanup(window_start)
                self._last_cleanup = current_time

            # LRU eviction: if we have too many keys, remove least recently used
            if len(self._requests) >= self.MAX_KEYS and key not in self._requests:
                await self._evict_lru()

            # Update last access time for LRU tracking
            self._last_access[key] = current_time

            request_times = self._requests[key]
            request_times[:] = [t for t in request_times if t > window_start]
            current_count = len(request_times)

            if current_count >= max_requests:
                if request_times:
                    oldest = min(request_times)
                    retry_after = int(oldest + window_seconds - current_time) + 1
                else:
                    retry_after = window_seconds
                return False, 0, max(1, retry_after)

            request_times.append(current_time)
            remaining = max_requests - len(request_times)
            return True, remaining, 0

    async def _evict_lru(self) -> None:
        """Evict least recently used keys to make room for new ones."""
        if not self._last_access:
            return

        # Evict 10% of keys or at least 100 keys to reduce eviction frequency
        num_to_evict = max(100, len(self._requests) // 10)

        # Sort by last access time and get the oldest keys
        sorted_keys = sorted(self._last_access.items(), key=lambda x: x[1])
        keys_to_evict = [k for k, _ in sorted_keys[:num_to_evict]]

        for key in keys_to_evict:
            self._requests.pop(key, None)
            self._last_access.pop(key, None)

        logger.debug(f"Rate limiter LRU eviction: removed {len(keys_to_evict)} keys")

    async def _cleanup(self, cutoff_time: float):
        keys_to_remove = []
        for key, timestamps in self._requests.items():
            timestamps[:] = [t for t in timestamps if t > cutoff_time]
            if not timestamps:
                keys_to_remove.append(key)
        for key in keys_to_remove:
            del self._requests[key]
            self._last_access.pop(key, None)  # Also clean up LRU tracking

    def reset(self, key: str) -> None:
        if key in self._requests:
            del self._requests[key]
        self._last_access.pop(key, None)  # Also clean up LRU tracking


class RedisRateLimiterBackend(RateLimiterBackend):
    """
    Redis-based rate limiter backend for production use.

    Provides persistence across restarts and works with multiple application instances.
    Uses sorted sets with timestamps for efficient sliding window implementation.
    """

    def __init__(self, redis_url: str):
        self._redis_url = redis_url
        self._redis = None
        self._initialized = False

    async def _get_redis(self):
        """Lazy initialization of Redis connection."""
        if not self._initialized:
            try:
                import redis.asyncio as redis

                self._redis = redis.from_url(
                    self._redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                )
                # Test connection
                await self._redis.ping()
                self._initialized = True
                logger.info("Redis rate limiter backend initialized successfully")
            except ImportError:
                logger.error(
                    "redis package not installed. Install with: pip install redis"
                )
                raise
            except Exception as e:
                logger.error(f"Failed to connect to Redis: {e}")
                raise
        return self._redis

    async def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> Tuple[bool, int, int]:
        redis = await self._get_redis()
        current_time = time.time()
        window_start = current_time - window_seconds
        redis_key = f"ratelimit:{key}"

        # Use a pipeline for atomic operations
        pipe = redis.pipeline()

        # Remove old entries
        pipe.zremrangebyscore(redis_key, 0, window_start)
        # Count current entries
        pipe.zcard(redis_key)
        # Execute
        results = await pipe.execute()
        current_count = results[1]

        if current_count >= max_requests:
            # Get oldest timestamp to calculate retry_after
            oldest_entries = await redis.zrange(redis_key, 0, 0, withscores=True)
            if oldest_entries:
                oldest_time = oldest_entries[0][1]
                retry_after = int(oldest_time + window_seconds - current_time) + 1
            else:
                retry_after = window_seconds
            return False, 0, max(1, retry_after)

        # Add current request
        await redis.zadd(redis_key, {str(current_time): current_time})
        # Set TTL on the key
        await redis.expire(redis_key, window_seconds + 1)

        remaining = max_requests - current_count - 1
        return True, remaining, 0

    def reset(self, key: str) -> None:
        """Reset is async for Redis but we provide sync interface for compatibility."""
        # For sync reset, we'd need to run in event loop
        # This is a limitation - consider making the interface fully async
        logger.warning(
            f"Sync reset called for Redis backend key {key}. "
            "Consider using async reset instead."
        )


class RateLimiter:
    """
    Thread-safe sliding window rate limiter.

    Tracks requests per key (IP, user_id, etc.) within a time window.

    By default uses in-memory storage. For production with multiple instances,
    set REDIS_URL environment variable to use Redis backend.

    WARNING: In-memory backend loses all rate limit state on restart!
    """

    def __init__(self, backend: Optional[RateLimiterBackend] = None):
        if backend:
            self._backend = backend
        else:
            # Check for Redis URL in settings
            redis_url = getattr(settings, "REDIS_URL", None)
            if redis_url:
                logger.info("Using Redis rate limiter backend")
                self._backend = RedisRateLimiterBackend(redis_url)
            else:
                message = (
                    "Using in-memory rate limiter. Rate limits will be lost on restart. "
                    "Set REDIS_URL for production use with multiple instances."
                )
                if settings.APP_MODE == AppMode.DEV:
                    logger.debug(message)
                else:
                    logger.warning(message)
                self._backend = InMemoryRateLimiterBackend()

    async def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> Tuple[bool, int, int]:
        """
        Check if request is allowed under rate limit.

        Args:
            key: Unique identifier (IP, user_id, endpoint combo)
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds

        Returns:
            Tuple of (is_allowed, remaining_requests, retry_after_seconds)
        """
        return await self._backend.is_allowed(key, max_requests, window_seconds)

    def reset(self, key: str):
        """Reset rate limit for a specific key."""
        self._backend.reset(key)


# Global rate limiter instance
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get the global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter


def _parse_trusted_proxies() -> List[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """
    Parse trusted proxy configuration from settings.

    Returns list of IP networks that are trusted to set X-Forwarded-For headers.
    """
    trusted_proxies_str = getattr(settings, "TRUSTED_PROXIES", None)

    if trusted_proxies_str:
        # Parse from comma-separated string in config
        proxy_strings = [p.strip() for p in trusted_proxies_str.split(",") if p.strip()]
    else:
        # SECURITY: Do NOT trust X-Forwarded-* by default.
        # If TRUSTED_PROXIES is not configured, we treat the direct connection IP
        # as the client IP and ignore forwarded headers. This prevents spoofing
        # and aligns behavior with other security-sensitive code paths.
        proxy_strings = []

    networks = []
    for proxy in proxy_strings:
        try:
            networks.append(ipaddress.ip_network(proxy, strict=False))
        except ValueError as e:
            logger.warning(f"Invalid trusted proxy network '{proxy}': {e}")

    return networks


def _is_ip_trusted(ip: str, trusted_networks: List) -> bool:
    """Check if an IP address is in any of the trusted networks."""
    try:
        ip_addr = ipaddress.ip_address(ip)
        return any(ip_addr in network for network in trusted_networks)
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """
    Securely extract client IP address from request.

    SECURITY: Only trusts X-Forwarded-For header when the request comes from
    a configured trusted proxy. This prevents IP spoofing attacks where an
    attacker could set X-Forwarded-For to bypass rate limiting.

    The function implements the "rightmost untrusted IP" algorithm:
    1. Start with the direct connection IP
    2. If the direct IP is a trusted proxy, look at X-Forwarded-For
    3. Walk through X-Forwarded-For from right to left
    4. Stop at the first IP that is NOT a trusted proxy
    5. That IP is the client IP

    This prevents attackers from spoofing their IP by adding fake entries
    to the X-Forwarded-For header.
    """
    trusted_networks = _parse_trusted_proxies()

    # Get the direct connection IP
    direct_ip = request.client.host if request.client else None

    if not direct_ip:
        return "unknown"

    # If direct connection is not from a trusted proxy, use it directly
    # This is the secure default - don't trust any headers
    if not _is_ip_trusted(direct_ip, trusted_networks):
        return direct_ip

    # Direct connection is from a trusted proxy, so we can examine headers
    forwarded_for = request.headers.get("X-Forwarded-For")

    if not forwarded_for:
        # No X-Forwarded-For header, check X-Real-IP
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            ip = real_ip.strip()
            # Validate it's a valid IP
            try:
                ipaddress.ip_address(ip)
                return ip
            except ValueError:
                logger.warning(f"Invalid X-Real-IP header: {real_ip}")
                return direct_ip
        return direct_ip

    # Parse X-Forwarded-For: client, proxy1, proxy2, ...
    # We walk from right to left to find the rightmost untrusted IP
    ips = [ip.strip() for ip in forwarded_for.split(",")]

    # Walk from right to left (most recent proxy to oldest)
    for ip in reversed(ips):
        try:
            # Validate IP format
            ipaddress.ip_address(ip)
        except ValueError:
            logger.warning(f"Invalid IP in X-Forwarded-For: {ip}")
            continue

        # If this IP is not a trusted proxy, it's the client IP
        if not _is_ip_trusted(ip, trusted_networks):
            return ip

    # All IPs in the chain are trusted proxies, use the leftmost (original)
    # This shouldn't normally happen in a properly configured setup
    if ips:
        try:
            ipaddress.ip_address(ips[0])
            return ips[0]
        except ValueError:
            pass

    return direct_ip


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware for global rate limiting.

    Applies different rate limits based on endpoint paths:
    - Token refresh endpoint (/api/auth/refresh): Very strict (3/min) - prevents token abuse
    - Auth endpoints (/api/auth/*): Stricter limits
    - Generate endpoints (/api/generate/*): Strictest limits
    - Other endpoints: Standard global limit
    """

    # Very strict rate limit for token refresh to prevent abuse
    REFRESH_RATE_LIMIT = 3  # 3 requests per minute
    REFRESH_WINDOW = 60  # 1 minute window

    def __init__(self, app, rate_limiter: Optional[RateLimiter] = None):
        super().__init__(app)
        self.rate_limiter = rate_limiter or get_rate_limiter()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Disable rate limiting during tests
        if "pytest" in sys.modules:
            return await call_next(request)
        # Disable rate limiting for Playwright E2E runs (local dev/test mode).
        # This prevents flaky E2E failures due to middleware-level 429 responses.
        if os.getenv("E2E_FAST_AI") == "1" or os.getenv("DISABLE_RATE_LIMIT") == "1":
            return await call_next(request)

        # Skip rate limiting for health checks and static files
        path = request.url.path
        if path in ("/health", "/", "/docs", "/redoc", "/openapi.json"):
            return await call_next(request)

        if path.startswith("/storage/"):
            return await call_next(request)

        client_ip = get_client_ip(request)

        # Determine rate limit based on path
        # Support both /api/v1/ and /api/ (deprecated) prefixes
        # SECURITY: Token refresh has its own strict rate limit to prevent token abuse
        if path in ("/api/v1/auth/refresh", "/api/auth/refresh"):
            # Very strict rate limit for token refresh endpoint
            # This prevents attackers from:
            # 1. Brute-forcing refresh tokens
            # 2. Triggering token reuse detection repeatedly
            # 3. Exhausting server resources with refresh attempts
            max_requests = self.REFRESH_RATE_LIMIT
            window = self.REFRESH_WINDOW
            limit_key = f"refresh:{client_ip}"
        elif path.startswith("/api/v1/auth/") or path.startswith("/api/auth/"):
            max_requests = settings.effective_rate_limit_auth
            window = settings.RATE_LIMIT_WINDOW
            limit_key = f"auth:{client_ip}"
        elif path.startswith("/api/v1/generate/status/") or path.startswith("/api/generate/status/"):
            # Status polling is much lighter than image generation itself.
            # Keep this reasonably permissive so clients can recover if WebSocket is blocked.
            max_requests = settings.RATE_LIMIT_GLOBAL
            window = settings.RATE_LIMIT_WINDOW
            limit_key = f"generate_status:{client_ip}"
        elif path.startswith("/api/v1/generate") or path.startswith("/api/generate"):
            # For generate endpoints, use user-based limiting if authenticated
            # Fall back to IP-based for unauthenticated requests
            max_requests = settings.RATE_LIMIT_GENERATE
            window = settings.RATE_LIMIT_WINDOW
            limit_key = f"generate:{client_ip}"
        else:
            max_requests = settings.RATE_LIMIT_GLOBAL
            window = settings.RATE_LIMIT_WINDOW
            limit_key = f"global:{client_ip}"

        is_allowed, remaining, retry_after = await self.rate_limiter.is_allowed(
            limit_key, max_requests, window
        )

        if not is_allowed:
            logger.warning(
                f"Rate limit exceeded for {limit_key} (path={path}, ip={client_ip})"
            )

            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Too many requests. Please try again later.",
                    "retry_after": retry_after,
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + retry_after),
                },
            )

        # Add rate limit headers to response
        response = await call_next(request)

        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + window)

        return response


def rate_limit(
    max_requests: int, window: int = 60, key_func: Optional[Callable] = None
):
    """
    Decorator for endpoint-specific rate limits.

    Use this when you need finer control than the middleware provides.

    Args:
        max_requests: Maximum requests allowed in window
        window: Time window in seconds (default: 60)
        key_func: Optional function to generate rate limit key from request
                  Signature: (request: Request) -> str
                  Default: Uses client IP

    Example:
        @router.post("/expensive-operation")
        @rate_limit(max_requests=5, window=300)
        async def expensive_operation(request: Request):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Find the Request object in args or kwargs
            request = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            if request is None:
                request = kwargs.get("request")

            if request is None:
                # Can't rate limit without request, just call the function
                return await func(*args, **kwargs)

            # Generate rate limit key
            if key_func:
                limit_key = key_func(request)
            else:
                client_ip = get_client_ip(request)
                limit_key = f"endpoint:{func.__name__}:{client_ip}"

            rate_limiter = get_rate_limiter()
            is_allowed, remaining, retry_after = await rate_limiter.is_allowed(
                limit_key, max_requests, window
            )

            if not is_allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": "Too many requests. Please try again later.",
                        "retry_after": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )

            return await func(*args, **kwargs)

        return wrapper

    return decorator


def rate_limit_by_user(max_requests: int, window: int = 60):
    """
    Decorator for user-based rate limiting.

    Requires the endpoint to have a current_user dependency.

    Example:
        @router.post("/user-action")
        @rate_limit_by_user(max_requests=10, window=60)
        async def user_action(current_user: User = Depends(get_current_user)):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Try to find user_id from kwargs (from dependency injection)
            user = kwargs.get("current_user")
            user_id = None

            if user and hasattr(user, "id"):
                user_id = user.id

            if user_id is None:
                # Fall back to IP-based limiting
                request = None
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
                if request is None:
                    request = kwargs.get("request")

                if request:
                    client_ip = get_client_ip(request)
                    limit_key = f"user_endpoint:{func.__name__}:{client_ip}"
                else:
                    # Can't rate limit without context
                    return await func(*args, **kwargs)
            else:
                limit_key = f"user_endpoint:{func.__name__}:user:{user_id}"

            rate_limiter = get_rate_limiter()
            is_allowed, remaining, retry_after = await rate_limiter.is_allowed(
                limit_key, max_requests, window
            )

            if not is_allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": "Too many requests. Please try again later.",
                        "retry_after": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )

            return await func(*args, **kwargs)

        return wrapper

    return decorator
