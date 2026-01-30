"""
Tests for authentication endpoints and services.
"""

import pytest
from httpx import AsyncClient
from datetime import timedelta
from unittest.mock import patch, MagicMock

from services.auth import create_access_token, verify_token


# ============== Auth Service Unit Tests ==============


class TestAuthService:
    """Unit tests for auth service functions."""

    def test_create_access_token(self):
        """Test creating a valid JWT token."""
        user_id = 123
        token = create_access_token(user_id)

        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_access_token_with_custom_expiry(self):
        """Test creating token with custom expiration."""
        user_id = 456
        token = create_access_token(user_id, expires_delta=timedelta(hours=1))

        assert token is not None
        # Token should be verifiable
        verified_id = verify_token(token)
        assert verified_id == user_id

    def test_verify_valid_token(self):
        """Test verifying a valid token returns user_id."""
        user_id = 789
        token = create_access_token(user_id)

        verified_id = verify_token(token)
        assert verified_id == user_id

    def test_verify_invalid_token(self):
        """Test verifying an invalid token returns None."""
        invalid_token = "invalid.jwt.token"
        result = verify_token(invalid_token)
        assert result is None

    def test_verify_expired_token(self):
        """Test verifying an expired token returns None."""
        user_id = 999
        # Create token that expires immediately
        token = create_access_token(user_id, expires_delta=timedelta(seconds=-1))

        result = verify_token(token)
        assert result is None

    def test_verify_tampered_token(self):
        """Test verifying a tampered token returns None."""
        user_id = 111
        token = create_access_token(user_id)

        # Tamper with the token
        tampered_token = token[:-5] + "XXXXX"

        result = verify_token(tampered_token)
        assert result is None

    def test_verify_empty_token(self):
        """Test verifying an empty token returns None."""
        result = verify_token("")
        assert result is None


# ============== Auth API Endpoint Tests ==============


