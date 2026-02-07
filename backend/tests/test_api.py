"""
Comprehensive API tests for all endpoints.
"""

import pytest
from httpx import AsyncClient
from unittest.mock import patch, MagicMock, AsyncMock
from io import BytesIO
from PIL import Image


# Root endpoints are public; use unauthenticated client


# ============== Root & Health Endpoints ==============


class TestRootEndpoints:
    """Tests for root and health endpoints."""

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """Test health check endpoint returns healthy status."""
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "mode" in data
        assert "ai_enabled" in data

    @pytest.mark.asyncio
    async def test_root_endpoint(self, client: AsyncClient):
        """Test root endpoint returns API info."""
        response = await client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Yoga Pose Platform API"
        assert "version" in data
        assert "docs" in data

    @pytest.mark.asyncio
    async def test_api_info_endpoint(self, client: AsyncClient):
        """Test API info endpoint."""
        response = await client.get("/api/info")
        assert response.status_code == 200
        data = response.json()
        assert "features" in data
        assert "endpoints" in data
        assert data["features"]["pose_management"] is True


# ============== Categories API ==============


class TestCategoriesAPI:
    """Tests for categories endpoints."""

    @pytest.mark.asyncio
    async def test_get_categories_empty(self, auth_client: AsyncClient):
        """Test getting categories when database is empty."""
        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_create_category_success(self, auth_client: AsyncClient):
        """Test creating a new category."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "Standing Poses", "description": "Poses performed standing"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Standing Poses"
        assert data["description"] == "Poses performed standing"
        assert "id" in data
        assert "created_at" in data

    @pytest.mark.asyncio
    async def test_create_category_without_description(self, auth_client: AsyncClient):
        """Test creating category without optional description."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "Balancing"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Balancing"
        assert data["description"] is None

    @pytest.mark.asyncio
    async def test_create_category_duplicate_name(self, auth_client: AsyncClient):
        """Test creating category with duplicate name fails."""
        await auth_client.post("/api/categories", json={"name": "Unique Name"})
        response = await auth_client.post(
            "/api/categories", json={"name": "Unique Name"}
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_category_empty_name(self, auth_client: AsyncClient):
        """Test creating category with empty name fails validation."""
        response = await auth_client.post("/api/categories", json={"name": ""})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_category_by_id(self, auth_client: AsyncClient):
        """Test getting a category by ID."""
        create_response = await auth_client.post(
            "/api/categories", json={"name": "Test Category"}
        )
        category_id = create_response.json()["id"]

        response = await auth_client.get(f"/api/categories/{category_id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Test Category"

    @pytest.mark.asyncio
    async def test_get_category_not_found(self, auth_client: AsyncClient):
        """Test getting non-existent category returns 404."""
        response = await auth_client.get("/api/categories/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_category(self, auth_client: AsyncClient):
        """Test updating a category."""
        create_response = await auth_client.post(
            "/api/categories", json={"name": "Original Name"}
        )
        category_id = create_response.json()["id"]

        response = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "Updated Name", "description": "New description"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "New description"

    @pytest.mark.asyncio
    async def test_delete_category(self, auth_client: AsyncClient):
        """Test deleting a category."""
        create_response = await auth_client.post(
            "/api/categories", json={"name": "To Delete"}
        )
        category_id = create_response.json()["id"]

        response = await auth_client.delete(f"/api/categories/{category_id}")
        assert response.status_code == 204

        # Verify deleted
        get_response = await auth_client.get(f"/api/categories/{category_id}")
        assert get_response.status_code == 404


# ============== Poses API ==============


class TestPosesAPI:
    """Tests for poses endpoints."""

    @pytest.mark.asyncio
    async def test_get_poses_empty(self, auth_client: AsyncClient):
        """Test getting poses when database is empty."""
        response = await auth_client.get("/api/poses")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["skip"] == 0
        assert data["limit"] == 100

    @pytest.mark.asyncio
    async def test_create_pose_minimal(self, auth_client: AsyncClient):
        """Test creating a pose with minimal required fields."""
        response = await auth_client.post(
            "/api/poses",
            json={"code": "TST01", "name": "Test Pose"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["code"] == "TST01"
        assert data["name"] == "Test Pose"

    @pytest.mark.asyncio
    async def test_create_pose_full(self, auth_client: AsyncClient):
        """Test creating a pose with all fields."""
        # Create category first
        cat_response = await auth_client.post(
            "/api/categories", json={"name": "Test Category"}
        )
        category_id = cat_response.json()["id"]

        response = await auth_client.post(
            "/api/poses",
            json={
                "code": "WAR01",
                "name": "Воїн I",
                "name_en": "Warrior I",
                "category_id": category_id,
                "description": "Базова поза воїна",
                "effect": "Зміцнює ноги та спину",
                "breathing": "Глибоке дихання",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["code"] == "WAR01"
        assert data["name"] == "Воїн I"
        assert data["name_en"] == "Warrior I"
        assert data["category_id"] == category_id
        assert data["category_name"] == "Test Category"

    @pytest.mark.asyncio
    async def test_create_pose_duplicate_code(self, auth_client: AsyncClient):
        """Test creating pose with duplicate code fails."""
        await auth_client.post(
            "/api/poses", json={"code": "DUP01", "name": "First Pose"}
        )
        response = await auth_client.post(
            "/api/poses", json={"code": "DUP01", "name": "Second Pose"}
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_pose_invalid_category(self, auth_client: AsyncClient):
        """Test creating pose with non-existent category fails."""
        response = await auth_client.post(
            "/api/poses",
            json={"code": "INV01", "name": "Invalid", "category_id": 99999},
        )
        assert response.status_code == 400
        assert "Category not found" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_get_pose_by_id(self, auth_client: AsyncClient):
        """Test getting a pose by ID."""
        create_response = await auth_client.post(
            "/api/poses", json={"code": "GET01", "name": "Get Pose"}
        )
        pose_id = create_response.json()["id"]

        response = await auth_client.get(f"/api/poses/{pose_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["code"] == "GET01"
        assert "muscles" in data

    @pytest.mark.asyncio
    async def test_get_pose_by_code(self, auth_client: AsyncClient):
        """Test getting a pose by code."""
        await auth_client.post(
            "/api/poses", json={"code": "COD01", "name": "Code Pose"}
        )

        response = await auth_client.get("/api/poses/code/COD01")
        assert response.status_code == 200
        assert response.json()["code"] == "COD01"

    @pytest.mark.asyncio
    async def test_get_pose_not_found(self, auth_client: AsyncClient):
        """Test getting non-existent pose returns 404."""
        response = await auth_client.get("/api/poses/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_search_poses(self, auth_client: AsyncClient):
        """Test searching poses by name."""
        await auth_client.post(
            "/api/poses", json={"code": "WAR01", "name": "Warrior One"}
        )
        await auth_client.post(
            "/api/poses", json={"code": "WAR02", "name": "Warrior Two"}
        )
        await auth_client.post("/api/poses", json={"code": "MNT01", "name": "Mountain"})

        response = await auth_client.get("/api/poses/search?q=warrior")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert all("warrior" in p["name"].lower() for p in data)

    @pytest.mark.asyncio
    async def test_search_poses_by_code(self, auth_client: AsyncClient):
        """Test searching poses by code."""
        await auth_client.post("/api/poses", json={"code": "ABC01", "name": "Pose A"})
        await auth_client.post("/api/poses", json={"code": "ABC02", "name": "Pose B"})
        await auth_client.post("/api/poses", json={"code": "XYZ01", "name": "Pose C"})

        response = await auth_client.get("/api/poses/search?q=ABC")
        assert response.status_code == 200
        assert len(response.json()) == 2

    @pytest.mark.asyncio
    async def test_search_poses_empty_query(self, auth_client: AsyncClient):
        """Test search with empty query fails validation."""
        response = await auth_client.get("/api/poses/search?q=")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_poses_by_category(self, auth_client: AsyncClient):
        """Test getting poses filtered by category."""
        # Create categories
        cat1_response = await auth_client.post(
            "/api/categories", json={"name": "Cat 1"}
        )
        cat2_response = await auth_client.post(
            "/api/categories", json={"name": "Cat 2"}
        )
        cat1_id = cat1_response.json()["id"]
        cat2_id = cat2_response.json()["id"]

        # Create poses in different categories
        await auth_client.post(
            "/api/poses",
            json={"code": "C1P1", "name": "Cat1 Pose", "category_id": cat1_id},
        )
        await auth_client.post(
            "/api/poses",
            json={"code": "C2P1", "name": "Cat2 Pose", "category_id": cat2_id},
        )

        # Get poses for category 1
        response = await auth_client.get(f"/api/poses/category/{cat1_id}")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["code"] == "C1P1"

    @pytest.mark.asyncio
    async def test_get_poses_pagination(self, auth_client: AsyncClient):
        """Test poses pagination."""
        # Create multiple poses
        for i in range(15):
            await auth_client.post(
                "/api/poses", json={"code": f"PAG{i:02d}", "name": f"Pose {i}"}
            )

        # Test default pagination
        response = await auth_client.get("/api/poses")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 15
        assert data["total"] == 15

        # Test with limit
        response = await auth_client.get("/api/poses?limit=5")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 5
        assert data["total"] == 15

        # Test with skip
        response = await auth_client.get("/api/poses?skip=10&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 5
        assert data["total"] == 15

    @pytest.mark.asyncio
    async def test_update_pose(self, auth_client: AsyncClient):
        """Test updating a pose."""
        create_response = await auth_client.post(
            "/api/poses", json={"code": "UPD01", "name": "Original"}
        )
        pose_id = create_response.json()["id"]

        response = await auth_client.put(
            f"/api/poses/{pose_id}",
            json={"name": "Updated Name", "description": "New description"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "New description"
        assert data["code"] == "UPD01"  # Code unchanged

    @pytest.mark.asyncio
    async def test_delete_pose(self, auth_client: AsyncClient):
        """Test deleting a pose."""
        create_response = await auth_client.post(
            "/api/poses", json={"code": "DEL01", "name": "To Delete"}
        )
        pose_id = create_response.json()["id"]

        response = await auth_client.delete(f"/api/poses/{pose_id}")
        assert response.status_code == 204

        # Verify deleted
        get_response = await auth_client.get(f"/api/poses/{pose_id}")
        assert get_response.status_code == 404


# ============== Pose Schema Upload ==============


class TestPoseSchemaUpload:
    """Tests for pose schema upload endpoint."""

    @pytest.mark.asyncio
    async def test_upload_schema_success(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test successful schema upload."""
        # Create pose
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH01", "name": "Schema Pose"}
        )
        pose_id = create_response.json()["id"]

        # Create test image
        img = Image.new("RGB", (100, 100), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        # Upload schema
        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("test.png", buffer, "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schema_path"] is not None
        assert "s3.amazonaws.com" in data["schema_path"]

    @pytest.mark.asyncio
    async def test_upload_schema_pose_not_found(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test uploading schema for non-existent pose."""
        img = Image.new("RGB", (100, 100), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/poses/99999/schema",
            files={"file": ("test.png", buffer, "image/png")},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_upload_schema_accepts_octet_stream_when_bytes_are_valid(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH02", "name": "Schema Pose Octet"}
        )
        pose_id = create_response.json()["id"]

        img = Image.new("RGB", (128, 128), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("test.bin", buffer, "application/octet-stream")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schema_path"] is not None

    @pytest.mark.asyncio
    async def test_upload_schema_rejects_too_small_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH03", "name": "Too Small Schema Pose"}
        )
        pose_id = create_response.json()["id"]

        img = Image.new("RGB", (1, 1), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("tiny.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "too small" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_upload_schema_accepts_content_type_with_parameters(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH04", "name": "Schema MIME Parameters"}
        )
        pose_id = create_response.json()["id"]

        img = Image.new("RGB", (128, 128), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("test.png", buffer, "image/png; charset=binary")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_upload_schema_accepts_image_x_png_alias(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH05", "name": "Schema X-PNG"}
        )
        pose_id = create_response.json()["id"]

        img = Image.new("RGB", (128, 128), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("test.png", buffer, "image/x-png")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_upload_schema_rejects_extreme_aspect_ratio(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        create_response = await auth_client_with_mocked_storage.post(
            "/api/poses", json={"code": "SCH06", "name": "Schema Extreme Aspect"}
        )
        pose_id = create_response.json()["id"]

        img = Image.new("RGB", (2048, 64), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("wide.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "aspect ratio" in response.json()["detail"].lower()


# ============== Muscles API ==============


class TestMusclesAPI:
    """Tests for muscles endpoints."""

    @pytest.mark.asyncio
    async def test_get_muscles_empty(self, auth_client: AsyncClient):
        """Test getting muscles when database is empty."""
        response = await auth_client.get("/api/muscles")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_seed_muscles(self, auth_client: AsyncClient):
        """Test seeding default muscles."""
        response = await auth_client.post("/api/muscles/seed")
        assert response.status_code == 200
        data = response.json()
        assert len(data) > 0
        assert all("name" in m for m in data)
        assert all("body_part" in m for m in data)

    @pytest.mark.asyncio
    async def test_seed_muscles_idempotent(self, auth_client: AsyncClient):
        """Test that seeding muscles is idempotent."""
        response1 = await auth_client.post("/api/muscles/seed")
        count1 = len(response1.json())

        response2 = await auth_client.post("/api/muscles/seed")
        count2 = len(response2.json())

        assert count1 == count2

    @pytest.mark.asyncio
    async def test_get_muscles_by_body_part(self, auth_client: AsyncClient):
        """Test filtering muscles by body part."""
        await auth_client.post("/api/muscles/seed")

        response = await auth_client.get("/api/muscles?body_part=legs")
        assert response.status_code == 200
        data = response.json()
        assert all(m["body_part"] == "legs" for m in data)

    @pytest.mark.asyncio
    async def test_get_muscle_by_id(self, auth_client: AsyncClient):
        """Test getting a muscle by ID."""
        seed_response = await auth_client.post("/api/muscles/seed")
        muscle_id = seed_response.json()[0]["id"]

        response = await auth_client.get(f"/api/muscles/{muscle_id}")
        assert response.status_code == 200
        assert "name" in response.json()

    @pytest.mark.asyncio
    async def test_get_muscle_not_found(self, auth_client: AsyncClient):
        """Test getting non-existent muscle returns 404."""
        response = await auth_client.get("/api/muscles/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_muscle_mutation_routes_blocked_in_prod_mode(self, auth_client: AsyncClient):
        """Mutating global muscles dictionary must be blocked in production."""
        from api.routes import muscles as muscles_routes
        from config import AppMode

        previous_mode = muscles_routes.settings.APP_MODE
        muscles_routes.settings.APP_MODE = AppMode.PROD
        try:
            create_resp = await auth_client.post(
                "/api/muscles",
                json={
                    "name": "test_muscle",
                    "name_ua": "Тестовий м'яз",
                    "body_part": "core",
                },
            )
            assert create_resp.status_code == 403

            seed_resp = await auth_client.post("/api/muscles/seed")
            assert seed_resp.status_code == 403
        finally:
            muscles_routes.settings.APP_MODE = previous_mode


# ============== Sequences API ==============


class TestSequencesAPI:
    """Tests for sequence endpoints."""

    @pytest.mark.asyncio
    async def test_create_sequence_with_multiple_poses(self, auth_client: AsyncClient):
        pose_1 = await auth_client.post(
            "/api/poses",
            json={"code": "SQA001", "name": "Seq Pose 1"},
        )
        pose_2 = await auth_client.post(
            "/api/poses",
            json={"code": "SQA002", "name": "Seq Pose 2"},
        )
        assert pose_1.status_code == 201
        assert pose_2.status_code == 201

        response = await auth_client.post(
            "/api/sequences",
            json={
                "name": "Morning Flow",
                "description": "Test flow",
                "poses": [
                    {"pose_id": pose_1.json()["id"], "order_index": 0, "duration_seconds": 30},
                    {"pose_id": pose_2.json()["id"], "order_index": 1, "duration_seconds": 45},
                ],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Morning Flow"
        assert len(data["poses"]) == 2

    @pytest.mark.asyncio
    async def test_create_sequence_rejects_missing_pose_ids(self, auth_client: AsyncClient):
        response = await auth_client.post(
            "/api/sequences",
            json={
                "name": "Broken Flow",
                "poses": [{"pose_id": 999999, "order_index": 0, "duration_seconds": 30}],
            },
        )
        assert response.status_code == 400
        assert "not found" in response.json()["detail"].lower()


# ============== Generate API ==============


class TestGenerateAPI:
    """Tests for generation endpoints."""

    @pytest.mark.asyncio
    async def test_generate_invalid_file_type(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test generation with invalid file type fails."""
        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 400
        assert "Invalid file type" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_generate_valid_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test generation with valid image starts task."""
        img = Image.new("RGB", (100, 100), "blue")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.png", buffer, "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "pending"
        assert data["progress"] == 0

    @pytest.mark.asyncio
    async def test_generate_jpeg_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test generation accepts JPEG images."""
        img = Image.new("RGB", (100, 100), "green")
        buffer = BytesIO()
        img.save(buffer, format="JPEG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.jpg", buffer, "image/jpeg")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_accepts_octet_stream_when_bytes_are_valid_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (128, 128), "purple")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.bin", buffer, "application/octet-stream")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_rejects_too_small_schema_image(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (1, 1), "white")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("tiny.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "too small" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_generate_accepts_content_type_with_parameters(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (128, 128), "green")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.png", buffer, "image/png; charset=binary")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_accepts_image_pjpeg_alias(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (128, 128), "green")
        buffer = BytesIO()
        img.save(buffer, format="JPEG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.jpg", buffer, "image/pjpeg")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_accepts_image_x_png_alias(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (128, 128), "green")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.png", buffer, "image/x-png")},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_rejects_extreme_aspect_ratio_schema(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        img = Image.new("RGB", (2048, 64), "green")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("wide.png", buffer, "image/png")},
        )
        assert response.status_code == 400
        assert "aspect ratio" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_get_generation_status_not_found(self, auth_client: AsyncClient):
        """Test getting status for non-existent task."""
        response = await auth_client.get("/api/generate/status/non-existent-task-id")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_generation_status_success(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test getting status for existing task."""
        # Start generation
        img = Image.new("RGB", (100, 100), "red")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        start_response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("test.png", buffer, "image/png")},
        )
        task_id = start_response.json()["task_id"]

        # Check status
        response = await auth_client_with_mocked_storage.get(
            f"/api/generate/status/{task_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == task_id
        assert "status" in data
        assert "progress" in data


# ============== Pose with Muscles ==============


class TestPoseWithMuscles:
    """Tests for poses with muscle associations."""

    @pytest.mark.asyncio
    async def test_create_pose_with_muscles(self, auth_client: AsyncClient):
        """Test creating a pose with muscle associations."""
        # Seed muscles first
        await auth_client.post("/api/muscles/seed")
        muscles_response = await auth_client.get("/api/muscles")
        muscles = muscles_response.json()

        # Create pose with muscles
        response = await auth_client.post(
            "/api/poses",
            json={
                "code": "MUS01",
                "name": "Muscular Pose",
                "muscles": [
                    {"muscle_id": muscles[0]["id"], "activation_level": 80},
                    {"muscle_id": muscles[1]["id"], "activation_level": 60},
                ],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert len(data["muscles"]) == 2
        assert data["muscles"][0]["activation_level"] == 80

    @pytest.mark.asyncio
    async def test_update_pose_muscles(self, auth_client: AsyncClient):
        """Test updating pose muscle associations."""
        # Seed muscles
        await auth_client.post("/api/muscles/seed")
        muscles_response = await auth_client.get("/api/muscles")
        muscles = muscles_response.json()

        # Create pose
        create_response = await auth_client.post(
            "/api/poses",
            json={
                "code": "UPM01",
                "name": "Update Muscles Pose",
                "muscles": [{"muscle_id": muscles[0]["id"], "activation_level": 50}],
            },
        )
        pose_id = create_response.json()["id"]

        # Update with new muscles
        response = await auth_client.put(
            f"/api/poses/{pose_id}",
            json={
                "muscles": [
                    {"muscle_id": muscles[1]["id"], "activation_level": 90},
                    {"muscle_id": muscles[2]["id"], "activation_level": 70},
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["muscles"]) == 2
        assert data["muscles"][0]["activation_level"] == 90


# ============== Edge Cases & Error Handling ==============


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_unicode_in_pose_name(self, auth_client: AsyncClient):
        """Test handling of unicode characters in pose names."""
        response = await auth_client.post(
            "/api/poses",
            json={
                "code": "UNI01",
                "name": "Поза Воїна",
                "name_en": "Warrior Pose",
                "description": "Зміцнює м'язи ніг та корпусу",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Поза Воїна"

    @pytest.mark.asyncio
    async def test_long_description(self, auth_client: AsyncClient):
        """Test handling of long description text."""
        long_text = "A" * 5000
        response = await auth_client.post(
            "/api/poses",
            json={"code": "LNG01", "name": "Long Desc Pose", "description": long_text},
        )
        assert response.status_code == 201
        assert len(response.json()["description"]) == 5000

    @pytest.mark.asyncio
    async def test_special_characters_in_code(self, auth_client: AsyncClient):
        """Test pose codes handle special characters appropriately."""
        response = await auth_client.post(
            "/api/poses",
            json={"code": "TEST-01_V2", "name": "Special Code Pose"},
        )
        assert response.status_code == 201
        assert response.json()["code"] == "TEST-01_V2"

    @pytest.mark.asyncio
    async def test_concurrent_category_creation(self, auth_client: AsyncClient):
        """Test that duplicate detection works under concurrent creation."""
        # Create first
        response1 = await auth_client.post(
            "/api/categories", json={"name": "Concurrent Test"}
        )
        assert response1.status_code == 201

        # Try to create duplicate
        response2 = await auth_client.post(
            "/api/categories", json={"name": "Concurrent Test"}
        )
        assert response2.status_code == 400

    @pytest.mark.asyncio
    async def test_invalid_json_body(self, auth_client: AsyncClient):
        """Test handling of invalid JSON in request body."""
        response = await auth_client.post(
            "/api/categories",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_required_field(self, auth_client: AsyncClient):
        """Test validation error for missing required fields."""
        response = await auth_client.post("/api/poses", json={"code": "MISS01"})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_pagination_params(self, auth_client: AsyncClient):
        """Test validation of pagination parameters."""
        response = await auth_client.get("/api/poses?skip=-1")
        assert response.status_code == 422

        response = await auth_client.get("/api/poses?limit=0")
        assert response.status_code == 422

        response = await auth_client.get("/api/poses?limit=1000")
        assert response.status_code == 422
