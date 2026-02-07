import urllib.parse
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Request
from starlette.responses import Response

from api.routes.poses import get_pose_image_signed_url
from api.routes.auth import login as login_route
from api.routes.auth import refresh_tokens as refresh_route
from models.pose import Pose
from models.user import User
from schemas.user import UserLogin


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def _make_request(
    *,
    scheme: str = "http",
    host: str = "internal:8000",
    path: str = "/",
    headers: dict[str, str] | None = None,
) -> Request:
    hdrs = [(b"host", host.encode("latin-1"))]
    if headers:
        hdrs.extend([(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()])

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": scheme,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "query_string": b"",
        "headers": hdrs,
        "client": ("127.0.0.1", 12345),
        "server": (host.split(":")[0], int(host.split(":")[1]) if ":" in host else (80 if scheme == "http" else 443)),
    }
    return Request(scope)


def _get_set_cookie_headers(response: Response) -> list[str]:
    return [
        v.decode("latin-1")
        for (k, v) in response.raw_headers
        if k.lower() == b"set-cookie"
    ]


@pytest.mark.asyncio
async def test_signed_url_uses_forwarded_proto_and_host_for_public_links(monkeypatch):
    import api.routes.poses as poses_routes

    monkeypatch.setattr(
        poses_routes.config,
        "get_settings",
        lambda: SimpleNamespace(
            TRUSTED_PROXIES="127.0.0.1/32",
            APP_MODE=poses_routes.config.AppMode.DEV,
        ),
    )

    request = _make_request(
        scheme="http",
        host="internal:8000",
        path="/api/v1/poses/18/image/schema/signed-url",
        headers={
            "x-forwarded-proto": "https",
            "x-forwarded-host": "yoga-platform-production-b251.up.railway.app",
        },
    )

    current_user = User.create_with_token("t")
    current_user.id = 42
    current_user.created_at = datetime.now(timezone.utc)

    pose = Pose(user_id=current_user.id, code="P01", name="Pose", schema_path="http://cdn/img.png")
    pose.id = 18
    pose.version = 7

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_FakeResult(pose))

    data = await get_pose_image_signed_url(
        pose_id=pose.id,
        image_type="schema",
        request=request,
        current_user=current_user,
        db=db,
    )

    signed_url = data["signed_url"]
    assert signed_url.startswith(
        "https://yoga-platform-production-b251.up.railway.app/api/v1/poses/18/image/schema?"
    )

    parsed = urllib.parse.urlparse(signed_url)
    params = urllib.parse.parse_qs(parsed.query)
    assert params["user_id"][0] == str(current_user.id)
    assert "sig" in params
    assert params["v"][0] == str(pose.version)


@pytest.mark.asyncio
async def test_signed_url_falls_back_to_request_base_url_without_forwarded_headers():
    request = _make_request(
        scheme="http",
        host="internal:8000",
        path="/api/v1/poses/18/image/schema/signed-url",
    )

    current_user = User.create_with_token("t")
    current_user.id = 42
    current_user.created_at = datetime.now(timezone.utc)

    pose = Pose(user_id=current_user.id, code="P01", name="Pose", schema_path="http://cdn/img.png")
    pose.id = 18

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_FakeResult(pose))

    data = await get_pose_image_signed_url(
        pose_id=pose.id,
        image_type="schema",
        request=request,
        current_user=current_user,
        db=db,
    )

    signed_url = data["signed_url"]
    assert signed_url.startswith("http://internal:8000/api/v1/poses/18/image/schema?")


@pytest.mark.asyncio
async def test_login_sets_refresh_cookie_on_root_path_and_clears_legacy_api_path(monkeypatch):
    # Patch services so we don't touch the database/aiosqlite in unit tests
    class _FakeTokenService:
        def __init__(self, _db):
            pass

        async def create_tokens(self, **_kwargs):
            return SimpleNamespace(
                access_token="access",
                refresh_token="refresh",
            )

    class _FakeAuditService:
        def __init__(self, _db):
            pass

        async def log(self, **_kwargs):
            return None

    import api.routes.auth as auth_routes

    monkeypatch.setattr(auth_routes, "TokenService", _FakeTokenService)
    monkeypatch.setattr(auth_routes, "AuditService", _FakeAuditService)

    user = User.create_with_token("test-auth-token")
    user.id = 1
    user.created_at = datetime.now(timezone.utc)

    db = AsyncMock()
    db.execute = AsyncMock(return_value=_FakeResult(user))
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    request = _make_request(
        scheme="https",
        host="app.example.com:443",
        path="/api/auth/login",
        headers={"user-agent": "pytest"},
    )
    response = Response()

    await login_route(UserLogin(token="test-auth-token"), request, response, db)

    cookies = _get_set_cookie_headers(response)
    # 1) Legacy cleanup cookie: Path=/api
    assert any(c.startswith("refresh_token=") and "Path=/api" in c and "Max-Age=0" in c for c in cookies)
    # 2) New cookie: Path=/
    assert any(c.startswith("refresh_token=") and "Path=/" in c and "Max-Age=0" not in c for c in cookies)


@pytest.mark.asyncio
async def test_refresh_sets_refresh_cookie_on_root_path_and_clears_legacy_api_path(monkeypatch):
    class _FakeTokenService:
        def __init__(self, _db):
            pass

        async def refresh_tokens(self, **_kwargs):
            return SimpleNamespace(
                access_token="access",
                refresh_token="refresh2",
            )

    class _FakeAuditService:
        def __init__(self, _db):
            pass

        async def log(self, **_kwargs):
            return None

    import api.routes.auth as auth_routes
    import services.auth as auth_service

    monkeypatch.setattr(auth_routes, "TokenService", _FakeTokenService)
    monkeypatch.setattr(auth_routes, "AuditService", _FakeAuditService)
    monkeypatch.setattr(auth_service, "decode_token", lambda *_args, **_kwargs: {"sub": "1"})
    monkeypatch.setattr(auth_routes, "verify_csrf_token", lambda *_args, **_kwargs: True)

    user = User.create_with_token("test-auth-token")
    user.id = 1
    user.created_at = datetime.now(timezone.utc)

    db = AsyncMock()
    # First execute is for fetching user during refresh route
    db.execute = AsyncMock(return_value=_FakeResult(user))
    db.commit = AsyncMock()

    request = _make_request(
        scheme="https",
        host="app.example.com:443",
        path="/api/auth/refresh",
        headers={
            "user-agent": "pytest",
            "x-csrf-token": "csrf-ok",
        },
    )
    response = Response()

    await refresh_route(request, response, None, "refresh", db)

    cookies = _get_set_cookie_headers(response)
    assert any(c.startswith("refresh_token=") and "Path=/api" in c and "Max-Age=0" in c for c in cookies)
    assert any(c.startswith("refresh_token=") and "Path=/" in c and "Max-Age=0" not in c for c in cookies)
