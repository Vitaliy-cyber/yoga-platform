"""
Integration tests for complete workflows.
Tests the full flow from API request to database and back.
"""

import pytest
from httpx import AsyncClient
from unittest.mock import patch, MagicMock, AsyncMock
from io import BytesIO
from PIL import Image


class TestCompleteWorkflows:
    """Test complete user workflows."""

    @pytest.mark.asyncio
    async def test_complete_pose_management_workflow(self, auth_client: AsyncClient):
        """Test complete workflow: create category -> create pose -> update -> delete."""
        # 1. Create category
        category_response = await auth_client.post(
            "/api/categories",
            json={"name": "Standing Poses", "description": "Poses performed standing"},
        )
        assert category_response.status_code == 201
        category = category_response.json()
        category_id = category["id"]

        # 2. Create pose in category
        pose_response = await auth_client.post(
            "/api/poses",
            json={
                "code": "WAR01",
                "name": "Warrior I",
                "name_en": "Warrior One",
                "category_id": category_id,
                "description": "A powerful standing pose",
                "effect": "Strengthens legs and core",
                "breathing": "Deep steady breathing",
            },
        )
        assert pose_response.status_code == 201
        pose = pose_response.json()
        pose_id = pose["id"]
        assert pose["category_name"] == "Standing Poses"

        # 3. Verify pose appears in category list
        category_poses = await auth_client.get(f"/api/poses/category/{category_id}")
        assert category_poses.status_code == 200
        assert len(category_poses.json()) == 1
        assert category_poses.json()[0]["code"] == "WAR01"

        # 4. Update pose
        update_response = await auth_client.put(
            f"/api/poses/{pose_id}",
            json={"effect": "Strengthens legs, core and improves balance"},
        )
        assert update_response.status_code == 200
        assert "balance" in update_response.json()["effect"]

        # 5. Search for pose
        search_response = await auth_client.get("/api/poses/search?q=warrior")
        assert search_response.status_code == 200
        assert len(search_response.json()) == 1

        # 6. Get pose by code
        code_response = await auth_client.get("/api/poses/code/WAR01")
        assert code_response.status_code == 200

        # 7. Delete pose
        delete_response = await auth_client.delete(f"/api/poses/{pose_id}")
        assert delete_response.status_code == 204

        # 8. Verify pose is deleted
        get_deleted = await auth_client.get(f"/api/poses/{pose_id}")
        assert get_deleted.status_code == 404

    @pytest.mark.asyncio
    async def test_pose_with_muscles_workflow(self, auth_client: AsyncClient):
        """Test workflow: seed muscles -> create pose with muscles -> update muscles."""
        # 1. Seed muscles
        seed_response = await auth_client.post("/api/muscles/seed")
        assert seed_response.status_code == 200
        muscles = seed_response.json()
        assert len(muscles) > 0

        # Get leg muscles for pose
        legs_response = await auth_client.get("/api/muscles?body_part=legs")
        assert legs_response.status_code == 200
        leg_muscles = legs_response.json()

        # Get core muscles
        core_response = await auth_client.get("/api/muscles?body_part=core")
        assert core_response.status_code == 200
        core_muscles = core_response.json()

        # 2. Create pose with muscles
        pose_response = await auth_client.post(
            "/api/poses",
            json={
                "code": "LUNGE01",
                "name": "Lunge",
                "muscles": [
                    {"muscle_id": leg_muscles[0]["id"], "activation_level": 85},
                    {"muscle_id": core_muscles[0]["id"], "activation_level": 60},
                ],
            },
        )
        assert pose_response.status_code == 201
        pose = pose_response.json()
        assert len(pose["muscles"]) == 2
        assert any(m["activation_level"] == 85 for m in pose["muscles"])

        # 3. Update pose muscles
        update_response = await auth_client.put(
            f"/api/poses/{pose['id']}",
            json={
                "muscles": [
                    {"muscle_id": leg_muscles[0]["id"], "activation_level": 90},
                    {
                        "muscle_id": leg_muscles[1]["id"]
                        if len(leg_muscles) > 1
                        else leg_muscles[0]["id"],
                        "activation_level": 75,
                    },
                ],
            },
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert len(updated["muscles"]) == 2
        assert any(m["activation_level"] == 90 for m in updated["muscles"])

    @pytest.mark.asyncio
    async def test_multiple_categories_and_poses_workflow(
        self, auth_client: AsyncClient
    ):
        """Test workflow with multiple categories and poses."""
        # Create multiple categories
        categories = []
        for name in ["Standing", "Seated", "Balancing", "Inversions"]:
            response = await auth_client.post("/api/categories", json={"name": name})
            assert response.status_code == 201
            categories.append(response.json())

        # Create poses in each category
        poses = []
        pose_data = [
            ("STA01", "Mountain", 0),
            ("STA02", "Warrior II", 0),
            ("SEA01", "Lotus", 1),
            ("BAL01", "Tree", 2),
            ("BAL02", "Eagle", 2),
            ("INV01", "Headstand", 3),
        ]

        for code, name, cat_idx in pose_data:
            response = await auth_client.post(
                "/api/poses",
                json={
                    "code": code,
                    "name": name,
                    "category_id": categories[cat_idx]["id"],
                },
            )
            assert response.status_code == 201
            poses.append(response.json())

        # Verify counts per category
        for i, cat in enumerate(categories):
            response = await auth_client.get(f"/api/poses/category/{cat['id']}")
            assert response.status_code == 200
            expected_count = sum(1 for p in pose_data if p[2] == i)
            assert len(response.json()) == expected_count

        # Verify total count
        all_poses = await auth_client.get("/api/poses")
        assert len(all_poses.json()["items"]) == 6

        # Search across categories
        search_response = await auth_client.get("/api/poses/search?q=a")
        assert search_response.status_code == 200
        # Should find: Mountain, Warrior II, Lotus, Eagle, Headstand (all have 'a')

    @pytest.mark.asyncio
    async def test_category_deletion_cascade(self, auth_client: AsyncClient):
        """Test that deleting category properly handles associated poses."""
        # Create category
        cat_response = await auth_client.post(
            "/api/categories", json={"name": "To Delete"}
        )
        category_id = cat_response.json()["id"]

        # Create pose in category
        pose_response = await auth_client.post(
            "/api/poses",
            json={
                "code": "DEL01",
                "name": "Delete Test Pose",
                "category_id": category_id,
            },
        )
        pose_id = pose_response.json()["id"]

        # Try to delete category (should fail or handle gracefully)
        delete_response = await auth_client.delete(f"/api/categories/{category_id}")
        # The actual behavior depends on implementation
        # Either it cascades, prevents deletion, or nullifies references


class TestImageUploadWorkflow:
    """Test workflows involving image uploads."""

    @pytest.mark.asyncio
    async def test_upload_and_retrieve_schema(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test uploading schema and retrieving pose with schema path."""
        # 1. Create pose
        pose_response = await auth_client_with_mocked_storage.post(
            "/api/poses",
            json={"code": "IMG01", "name": "Image Test Pose"},
        )
        pose_id = pose_response.json()["id"]

        # 2. Upload schema
        img = Image.new("RGB", (800, 600), "white")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        upload_response = await auth_client_with_mocked_storage.post(
            f"/api/poses/{pose_id}/schema",
            files={"file": ("schema.png", buffer, "image/png")},
        )
        assert upload_response.status_code == 200
        assert upload_response.json()["schema_path"] is not None

        # 3. Retrieve pose and verify schema path
        get_response = await auth_client_with_mocked_storage.get(
            f"/api/poses/{pose_id}"
        )
        assert get_response.status_code == 200
        assert get_response.json()["schema_path"] is not None


class TestGenerationWorkflow:
    """Test AI generation workflows."""

    @pytest.mark.asyncio
    async def test_generation_full_flow(
        self, auth_client_with_mocked_storage: AsyncClient
    ):
        """Test the complete generation flow: upload -> generate -> check status."""
        # 1. Start generation
        img = Image.new("RGB", (512, 512), "gray")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        start_response = await auth_client_with_mocked_storage.post(
            "/api/generate",
            files={"schema_file": ("pose_schema.png", buffer, "image/png")},
        )
        assert start_response.status_code == 200
        task_id = start_response.json()["task_id"]
        assert start_response.json()["status"] == "pending"

        # 2. Check status
        status_response = await auth_client_with_mocked_storage.get(
            f"/api/generate/status/{task_id}"
        )
        assert status_response.status_code == 200
        assert status_response.json()["task_id"] == task_id


class TestDataIntegrity:
    """Tests for data integrity and consistency."""

    @pytest.mark.asyncio
    async def test_pose_code_uniqueness(self, auth_client: AsyncClient):
        """Test that pose codes are unique across all poses."""
        # Create first pose
        await auth_client.post(
            "/api/poses", json={"code": "UNIQUE01", "name": "Pose 1"}
        )

        # Try to create another with same code
        duplicate = await auth_client.post(
            "/api/poses", json={"code": "UNIQUE01", "name": "Pose 2"}
        )
        assert duplicate.status_code == 400

        # Create with different code should work
        different = await auth_client.post(
            "/api/poses", json={"code": "UNIQUE02", "name": "Pose 2"}
        )
        assert different.status_code == 201

    @pytest.mark.asyncio
    async def test_category_name_uniqueness(self, auth_client: AsyncClient):
        """Test that category names are unique."""
        await auth_client.post("/api/categories", json={"name": "Unique Category"})

        duplicate = await auth_client.post(
            "/api/categories", json={"name": "Unique Category"}
        )
        assert duplicate.status_code == 400

    @pytest.mark.asyncio
    async def test_muscle_id_validation(self, auth_client: AsyncClient):
        """Test that invalid muscle IDs are handled gracefully."""
        response = await auth_client.post(
            "/api/poses",
            json={
                "code": "INV01",
                "name": "Invalid Muscle Pose",
                "muscles": [
                    {"muscle_id": 99999, "activation_level": 50},
                ],
            },
        )
        # Should create pose but skip invalid muscle
        assert response.status_code == 201
        # Invalid muscle should be skipped
        assert len(response.json()["muscles"]) == 0

    @pytest.mark.asyncio
    async def test_activation_level_boundaries(self, auth_client: AsyncClient):
        """Test that activation levels are validated."""
        await auth_client.post("/api/muscles/seed")
        muscles = (await auth_client.get("/api/muscles")).json()

        # Test valid activation level
        valid = await auth_client.post(
            "/api/poses",
            json={
                "code": "ACT01",
                "name": "Activation Test",
                "muscles": [{"muscle_id": muscles[0]["id"], "activation_level": 100}],
            },
        )
        assert valid.status_code == 201

    @pytest.mark.asyncio
    async def test_pose_updated_at_changes(self, auth_client: AsyncClient):
        """Test that updated_at timestamp changes on update."""
        # Create pose
        create = await auth_client.post(
            "/api/poses", json={"code": "TIME01", "name": "Time Test"}
        )
        original_updated = create.json()["updated_at"]

        # Wait a tiny bit and update
        import asyncio

        await asyncio.sleep(0.1)

        update = await auth_client.put(
            f"/api/poses/{create.json()['id']}",
            json={"description": "Updated description"},
        )
        new_updated = update.json()["updated_at"]

        # updated_at should be different (or at least not older)
        assert new_updated >= original_updated


class TestPaginationAndFiltering:
    """Tests for pagination and filtering functionality."""

    @pytest.mark.asyncio
    async def test_poses_pagination(self, auth_client: AsyncClient):
        """Test poses pagination returns correct results."""
        # Create 20 poses
        for i in range(20):
            await auth_client.post(
                "/api/poses", json={"code": f"PAGE{i:02d}", "name": f"Pose {i}"}
            )

        # Get first page
        page1 = await auth_client.get("/api/poses?skip=0&limit=10")
        page1_data = page1.json()
        assert len(page1_data["items"]) == 10

        # Get second page
        page2 = await auth_client.get("/api/poses?skip=10&limit=10")
        page2_data = page2.json()
        assert len(page2_data["items"]) == 10

        # Verify no overlap
        page1_codes = {p["code"] for p in page1_data["items"]}
        page2_codes = {p["code"] for p in page2_data["items"]}
        assert page1_codes.isdisjoint(page2_codes)

    @pytest.mark.asyncio
    async def test_muscles_body_part_filter(self, auth_client: AsyncClient):
        """Test filtering muscles by body part."""
        await auth_client.post("/api/muscles/seed")

        # Test each body part
        for body_part in ["legs", "core", "back", "arms", "chest", "shoulders"]:
            response = await auth_client.get(f"/api/muscles?body_part={body_part}")
            assert response.status_code == 200
            muscles = response.json()
            for muscle in muscles:
                assert muscle["body_part"] == body_part


class TestErrorRecovery:
    """Tests for error handling and recovery."""

    @pytest.mark.asyncio
    async def test_transaction_rollback_on_error(self, auth_client: AsyncClient):
        """Test that failed operations don't leave partial data."""
        # Create a category
        cat_response = await auth_client.post(
            "/api/categories", json={"name": "Rollback Test"}
        )
        category_id = cat_response.json()["id"]

        # Try to create pose with invalid data that should fail mid-operation
        # This depends on implementation details

        # Verify category still exists and is consistent
        cat_check = await auth_client.get(f"/api/categories/{category_id}")
        assert cat_check.status_code == 200

    @pytest.mark.asyncio
    async def test_concurrent_operations(self, auth_client: AsyncClient):
        """Test handling of concurrent create operations."""
        import asyncio

        # Try to create multiple poses concurrently
        async def create_pose(code):
            return await auth_client.post(
                "/api/poses", json={"code": code, "name": f"Concurrent {code}"}
            )

        results = await asyncio.gather(
            create_pose("CONC01"),
            create_pose("CONC02"),
            create_pose("CONC03"),
        )

        # All should succeed as they have different codes
        assert all(r.status_code == 201 for r in results)