class TestAuthAPI:
    """Tests for authentication endpoints."""

    @pytest.mark.asyncio
    async def test_login_creates_new_user(self, client: AsyncClient):
        """Test login with new token creates a new user."""
        response = await client.post(
            "/api/auth/login",
            json={"token": "my-unique-token-123"},
        )
        assert response.status_code == 200
        data = response.json()

        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "user" in data
        assert data["user"]["token"] == "my-unique-token-123"

    @pytest.mark.asyncio
    async def test_login_returns_existing_user(self, client: AsyncClient):
        """Test login with existing token returns the same user."""
        token = "existing-user-token"

        # First login - creates user
        response1 = await client.post(
            "/api/auth/login",
            json={"token": token},
        )
        user_id_1 = response1.json()["user"]["id"]

        # Second login - returns same user
        response2 = await client.post(
            "/api/auth/login",
            json={"token": token},
        )
        user_id_2 = response2.json()["user"]["id"]

        assert user_id_1 == user_id_2

    @pytest.mark.asyncio
    async def test_login_empty_token_fails(self, client: AsyncClient):
        """Test login with empty token fails validation."""
        response = await client.post(
            "/api/auth/login",
            json={"token": ""},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_missing_token_fails(self, client: AsyncClient):
        """Test login without token field fails validation."""
        response = await client.post(
            "/api/auth/login",
            json={},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_login_too_long_token_fails(self, client: AsyncClient):
        """Test login with token exceeding max length fails."""
        long_token = "a" * 101  # Max is 100
        response = await client.post(
            "/api/auth/login",
            json={"token": long_token},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_me_authenticated(self, client: AsyncClient):
        """Test getting current user info when authenticated."""
        # Login first
        login_response = await client.post(
            "/api/auth/login",
            json={"token": "test-user-token"},
        )
        access_token = login_response.json()["access_token"]

        # Get current user
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["token"] == "test-user-token"

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, client: AsyncClient):
        """Test getting current user without authentication fails."""
        response = await client.get("/api/auth/me")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_me_invalid_token(self, client: AsyncClient):
        """Test getting current user with invalid token fails."""
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_update_me_name(self, client: AsyncClient):
        """Test updating current user's name."""
        # Login
        login_response = await client.post(
            "/api/auth/login",
            json={"token": "update-test-token"},
        )
        access_token = login_response.json()["access_token"]

        # Update name
        response = await client.put(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"name": "New Name"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"

        # Verify change persisted
        me_response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert me_response.json()["name"] == "New Name"

    @pytest.mark.asyncio
    async def test_update_me_unauthenticated(self, client: AsyncClient):
        """Test updating user without authentication fails."""
        response = await client.put(
            "/api/auth/me",
            json={"name": "Should Fail"},
        )
        assert response.status_code == 401


# ============== Protected Routes Tests ==============


class TestProtectedRoutes:
    """Tests for authentication on protected endpoints."""

    @pytest.mark.asyncio
    async def test_poses_require_auth(self, client: AsyncClient):
        """Test that poses endpoints require authentication."""
        # GET poses
        response = await client.get("/api/poses")
        assert response.status_code == 401

        # POST pose
        response = await client.post(
            "/api/poses",
            json={"code": "TST01", "name": "Test"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_categories_require_auth(self, client: AsyncClient):
        """Test that categories endpoints require authentication."""
        # GET categories
        response = await client.get("/api/categories")
        assert response.status_code == 401

        # POST category
        response = await client.post(
            "/api/categories",
            json={"name": "Test Category"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_poses_accessible_with_auth(self, client: AsyncClient):
        """Test that poses are accessible when authenticated."""
        # Login
        login_response = await client.post(
            "/api/auth/login",
            json={"token": "poses-access-token"},
        )
        access_token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # GET poses should work
        response = await client.get("/api/poses", headers=headers)
        assert response.status_code == 200

        # POST pose should work
        response = await client.post(
            "/api/poses",
            headers=headers,
            json={"code": "AUTH01", "name": "Authenticated Pose"},
        )
        assert response.status_code == 201

    @pytest.mark.asyncio
    async def test_categories_accessible_with_auth(self, client: AsyncClient):
        """Test that categories are accessible when authenticated."""
        # Login
        login_response = await client.post(
            "/api/auth/login",
            json={"token": "categories-access-token"},
        )
        access_token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # GET categories should work
        response = await client.get("/api/categories", headers=headers)
        assert response.status_code == 200

        # POST category should work
        response = await client.post(
            "/api/categories",
            headers=headers,
            json={"name": "Authenticated Category"},
        )
        assert response.status_code == 201


# ============== Data Isolation Tests ==============


class TestDataIsolation:
    """Tests for user data isolation."""

    @pytest.mark.asyncio
    async def test_users_see_only_their_poses(self, client: AsyncClient):
        """Test that users can only see their own poses."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "user-one-token"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "user-two-token"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a pose
        await client.post(
            "/api/poses",
            headers=headers1,
            json={"code": "U1P01", "name": "User 1 Pose"},
        )

        # User 2 creates a pose
        await client.post(
            "/api/poses",
            headers=headers2,
            json={"code": "U2P01", "name": "User 2 Pose"},
        )

        # User 1 should only see their pose
        response1 = await client.get("/api/poses", headers=headers1)
        poses1 = response1.json()["items"]
        assert len(poses1) == 1
        assert poses1[0]["code"] == "U1P01"

        # User 2 should only see their pose
        response2 = await client.get("/api/poses", headers=headers2)
        poses2 = response2.json()["items"]
        assert len(poses2) == 1
        assert poses2[0]["code"] == "U2P01"

    @pytest.mark.asyncio
    async def test_users_see_only_their_categories(self, client: AsyncClient):
        """Test that users can only see their own categories."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "cat-user-one"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "cat-user-two"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a category
        await client.post(
            "/api/categories",
            headers=headers1,
            json={"name": "User 1 Category"},
        )

        # User 2 creates a category
        await client.post(
            "/api/categories",
            headers=headers2,
            json={"name": "User 2 Category"},
        )

        # User 1 should only see their category
        response1 = await client.get("/api/categories", headers=headers1)
        cats1 = response1.json()
        assert len(cats1) == 1
        assert cats1[0]["name"] == "User 1 Category"

        # User 2 should only see their category
        response2 = await client.get("/api/categories", headers=headers2)
        cats2 = response2.json()
        assert len(cats2) == 1
        assert cats2[0]["name"] == "User 2 Category"

    @pytest.mark.asyncio
    async def test_user_cannot_access_others_pose(self, client: AsyncClient):
        """Test that user cannot access another user's pose by ID."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "owner-user"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "intruder-user"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a pose
        create_response = await client.post(
            "/api/poses",
            headers=headers1,
            json={"code": "PRIV01", "name": "Private Pose"},
        )
        pose_id = create_response.json()["id"]

        # User 2 tries to access user 1's pose
        response = await client.get(f"/api/poses/{pose_id}", headers=headers2)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_user_cannot_delete_others_pose(self, client: AsyncClient):
        """Test that user cannot delete another user's pose."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "pose-owner"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "pose-attacker"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a pose
        create_response = await client.post(
            "/api/poses",
            headers=headers1,
            json={"code": "NODELETE", "name": "Cannot Delete"},
        )
        pose_id = create_response.json()["id"]

        # User 2 tries to delete user 1's pose
        response = await client.delete(f"/api/poses/{pose_id}", headers=headers2)
        assert response.status_code == 404

        # Pose should still exist for user 1
        response = await client.get(f"/api/poses/{pose_id}", headers=headers1)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_user_cannot_update_others_category(self, client: AsyncClient):
        """Test that user cannot update another user's category."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "category-owner"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "category-attacker"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a category
        create_response = await client.post(
            "/api/categories",
            headers=headers1,
            json={"name": "Original Name"},
        )
        category_id = create_response.json()["id"]

        # User 2 tries to update user 1's category
        response = await client.put(
            f"/api/categories/{category_id}",
            headers=headers2,
            json={"name": "Hacked Name"},
        )
        assert response.status_code == 404

        # Category should be unchanged for user 1
        response = await client.get(f"/api/categories/{category_id}", headers=headers1)
        assert response.json()["name"] == "Original Name"

    @pytest.mark.asyncio
    async def test_same_code_allowed_for_different_users(self, client: AsyncClient):
        """Test that different users can use the same pose code."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "code-user-one"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "code-user-two"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a pose with code WAR01
        response1 = await client.post(
            "/api/poses",
            headers=headers1,
            json={"code": "WAR01", "name": "User 1 Warrior"},
        )
        assert response1.status_code == 201

        # User 2 can also create a pose with code WAR01
        response2 = await client.post(
            "/api/poses",
            headers=headers2,
            json={"code": "WAR01", "name": "User 2 Warrior"},
        )
        assert response2.status_code == 201

    @pytest.mark.asyncio
    async def test_search_only_finds_user_poses(self, client: AsyncClient):
        """Test that search only returns user's own poses."""
        # Login as user 1
        login1 = await client.post(
            "/api/auth/login",
            json={"token": "search-user-one"},
        )
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Login as user 2
        login2 = await client.post(
            "/api/auth/login",
            json={"token": "search-user-two"},
        )
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # User 1 creates a warrior pose
        await client.post(
            "/api/poses",
            headers=headers1,
            json={"code": "WAR01", "name": "Warrior One"},
        )

        # User 2 creates a warrior pose
        await client.post(
            "/api/poses",
            headers=headers2,
            json={"code": "WAR02", "name": "Warrior Two"},
        )

        # User 1 searches for "warrior" - should only find their pose
        response1 = await client.get(
            "/api/poses/search?q=warrior",
            headers=headers1,
        )
        results1 = response1.json()
        assert len(results1) == 1
        assert results1[0]["name"] == "Warrior One"

        # User 2 searches for "warrior" - should only find their pose
        response2 = await client.get(
            "/api/poses/search?q=warrior",
            headers=headers2,
        )
        results2 = response2.json()
        assert len(results2) == 1
        assert results2[0]["name"] == "Warrior Two"
