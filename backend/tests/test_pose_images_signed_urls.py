import urllib.parse
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from models.pose import Pose
from models.user import User
from services.auth import create_signed_image_url
from services.storage import LocalStorage


async def _create_pose(
    db_session,
    user_id: int,
    **kwargs,
) -> Pose:
    pose = Pose(
        user_id=user_id,
        code=kwargs.get("code", "IMG01"),
        name=kwargs.get("name", "Image Pose"),
        schema_path=kwargs.get("schema_path"),
        photo_path=kwargs.get("photo_path"),
        muscle_layer_path=kwargs.get("muscle_layer_path"),
        skeleton_layer_path=kwargs.get("skeleton_layer_path"),
    )
    db_session.add(pose)
    await db_session.flush()
    await db_session.refresh(pose)
    await db_session.commit()
    return pose


@pytest.mark.asyncio
async def test_signed_url_returns_query_and_expiry(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG02",
    )

    response = await auth_client.get(
        f"/api/poses/{pose.id}/image/schema/signed-url"
    )
    assert response.status_code == 200
    data = response.json()
    signed_url = data["signed_url"]

    parsed = urllib.parse.urlparse(signed_url)
    params = urllib.parse.parse_qs(parsed.query)
    assert params["user_id"][0] == str(user.id)
    assert params["expires"][0] == str(data["expires_at"])
    assert "sig" in params
    assert params["v"][0] == str(pose.version)


@pytest.mark.asyncio
async def test_signed_url_invalid_image_type(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG03",
    )

    response = await auth_client.get(
        f"/api/poses/{pose.id}/image/invalid/signed-url"
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_signed_url_pose_not_found(auth_client: AsyncClient):
    response = await auth_client.get("/api/poses/99999/image/schema/signed-url")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_signed_url_no_image(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(db_session, user.id, code="IMG04")

    response = await auth_client.get(
        f"/api/poses/{pose.id}/image/schema/signed-url"
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_pose_image_with_bearer_auth(
    auth_client: AsyncClient,
    db_session,
    sample_image_bytes: bytes,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.jpg",
        code="IMG05",
    )

    storage = MagicMock()
    storage.download_bytes = AsyncMock(return_value=sample_image_bytes)

    with patch("api.routes.poses.get_storage", return_value=storage):
        response = await auth_client.get(
            f"/api/poses/{pose.id}/image/schema"
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.headers["cache-control"] == "private, max-age=86400"
    storage.download_bytes.assert_awaited_once_with(pose.schema_path)


@pytest.mark.asyncio
async def test_get_pose_image_with_signed_query(
    auth_client: AsyncClient,
    db_session,
    sample_image_bytes: bytes,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG06",
    )

    storage = MagicMock()
    storage.download_bytes = AsyncMock(return_value=sample_image_bytes)

    with patch("api.routes.poses.get_storage", return_value=storage):
        signed_response = await auth_client.get(
            f"/api/poses/{pose.id}/image/schema/signed-url"
        )
        signed_url = signed_response.json()["signed_url"]

        original_header = auth_client.headers.get("Authorization")
        if original_header:
            auth_client.headers.pop("Authorization", None)

        try:
            response = await auth_client.get(signed_url)
        finally:
            if original_header:
                auth_client.headers["Authorization"] = original_header

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["cache-control"] == "private, max-age=86400"
    storage.download_bytes.assert_awaited_once_with(pose.schema_path)


@pytest.mark.asyncio
async def test_get_pose_image_without_auth_fails(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG07",
    )

    original_header = auth_client.headers.get("Authorization")
    if original_header:
        auth_client.headers.pop("Authorization", None)

    try:
        response = await auth_client.get(
            f"/api/poses/{pose.id}/image/schema"
        )
    finally:
        if original_header:
            auth_client.headers["Authorization"] = original_header

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_pose_image_expired_signature(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG08",
    )

    query_string = create_signed_image_url(
        pose_id=pose.id,
        image_type="schema",
        user_id=user.id,
        expires_in_seconds=-60,
    )
    signed_url = f"/api/poses/{pose.id}/image/schema?{query_string}"

    original_header = auth_client.headers.get("Authorization")
    if original_header:
        auth_client.headers.pop("Authorization", None)

    try:
        response = await auth_client.get(signed_url)
    finally:
        if original_header:
            auth_client.headers["Authorization"] = original_header

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_pose_image_tampered_signature(
    auth_client: AsyncClient,
    db_session,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="https://example.com/test.png",
        code="IMG09",
    )

    query_string = create_signed_image_url(
        pose_id=pose.id,
        image_type="schema",
        user_id=user.id,
        expires_in_seconds=300,
    )
    params = urllib.parse.parse_qs(query_string)
    sig = params["sig"][0]
    params["sig"] = [sig[:-1] + ("0" if sig[-1] != "0" else "1")]
    tampered = urllib.parse.urlencode(
        {key: value[0] for key, value in params.items()}
    )
    signed_url = f"/api/poses/{pose.id}/image/schema?{tampered}"

    original_header = auth_client.headers.get("Authorization")
    if original_header:
        auth_client.headers.pop("Authorization", None)

    try:
        response = await auth_client.get(signed_url)
    finally:
        if original_header:
            auth_client.headers["Authorization"] = original_header

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_pose_image_local_storage_path(
    auth_client: AsyncClient,
    db_session,
    tmp_path,
):
    result = await db_session.execute(select(User))
    user = result.scalar_one()
    pose = await _create_pose(
        db_session,
        user.id,
        schema_path="/storage/uploads/test.png",
        code="IMG10",
    )

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    file_path = uploads_dir / "test.png"
    file_path.write_bytes(b"png-bytes")

    local_storage = LocalStorage.get_instance()
    original_base_dir = local_storage.base_dir
    local_storage.base_dir = tmp_path

    try:
        with patch("api.routes.poses.get_storage", return_value=local_storage):
            response = await auth_client.get(
                f"/api/poses/{pose.id}/image/schema"
            )
    finally:
        local_storage.base_dir = original_base_dir

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["cache-control"] == "private, max-age=86400"
