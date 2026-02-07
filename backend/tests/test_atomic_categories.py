"""
Atomic tests for category endpoints.

These focus on hardening invariants and data integrity edge cases.
"""

import json
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.exc import OperationalError
from unittest.mock import AsyncMock

from models.category import Category
from models.pose_version import PoseVersion
from models.user import User


class TestAtomicCategories:
    """Atomic tests for categories (no 5xx, integrity preserved)."""

    @pytest.mark.asyncio
    async def test_delete_category_nulls_pose_category(
        self, auth_client: AsyncClient
    ):
        """Deleting a category should nullify pose.category_id (no orphan refs)."""
        category_res = await auth_client.post(
            "/api/categories", json={"name": "Atomic Category"}
        )
        assert category_res.status_code == 201
        category_id = category_res.json()["id"]

        pose_res = await auth_client.post(
            "/api/poses",
            json={
                "code": "ATC01",
                "name": "Atomic Pose",
                "category_id": category_id,
            },
        )
        assert pose_res.status_code == 201
        pose_id = pose_res.json()["id"]

        delete_res = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete_res.status_code == 204

        pose_after = await auth_client.get(f"/api/poses/{pose_id}")
        assert pose_after.status_code == 200
        payload = pose_after.json()
        assert payload["category_id"] is None
        assert payload["category_name"] is None


class TestAtomicCategoryDeleteNullsAllPoses:
    """Atomic tests ensuring category deletion nulls category_id for all poses."""

    @pytest.mark.asyncio
    async def test_delete_category_nulls_all_related_poses(
        self, auth_client: AsyncClient
    ):
        """Deleting a category should nullify category_id for every pose in it."""
        category_res = await auth_client.post(
            "/api/categories", json={"name": "Atomic Bulk Null"}
        )
        assert category_res.status_code == 201
        category_id = category_res.json()["id"]

        pose_ids: list[int] = []
        for code in ("ATB01", "ATB02"):
            pose_res = await auth_client.post(
                "/api/poses",
                json={
                    "code": code,
                    "name": f"Atomic Pose {code}",
                    "category_id": category_id,
                },
            )
            assert pose_res.status_code == 201
            pose_ids.append(pose_res.json()["id"])

        delete_res = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete_res.status_code == 204

        # Ensure both poses were preserved and had their category nulled.
        poses_list = await auth_client.get("/api/poses", params={"limit": 200})
        assert poses_list.status_code == 200
        items = poses_list.json()["items"]
        by_id = {p["id"]: p for p in items if p["id"] in set(pose_ids)}
        assert set(by_id.keys()) == set(pose_ids)
        for pose_id in pose_ids:
            assert by_id[pose_id]["category_id"] is None
            assert by_id[pose_id]["category_name"] is None

    @pytest.mark.asyncio
    async def test_create_category_rejects_invalid_unicode(
        self, auth_client: AsyncClient
    ):
        """Invalid Unicode should be rejected with a 4xx (never 5xx)."""
        bad_payload = '{"name":"bad \\ud800"}'
        response = await auth_client.post(
            "/api/categories",
            content=bad_payload,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in (400, 422)


class TestAtomicCategoryCreateNameValidation:
    """Atomic tests for create name validation."""

    @pytest.mark.asyncio
    async def test_create_category_blank_name_returns_422(
        self, auth_client: AsyncClient
    ):
        """Blank/whitespace-only name should be rejected with validation error."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "   "},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_category_empty_name_returns_422(
        self, auth_client: AsyncClient
    ):
        """Empty-string name should be rejected with validation error."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": ""},
        )
        assert response.status_code == 422


class TestAtomicCategoryUpdates:
    """Atomic tests for category updates (no 5xx, integrity preserved)."""

    @pytest.mark.asyncio
    async def test_update_category_name_case_insensitive_unique(
        self, auth_client: AsyncClient
    ):
        """Updating to an existing name (case-insensitive) should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "Flow"})
        assert first.status_code == 201
        first_id = first.json()["id"]

        second = await auth_client.post("/api/categories", json={"name": "Balance"})
        assert second.status_code == 201
        second_id = second.json()["id"]

        # Attempt to rename second category to case-insensitive duplicate.
        update = await auth_client.put(
            f"/api/categories/{second_id}",
            json={"name": "flow"},
        )
        assert update.status_code == 400
        assert "already exists" in update.json()["detail"]


class TestAtomicCategoryUpdateTrimmedDuplicate:
    """Atomic tests for duplicates created via trimming on update."""

    @pytest.mark.asyncio
    async def test_update_category_to_trimmed_duplicate_rejected(
        self, auth_client: AsyncClient
    ):
        """Updating name to a whitespace-trimmed duplicate should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "Alpha"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "Beta"})
        assert second.status_code == 201
        second_id = second.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{second_id}",
            json={"name": "  Alpha  "},
        )
        assert update.status_code == 400
        assert "already exists" in update.json()["detail"]


class TestAtomicCategoryUpdateTrimAndCasefold:
    """Atomic tests for combined trimming + case-insensitive uniqueness on update."""

    @pytest.mark.asyncio
    async def test_update_category_to_trimmed_casefolded_duplicate_rejected(
        self, auth_client: AsyncClient
    ):
        """Updating to a trimmed, casefolded duplicate name should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "Alpha"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "Beta"})
        assert second.status_code == 201
        second_id = second.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{second_id}",
            json={"name": "  aLpHa  "},
        )
        assert update.status_code == 400
        assert "already exists" in update.json()["detail"]


class TestAtomicCategoryUpdateIdempotent:
    """Atomic tests for safe, idempotent updates."""

    @pytest.mark.asyncio
    async def test_update_category_same_name_preserves_created_at(
        self, auth_client: AsyncClient
    ):
        """Updating with the same name should succeed and keep created_at."""
        create = await auth_client.post("/api/categories", json={"name": "Stable"})
        assert create.status_code == 201
        category_id = create.json()["id"]
        created_at = create.json()["created_at"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "Stable"},
        )
        assert update.status_code == 200
        assert update.json()["name"] == "Stable"
        assert update.json()["created_at"] == created_at


class TestAtomicCategoryUpdateIgnoresExtraFields:
    """Atomic tests ensuring unexpected fields cannot be used to mutate state."""

    @pytest.mark.asyncio
    async def test_update_category_ignores_extra_fields(
        self, auth_client: AsyncClient
    ):
        """Extra fields in update payload should be ignored (no privilege escalation)."""
        create = await auth_client.post(
            "/api/categories", json={"name": "ExtraFields"}
        )
        assert create.status_code == 201
        category_id = create.json()["id"]
        created_at = create.json()["created_at"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={
                "name": "ExtraFields2",
                # These should be ignored by schema validation / model dump.
                "id": 999999,
                "created_at": "2000-01-01T00:00:00Z",
                "pose_count": 999,
            },
        )
        assert update.status_code == 200
        payload = update.json()
        assert payload["id"] == category_id
        assert payload["name"] == "ExtraFields2"
        assert payload["created_at"] == created_at
        assert payload["pose_count"] == 0


class TestAtomicCategoryNormalization:
    """Atomic tests for category field normalization."""

    @pytest.mark.asyncio
    async def test_update_category_blank_description_becomes_none(
        self, auth_client: AsyncClient
    ):
        """Whitespace-only description should normalize to null, never 5xx."""
        create = await auth_client.post(
            "/api/categories",
            json={"name": "Normalize Me", "description": "has text"},
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"description": "   "},
        )
        assert update.status_code == 200
        assert update.json()["description"] is None


class TestAtomicCategoryNotFound:
    """Atomic tests for missing category handling."""

    @pytest.mark.asyncio
    async def test_delete_missing_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Deleting a missing category should return 404, never 5xx."""
        response = await auth_client.delete("/api/categories/999999")
        assert response.status_code == 404


class TestAtomicCategoryDeletedBehavior:
    """Atomic tests for behavior after deleting an existing category."""

    @pytest.mark.asyncio
    async def test_get_deleted_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Once deleted, category detail should return 404 (never 5xx)."""
        create = await auth_client.post("/api/categories", json={"name": "ToGone"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete.status_code == 204

        detail = await auth_client.get(f"/api/categories/{category_id}")
        assert detail.status_code == 404

    @pytest.mark.asyncio
    async def test_update_deleted_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Once deleted, updating the category should return 404."""
        create = await auth_client.post("/api/categories", json={"name": "DeleteMe"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete.status_code == 204

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "Resurrect"},
        )
        assert update.status_code == 404


class TestAtomicCategoryRecreateAfterDelete:
    """Atomic tests for recreating categories after deletion."""

    @pytest.mark.asyncio
    async def test_create_category_same_name_after_delete_succeeds(
        self, auth_client: AsyncClient
    ):
        """After deleting a category, creating a category with the same name should succeed."""
        create1 = await auth_client.post("/api/categories", json={"name": "Recreate"})
        assert create1.status_code == 201
        category_id = create1.json()["id"]

        delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete.status_code == 204

        create2 = await auth_client.post("/api/categories", json={"name": "Recreate"})
        assert create2.status_code == 201


class TestAtomicCategoryDeletionList:
    """Atomic tests for list behavior after deletion."""

    @pytest.mark.asyncio
    async def test_deleted_category_removed_from_list(
        self, auth_client: AsyncClient
    ):
        """Deleted categories should not appear in GET /categories."""
        create = await auth_client.post("/api/categories", json={"name": "Temp"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert delete.status_code == 204

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        ids = {c["id"] for c in categories.json()}
        assert category_id not in ids


class TestAtomicCategoryDeleteTwice:
    """Atomic tests for repeated delete behavior."""

    @pytest.mark.asyncio
    async def test_delete_category_twice_returns_404(
        self, auth_client: AsyncClient
    ):
        """Deleting a category twice should return 404 on the second attempt."""
        create = await auth_client.post("/api/categories", json={"name": "Twice"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        first_delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert first_delete.status_code == 204

        second_delete = await auth_client.delete(f"/api/categories/{category_id}")
        assert second_delete.status_code == 404


class TestAtomicCategoryPoseCount:
    """Atomic tests for category pose_count aggregation."""

    @pytest.mark.asyncio
    async def test_categories_include_pose_count(
        self, auth_client: AsyncClient
    ):
        """pose_count should reflect number of poses in the category."""
        category = await auth_client.post(
            "/api/categories", json={"name": "Counted"}
        )
        assert category.status_code == 201
        category_id = category.json()["id"]

        # Create two poses in this category
        for code in ("CNT01", "CNT02"):
            pose = await auth_client.post(
                "/api/poses",
                json={"code": code, "name": f"Pose {code}", "category_id": category_id},
            )
            assert pose.status_code == 201

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        data = categories.json()
        matched = next(c for c in data if c["id"] == category_id)
        assert matched["pose_count"] == 2


class TestAtomicCategoryPoseCountZero:
    """Atomic tests for pose_count defaults."""

    @pytest.mark.asyncio
    async def test_categories_include_zero_pose_count(
        self, auth_client: AsyncClient
    ):
        """Categories with no poses should report pose_count 0."""
        empty_category = await auth_client.post(
            "/api/categories", json={"name": "ZeroCount"}
        )
        assert empty_category.status_code == 201
        empty_id = empty_category.json()["id"]

        filled_category = await auth_client.post(
            "/api/categories", json={"name": "OneCount"}
        )
        assert filled_category.status_code == 201
        filled_id = filled_category.json()["id"]

        pose = await auth_client.post(
            "/api/poses",
            json={"code": "ZPC01", "name": "Pose", "category_id": filled_id},
        )
        assert pose.status_code == 201

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        data = categories.json()
        empty_match = next(c for c in data if c["id"] == empty_id)
        filled_match = next(c for c in data if c["id"] == filled_id)
        assert empty_match["pose_count"] == 0
        assert filled_match["pose_count"] == 1


class TestAtomicCategoryOrdering:
    """Atomic tests for category ordering."""

    @pytest.mark.asyncio
    async def test_categories_are_sorted_by_name(
        self, auth_client: AsyncClient
    ):
        """Categories should be returned sorted by name (ascending)."""
        names = ["Zeta", "alpha", "Mu"]
        for name in names:
            res = await auth_client.post("/api/categories", json={"name": name})
            assert res.status_code == 201

        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        returned_names = [c["name"] for c in response.json() if c["name"] in names]
        assert returned_names == sorted(names)


class TestAtomicCategoryValidation:
    """Atomic tests for category validation errors."""

    @pytest.mark.asyncio
    async def test_update_category_blank_name_returns_422(
        self, auth_client: AsyncClient
    ):
        """Blank name should be rejected with validation error (never 5xx)."""
        create = await auth_client.post("/api/categories", json={"name": "Valid"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "   "},
        )
        assert update.status_code == 422


class TestAtomicCategoryInvalidUnicode:
    """Atomic tests for invalid Unicode handling on update."""

    @pytest.mark.asyncio
    async def test_update_category_rejects_invalid_unicode_description(
        self, auth_client: AsyncClient
    ):
        """Invalid Unicode in description should be rejected with a 4xx."""
        create = await auth_client.post("/api/categories", json={"name": "Unicode"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        bad_payload = '{"description":"bad \\ud800"}'
        response = await auth_client.put(
            f"/api/categories/{category_id}",
            content=bad_payload,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in (400, 422)


class TestAtomicCategoryInvalidUnicodeMore:
    """Atomic tests for invalid Unicode handling across category fields."""

    @pytest.mark.asyncio
    async def test_create_category_rejects_invalid_unicode_description(
        self, auth_client: AsyncClient
    ):
        """Invalid Unicode in description should be rejected with a 4xx."""
        bad_payload = '{"name":"GoodName","description":"bad \\ud800"}'
        response = await auth_client.post(
            "/api/categories",
            content=bad_payload,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_update_category_rejects_invalid_unicode_name(
        self, auth_client: AsyncClient
    ):
        """Invalid Unicode in name should be rejected with a 4xx."""
        create = await auth_client.post("/api/categories", json={"name": "UnicodeOk"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        bad_payload = '{"name":"bad \\ud800"}'
        response = await auth_client.put(
            f"/api/categories/{category_id}",
            content=bad_payload,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code in (400, 422)


class TestAtomicCategoryIsolation:
    """Atomic tests for user isolation of categories."""

    @pytest.mark.asyncio
    async def test_categories_are_isolated_per_user(
        self, auth_client: AsyncClient
    ):
        """A user should not see another user's categories."""
        # User 1 creates a category
        own = await auth_client.post("/api/categories", json={"name": "Mine"})
        assert own.status_code == 201
        own_id = own.json()["id"]

        # User 2 logs in and creates a category
        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_cat = await auth_client.post(
            "/api/categories",
            json={"name": "Theirs"},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_cat.status_code == 201
        other_id = other_cat.json()["id"]

        # User 1 should only see their category
        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        ids = {c["id"] for c in response.json()}
        assert own_id in ids
        assert other_id not in ids


class TestAtomicCategoryUniquenessScope:
    """Atomic tests for uniqueness being scoped per user."""

    @pytest.mark.asyncio
    async def test_duplicate_names_allowed_across_users(
        self, auth_client: AsyncClient
    ):
        """Same name should be allowed for different users."""
        own = await auth_client.post("/api/categories", json={"name": "SharedName"})
        assert own.status_code == 201

        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token-5"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_create = await auth_client.post(
            "/api/categories",
            json={"name": "SharedName"},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_create.status_code == 201


class TestAtomicCategoryCrossUserAssignment:
    """Atomic tests preventing cross-user category references."""

    @pytest.mark.asyncio
    async def test_other_user_cannot_create_pose_in_someone_elses_category(
        self, auth_client: AsyncClient
    ):
        """A pose cannot be created referencing another user's category."""
        own_category = await auth_client.post(
            "/api/categories", json={"name": "PrivateCat"}
        )
        assert own_category.status_code == 201
        category_id = own_category.json()["id"]

        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token-6"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_pose = await auth_client.post(
            "/api/poses",
            json={
                "code": "XUSER01",
                "name": "Cross User Pose",
                "category_id": category_id,
            },
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_pose.status_code == 400
        assert "Category not found" in other_pose.json().get("detail", "")


class TestAtomicCategoryTrimming:
    """Atomic tests for whitespace trimming behavior."""

    @pytest.mark.asyncio
    async def test_update_category_name_trims_whitespace(
        self, auth_client: AsyncClient
    ):
        """Leading/trailing whitespace should be trimmed on update."""
        create = await auth_client.post("/api/categories", json={"name": "TrimMe"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "  Trimmed  "},
        )
        assert update.status_code == 200
        assert update.json()["name"] == "Trimmed"


class TestAtomicCategoryNullName:
    """Atomic tests for explicit null name updates."""

    @pytest.mark.asyncio
    async def test_update_category_null_name_returns_400(
        self, auth_client: AsyncClient
    ):
        """Explicit null name should be rejected with 400, never 5xx."""
        create = await auth_client.post("/api/categories", json={"name": "HasName"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": None},
        )
        assert update.status_code == 400


class TestAtomicCategoryCreateNormalization:
    """Atomic tests for normalization on create."""

    @pytest.mark.asyncio
    async def test_create_category_blank_description_becomes_none(
        self, auth_client: AsyncClient
    ):
        """Whitespace-only description should normalize to null on create."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "BlankDesc", "description": "   "},
        )
        assert response.status_code == 201
        assert response.json()["description"] is None


class TestAtomicCategoryCreateResponseFields:
    """Atomic tests for create response shape invariants."""

    @pytest.mark.asyncio
    async def test_create_category_includes_pose_count_zero(
        self, auth_client: AsyncClient
    ):
        """Create should return pose_count=0 (not null) for a new category."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "CreateFields"},
        )
        assert response.status_code == 201
        payload = response.json()
        assert payload["id"] is not None
        assert payload["name"] == "CreateFields"
        assert "created_at" in payload
        assert payload["pose_count"] == 0


class TestAtomicCategoryCreateTrimDescription:
    """Atomic tests for trimming description on create."""

    @pytest.mark.asyncio
    async def test_create_category_description_trims_whitespace(
        self, auth_client: AsyncClient
    ):
        """Description should be trimmed when creating a category."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "DescTrimCreate", "description": "  hello  "},
        )
        assert response.status_code == 201
        assert response.json()["description"] == "hello"


class TestAtomicCategoryCreateNulls:
    """Atomic tests for explicit null handling on create."""

    @pytest.mark.asyncio
    async def test_create_category_null_description_accepted(
        self, auth_client: AsyncClient
    ):
        """Explicit null description should be accepted and returned as null."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "NullDesc", "description": None},
        )
        assert response.status_code == 201
        assert response.json()["description"] is None

    @pytest.mark.asyncio
    async def test_create_category_null_name_returns_422(
        self, auth_client: AsyncClient
    ):
        """Explicit null name should be rejected with 422 (validation error)."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": None},
        )
        assert response.status_code == 422


class TestAtomicCategoryDescriptionTrim:
    """Atomic tests for trimming description on update."""

    @pytest.mark.asyncio
    async def test_update_category_description_trims_whitespace(
        self, auth_client: AsyncClient
    ):
        """Description should be trimmed when updated."""
        create = await auth_client.post(
            "/api/categories", json={"name": "DescTrim"}
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"description": "  trimmed desc  "},
        )
        assert update.status_code == 200
        assert update.json()["description"] == "trimmed desc"


class TestAtomicCategoryDescriptionLength:
    """Atomic tests for description length validation."""

    @pytest.mark.asyncio
    async def test_create_category_description_too_long_returns_422(
        self, auth_client: AsyncClient
    ):
        """Overlong description should be rejected with 422."""
        too_long = "a" * 2001
        response = await auth_client.post(
            "/api/categories",
            json={"name": "LongDesc", "description": too_long},
        )
        assert response.status_code == 422


class TestAtomicCategoryNameLength:
    """Atomic tests for name length validation."""

    @pytest.mark.asyncio
    async def test_create_category_name_too_long_returns_422(
        self, auth_client: AsyncClient
    ):
        """Overlong name should be rejected with 422."""
        too_long = "n" * 101
        response = await auth_client.post(
            "/api/categories",
            json={"name": too_long},
        )
        assert response.status_code == 422


class TestAtomicCategoryLengthBoundaries:
    """Atomic tests for max length boundaries."""

    @pytest.mark.asyncio
    async def test_create_category_max_lengths_accepted(
        self, auth_client: AsyncClient
    ):
        """Max-length name and description should be accepted."""
        name = "n" * 100
        description = "d" * 2000
        response = await auth_client.post(
            "/api/categories",
            json={"name": name, "description": description},
        )
        assert response.status_code == 201
        payload = response.json()
        assert payload["name"] == name
        assert payload["description"] == description


class TestAtomicCategoryUpdateNameLength:
    """Atomic tests for update name length validation."""

    @pytest.mark.asyncio
    async def test_update_category_name_too_long_returns_422(
        self, auth_client: AsyncClient
    ):
        """Overlong name on update should be rejected with 422."""
        create = await auth_client.post("/api/categories", json={"name": "Short"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        too_long = "n" * 101
        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": too_long},
        )
        assert update.status_code == 422


class TestAtomicCategoryDuplicateName:
    """Atomic tests for duplicate category creation."""

    @pytest.mark.asyncio
    async def test_create_category_duplicate_case_insensitive_returns_400(
        self, auth_client: AsyncClient
    ):
        """Case-insensitive duplicate names should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "Repeat"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "repeat"})
        assert second.status_code == 400


class TestAtomicCategoryUnicodeCaseInsensitiveUniqueness:
    """Atomic tests for case-insensitive uniqueness with non-ASCII names."""

    @pytest.mark.asyncio
    async def test_create_category_duplicate_cyrillic_case_insensitive_returns_400(
        self, auth_client: AsyncClient
    ):
        """Non-ASCII case variants (e.g., Cyrillic) should be treated as duplicates."""
        first = await auth_client.post("/api/categories", json={"name": "Йога"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "йога"})
        assert second.status_code == 400


class TestAtomicCategoryUnicodeCasefoldEdgeCases:
    """Atomic tests for Unicode casefold edge cases (e.g., ß -> ss)."""

    @pytest.mark.asyncio
    async def test_create_category_unicode_casefold_duplicate_returns_400(
        self, auth_client: AsyncClient
    ):
        """Unicode casefold duplicates should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "straße"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "STRASSE"})
        assert second.status_code == 400
        assert "already exists" in second.json().get("detail", "")


class TestAtomicCategoryInvisiblePrefixNormalization:
    """Atomic tests for normalization of invisible prefix characters (BOM/zero-width)."""

    @pytest.mark.asyncio
    async def test_create_category_rejects_invisible_prefix_duplicates(
        self, auth_client: AsyncClient
    ):
        """Leading BOM/zero-width chars should be ignored for uniqueness."""
        first = await auth_client.post("/api/categories", json={"name": "Yoga"})
        assert first.status_code == 201

        zwsp = await auth_client.post(
            "/api/categories", json={"name": "\u200bYoga"}
        )
        assert zwsp.status_code == 400

        bom = await auth_client.post(
            "/api/categories", json={"name": "\ufeffYoga"}
        )
        assert bom.status_code == 400

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        assert [c["name"] for c in categories.json() if c["name"] == "Yoga"] == [
            "Yoga"
        ]


class TestAtomicCategoryInvisibleEdgesAreStripped:
    """Atomic tests ensuring invisible edge characters are stripped on write."""

    @pytest.mark.asyncio
    async def test_create_and_update_strip_bom_and_zero_width_edges(
        self, auth_client: AsyncClient
    ):
        """Create/update should strip BOM/ZWSP at edges and return normalized fields."""
        created = await auth_client.post(
            "/api/categories",
            json={
                "name": "\ufeff  Yoga  \u200b",
                "description": "\u200b  desc  \ufeff",
            },
        )
        assert created.status_code == 201
        payload = created.json()
        assert payload["name"] == "Yoga"
        assert payload["description"] == "desc"

        category_id = payload["id"]
        updated = await auth_client.put(
            f"/api/categories/{category_id}",
            json={
                "name": "\u200bNewName\u200b",
                "description": "\ufeff  new desc  \u200b",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "NewName"
        assert updated.json()["description"] == "new desc"

        detail = await auth_client.get(f"/api/categories/{category_id}")
        assert detail.status_code == 200
        assert detail.json()["name"] == "NewName"
        assert detail.json()["description"] == "new desc"


class TestAtomicCategoryLegacyInvalidNameDoesNot500:
    """Atomic tests for legacy DB rows with invalid category names."""

    @pytest.mark.asyncio
    async def test_get_categories_with_legacy_invalid_name_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Even if DB contains an invalid name (e.g., only Cf), list should not 500."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()
        bad = Category(user_id=user.id, name="\u200b", description="\ufeff")
        db_session.add(bad)
        await db_session.commit()
        await db_session.refresh(bad)

        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        data = response.json()
        matched = next(c for c in data if c["id"] == bad.id)
        assert matched["name"]  # non-empty placeholder

        detail = await auth_client.get(f"/api/categories/{bad.id}")
        assert detail.status_code == 200
        assert detail.json()["id"] == bad.id
        assert detail.json()["name"]


class TestAtomicCategoryLegacyOverlongFieldsDoNot500:
    """Atomic tests for legacy DB rows with overlong fields."""

    @pytest.mark.asyncio
    async def test_get_categories_with_legacy_overlong_fields_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Overlong name/description in DB must not crash responses (no 5xx)."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        name = "n" * 101
        description = "d" * 2001
        bad = Category(user_id=user.id, name=name, description=description)
        db_session.add(bad)
        await db_session.commit()
        await db_session.refresh(bad)

        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        data = response.json()
        matched = next(c for c in data if c["id"] == bad.id)
        assert matched["name"] == ("n" * 100)
        assert matched["description"] == ("d" * 2000)

        detail = await auth_client.get(f"/api/categories/{bad.id}")
        assert detail.status_code == 200
        assert detail.json()["name"] == ("n" * 100)
        assert detail.json()["description"] == ("d" * 2000)


class TestAtomicCategoryLegacyNonStringDescriptionDoesNot500:
    """Atomic tests for legacy DB rows with non-string descriptions (e.g., BLOB)."""

    @pytest.mark.asyncio
    async def test_get_categories_with_blob_description_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """A non-string description in DB must not crash responses (no 5xx)."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        blob = b"x" * 2100
        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": "BlobDesc", "description": blob},
        )
        category_id = (
            await db_session.execute(text("SELECT last_insert_rowid()"))
        ).scalar_one()
        await db_session.commit()

        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        matched = next(c for c in response.json() if c["id"] == category_id)
        assert isinstance(matched["description"], str)
        assert len(matched["description"]) <= 2000


class TestAtomicCategoryLegacyNonStringDescriptionDetailDoesNot500:
    """Atomic tests for legacy DB rows with non-string descriptions on detail endpoint."""

    @pytest.mark.asyncio
    async def test_get_category_detail_with_blob_description_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """A non-string description in DB must not crash category detail (no 5xx)."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        blob = b"x" * 2100
        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": "BlobDescDetail", "description": blob},
        )
        category_id = (
            await db_session.execute(text("SELECT last_insert_rowid()"))
        ).scalar_one()
        await db_session.commit()

        response = await auth_client.get(f"/api/categories/{category_id}")
        assert response.status_code == 200
        payload = response.json()
        assert payload["id"] == category_id
        assert isinstance(payload["description"], str)
        assert len(payload["description"]) <= 2000


class TestAtomicCategoryLegacyBlobNameDoesNotBreakUniqueness:
    """Atomic tests for legacy DB rows where category.name is not a string."""

    @pytest.mark.asyncio
    async def test_create_category_with_legacy_blob_name_present_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Uniqueness checks must not crash if existing rows have non-string names."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": b"\x00\xffblob", "description": None},
        )
        await db_session.commit()

        created = await auth_client.post(
            "/api/categories", json={"name": "NormalName"}
        )
        assert created.status_code == 201

        listed = await auth_client.get("/api/categories")
        assert listed.status_code == 200


class TestAtomicCategoryLegacyNonStringNameDoesNot500:
    """Atomic tests for legacy DB rows with non-string names (e.g., BLOB)."""

    @pytest.mark.asyncio
    async def test_get_categories_with_blob_name_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """A non-string name in DB must not crash list responses (no 5xx)."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": b"\x00\xffblob", "description": "desc"},
        )
        category_id = (
            await db_session.execute(text("SELECT last_insert_rowid()"))
        ).scalar_one()
        await db_session.commit()

        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        matched = next(c for c in response.json() if c["id"] == category_id)
        assert isinstance(matched["name"], str)
        assert matched["name"]
        assert len(matched["name"]) <= 100

    @pytest.mark.asyncio
    async def test_get_category_detail_with_blob_name_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """A non-string name in DB must not crash detail responses (no 5xx)."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": b"\x00\xffblob", "description": None},
        )
        category_id = (
            await db_session.execute(text("SELECT last_insert_rowid()"))
        ).scalar_one()
        await db_session.commit()

        response = await auth_client.get(f"/api/categories/{category_id}")
        assert response.status_code == 200
        payload = response.json()
        assert payload["id"] == category_id
        assert isinstance(payload["name"], str)
        assert payload["name"]
        assert len(payload["name"]) <= 100


class TestAtomicCategoryLegacyExportDoesNot500:
    """Atomic tests for export endpoints with legacy invalid category data."""

    @pytest.mark.asyncio
    async def test_export_categories_json_with_overlong_category_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Export should not 500 if DB contains category name/description beyond schema max."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()
        bad = Category(user_id=user.id, name="n" * 250, description="d" * 2500)
        db_session.add(bad)
        await db_session.commit()

        response = await auth_client.get("/api/export/categories/json")
        assert response.status_code == 200
        exported = json.loads(response.text)
        item = next(c for c in exported if c["name"])
        assert len(item["name"]) <= 100
        if item.get("description") is not None:
            assert len(item["description"]) <= 2000


class TestAtomicCategoryLegacyBlobNameExportDoesNot500:
    """Atomic tests for export endpoints when category.name is not a string."""

    @pytest.mark.asyncio
    async def test_export_categories_json_with_blob_name_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Export should not 500 if DB contains categories with non-string names."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": b"\x00\xffblob", "description": b"x" * 2100},
        )
        await db_session.commit()

        response = await auth_client.get("/api/export/categories/json")
        assert response.status_code == 200
        exported = json.loads(response.text)
        assert isinstance(exported, list)
        assert any(isinstance(item.get("name"), str) and item["name"] for item in exported)


class TestAtomicCategoryLegacyBlobNameBackupExportDoesNot500:
    """Atomic tests for backup export when category.name is not a string."""

    @pytest.mark.asyncio
    async def test_export_backup_with_blob_name_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Backup export should remain valid JSON even with non-string category names."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()

        await db_session.execute(
            text(
                "INSERT INTO categories (user_id, name, description) VALUES (:user_id, :name, :description)"
            ),
            {"user_id": user.id, "name": b"\x00\xffblob", "description": None},
        )
        await db_session.commit()

        response = await auth_client.get("/api/export/backup")
        assert response.status_code == 200
        data = json.loads(response.text)
        assert "categories" in data
        assert any(isinstance(c.get("name"), str) and c["name"] for c in data["categories"])


class TestAtomicCategoryLegacyBackupExportDoesNot500:
    """Atomic tests for backup export with legacy category data."""

    @pytest.mark.asyncio
    async def test_export_backup_with_overlong_category_does_not_500(
        self, auth_client: AsyncClient, db_session
    ):
        """Backup export should remain valid JSON even with legacy overlong category fields."""
        user = (
            await db_session.execute(select(User).order_by(User.id.desc()).limit(1))
        ).scalar_one()
        bad = Category(user_id=user.id, name="n" * 250, description="d" * 2500)
        db_session.add(bad)
        await db_session.commit()

        response = await auth_client.get("/api/export/backup")
        assert response.status_code == 200
        data = json.loads(response.text)
        assert "metadata" in data
        assert "categories" in data
        assert any(len(c.get("name", "")) <= 100 for c in data["categories"])


class TestAtomicCategoryUnicodeCaseInsensitiveUpdateUniqueness:
    """Atomic tests for Unicode-aware case-insensitive uniqueness on update."""

    @pytest.mark.asyncio
    async def test_update_category_duplicate_cyrillic_case_insensitive_returns_400(
        self, auth_client: AsyncClient
    ):
        """Updating to a Cyrillic case variant of an existing name should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "Йога"})
        assert first.status_code == 201

        second = await auth_client.post("/api/categories", json={"name": "Баланс"})
        assert second.status_code == 201
        second_id = second.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{second_id}",
            json={"name": "йога"},
        )
        assert update.status_code == 400
        assert "already exists" in update.json().get("detail", "")


class TestAtomicCategoryCompatAndV1Parity:
    """Atomic tests ensuring /api and /api/v1 category routes behave consistently."""

    @pytest.mark.asyncio
    async def test_v1_categories_crud_visible_in_compat_routes(
        self, auth_client: AsyncClient
    ):
        """Creating via /api/v1 should be visible via /api (same DB + behavior)."""
        empty = await auth_client.get("/api/v1/categories")
        assert empty.status_code == 200
        assert empty.json() == []

        created = await auth_client.post("/api/v1/categories", json={"name": "V1Cat"})
        assert created.status_code == 201
        created_id = created.json()["id"]

        compat_list = await auth_client.get("/api/categories")
        assert compat_list.status_code == 200
        ids = {c["id"] for c in compat_list.json()}
        assert created_id in ids

        compat_detail = await auth_client.get(f"/api/categories/{created_id}")
        assert compat_detail.status_code == 200
        assert compat_detail.json()["name"] == "V1Cat"


class TestAtomicCategoryV1PoseCount:
    """Atomic tests for pose_count aggregation on /api/v1/categories."""

    @pytest.mark.asyncio
    async def test_v1_categories_include_pose_count(
        self, auth_client: AsyncClient
    ):
        """pose_count should reflect number of poses in the category on v1 list."""
        category = await auth_client.post(
            "/api/v1/categories", json={"name": "V1Counted"}
        )
        assert category.status_code == 201
        category_id = category.json()["id"]

        for code in ("V1C01", "V1C02"):
            pose = await auth_client.post(
                "/api/v1/poses",
                json={
                    "code": code,
                    "name": f"Pose {code}",
                    "category_id": category_id,
                },
            )
            assert pose.status_code == 201

        categories = await auth_client.get("/api/v1/categories")
        assert categories.status_code == 200
        matched = next(c for c in categories.json() if c["id"] == category_id)
        assert matched["pose_count"] == 2


class TestAtomicCategoryDeletedCannotBeAssigned:
    """Atomic tests for behavior when assigning deleted categories."""

    @pytest.mark.asyncio
    async def test_create_pose_with_deleted_category_returns_400(
        self, auth_client: AsyncClient
    ):
        """Creating a pose referencing a deleted category should return 400 (never 5xx)."""
        category = await auth_client.post("/api/categories", json={"name": "TempCat"})
        assert category.status_code == 201
        category_id = category.json()["id"]

        deleted = await auth_client.delete(f"/api/categories/{category_id}")
        assert deleted.status_code == 204

        pose = await auth_client.post(
            "/api/poses",
            json={"code": "DELASSIGN1", "name": "Pose", "category_id": category_id},
        )
        assert pose.status_code == 400
        assert "Category not found" in pose.json().get("detail", "")


class TestAtomicCategoryDeletedCannotBeReassignedOnPoseUpdate:
    """Atomic tests for pose updates referencing deleted categories."""

    @pytest.mark.asyncio
    async def test_update_pose_with_deleted_category_returns_400_and_no_versions(
        self, auth_client: AsyncClient, db_session
    ):
        """Updating a pose to use a deleted category should fail and not create versions."""
        category = await auth_client.post(
            "/api/categories", json={"name": "TempCatUpd"}
        )
        assert category.status_code == 201
        category_id = category.json()["id"]

        pose = await auth_client.post(
            "/api/poses",
            json={
                "code": "DELREAS1",
                "name": "Pose",
                "category_id": category_id,
            },
        )
        assert pose.status_code == 201
        pose_id = pose.json()["id"]

        deleted = await auth_client.delete(f"/api/categories/{category_id}")
        assert deleted.status_code == 204

        update = await auth_client.put(
            f"/api/poses/{pose_id}",
            json={"category_id": category_id},
        )
        assert update.status_code == 400
        assert "Category not found" in update.json().get("detail", "")

        versions = (
            await db_session.execute(
                select(PoseVersion).where(PoseVersion.pose_id == pose_id)
            )
        ).scalars().all()
        assert versions == []

        pose_after = await auth_client.get(f"/api/poses/{pose_id}")
        assert pose_after.status_code == 200
        assert pose_after.json()["category_id"] is None
        assert pose_after.json()["category_name"] is None


class TestAtomicCategoryImportUnicodeCaseInsensitiveDedupe:
    """Atomic tests for category dedupe behavior during imports."""

    @pytest.mark.asyncio
    async def test_import_json_dedupes_categories_cyrillic_case_insensitive(
        self, auth_client: AsyncClient
    ):
        """Import should not create duplicate categories for Cyrillic case variants."""
        poses = [
            {"code": "IMPCY1", "name": "Pose 1", "category_name": "Йога", "muscles": []},
            {"code": "IMPCY2", "name": "Pose 2", "category_name": "йога", "muscles": []},
        ]
        content = json.dumps(poses, ensure_ascii=False).encode("utf-8")

        response = await auth_client.post(
            "/api/import/poses/json",
            files={"file": ("poses.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        names = [c["name"] for c in categories.json()]
        assert sum(1 for n in names if n.casefold() == "йога") == 1


class TestAtomicCategoryPreviewUnicodeCaseInsensitiveDedupe:
    """Atomic tests for category dedupe behavior during import preview."""

    @pytest.mark.asyncio
    async def test_preview_json_dedupes_categories_cyrillic_case_insensitive(
        self, auth_client: AsyncClient
    ):
        """Preview should detect existing categories for Cyrillic case variants."""
        created = await auth_client.post("/api/categories", json={"name": "Йога"})
        assert created.status_code == 201

        payload = {
            "categories": [{"name": "йога", "description": None}],
            "poses": [],
        }
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        response = await auth_client.post(
            "/api/import/preview/json",
            files={"file": ("preview.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["valid"] is True

        category_items = [i for i in data["items"] if i.get("type") == "category"]
        assert len(category_items) == 1
        assert category_items[0]["name"] == "йога"
        assert category_items[0]["exists"] is True
        assert category_items[0]["will_be"] == "skipped"


class TestAtomicCategoryImportNameLengthHardening:
    """Atomic tests ensuring imports can't create categories that violate API constraints."""

    @pytest.mark.asyncio
    async def test_import_json_rejects_overlong_category_name(
        self, auth_client: AsyncClient
    ):
        """Import should reject category names > 100 chars (never poison /api/categories)."""
        overlong = "x" * 101
        poses = [
            {
                "code": "IMPLEN1",
                "name": "Pose With Long Category",
                "category_name": overlong,
                "muscles": [],
            }
        ]
        content = json.dumps(poses).encode("utf-8")
        response = await auth_client.post(
            "/api/import/poses/json",
            files={"file": ("poses.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["errors"] == 1
        assert payload["items"][0]["status"] == "error"

        # Ensure categories endpoint still works and no invalid category was created.
        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        assert categories.json() == []


class TestAtomicCategoryPreviewNameLengthHardening:
    """Atomic tests ensuring preview matches import validation for categories."""

    @pytest.mark.asyncio
    async def test_preview_json_rejects_overlong_category_name(
        self, auth_client: AsyncClient
    ):
        """Preview should mark overlong category names invalid (never claim 'created')."""
        overlong = "x" * 101
        payload = {"categories": [{"name": overlong, "description": None}], "poses": []}
        content = json.dumps(payload).encode("utf-8")
        response = await auth_client.post(
            "/api/import/preview/json",
            files={"file": ("preview.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["valid"] is False
        assert data["items"] == []
        assert data["validation_errors"]


class TestAtomicCategoryPreviewDedupesWithinFile:
    """Atomic tests for deduping duplicate categories inside a single preview payload."""

    @pytest.mark.asyncio
    async def test_preview_json_dedupes_duplicate_categories_in_payload(
        self, auth_client: AsyncClient
    ):
        """Preview should not claim it will create duplicates from the same file."""
        payload = {
            "categories": [
                {"name": "Йога", "description": None},
                {"name": "йога", "description": None},
            ],
            "poses": [],
        }
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        response = await auth_client.post(
            "/api/import/preview/json",
            files={"file": ("preview.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["valid"] is True
        assert data["categories_count"] == 2
        assert data["will_create"] == 1
        assert data["will_skip"] == 1

        category_items = [i for i in data["items"] if i.get("type") == "category"]
        assert [i["will_be"] for i in category_items] == ["created", "skipped"]


class TestAtomicCategoryOperationalErrorHardening:
    """Atomic tests ensuring transient DB errors don't surface as 500s."""

    @pytest.mark.asyncio
    async def test_create_category_operational_error_returns_409(
        self, auth_client: AsyncClient, db_session
    ):
        """If DB commit fails (e.g., locked), endpoint should return 409 (never 5xx)."""
        original_commit = db_session.commit
        db_session.commit = AsyncMock(
            side_effect=OperationalError("COMMIT", {}, Exception("database is locked"))
        )
        try:
            response = await auth_client.post(
                "/api/categories", json={"name": "LockedCreate"}
            )
        finally:
            db_session.commit = original_commit

        assert response.status_code == 409

        # Ensure request didn't partially create data.
        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        assert categories.json() == []


class TestAtomicCategoryOperationalErrorHardeningUpdateDelete:
    """Atomic tests ensuring update/delete handle transient DB errors cleanly."""

    @pytest.mark.asyncio
    async def test_update_category_operational_error_returns_409_and_preserves_data(
        self, auth_client: AsyncClient, db_session
    ):
        """If DB commit fails on update, endpoint should return 409 and not mutate state."""
        created = await auth_client.post(
            "/api/categories", json={"name": "LockedUpdate"}
        )
        assert created.status_code == 201
        category_id = created.json()["id"]

        original_commit = db_session.commit
        db_session.commit = AsyncMock(
            side_effect=OperationalError("COMMIT", {}, Exception("database is locked"))
        )
        try:
            response = await auth_client.put(
                f"/api/categories/{category_id}",
                json={"name": "LockedUpdateNew"},
            )
        finally:
            db_session.commit = original_commit

        assert response.status_code == 409

        # Ensure rollback didn't leave stale in-session state.
        db_session.expire_all()
        detail = await auth_client.get(f"/api/categories/{category_id}")
        assert detail.status_code == 200
        assert detail.json()["name"] == "LockedUpdate"

    @pytest.mark.asyncio
    async def test_delete_category_operational_error_returns_409_and_preserves_data(
        self, auth_client: AsyncClient, db_session
    ):
        """If DB commit fails on delete, endpoint should return 409 and not delete data."""
        created = await auth_client.post(
            "/api/categories", json={"name": "LockedDelete"}
        )
        assert created.status_code == 201
        category_id = created.json()["id"]

        original_commit = db_session.commit
        db_session.commit = AsyncMock(
            side_effect=OperationalError("COMMIT", {}, Exception("database is locked"))
        )
        try:
            response = await auth_client.delete(f"/api/categories/{category_id}")
        finally:
            db_session.commit = original_commit

        assert response.status_code == 409

        db_session.expire_all()
        detail = await auth_client.get(f"/api/categories/{category_id}")
        assert detail.status_code == 200
        assert detail.json()["name"] == "LockedDelete"


class TestAtomicCategoryIntegrityErrorHardening:
    """Atomic tests ensuring IntegrityError surfaces as a user-facing 4xx."""

    @pytest.mark.asyncio
    async def test_update_category_integrity_error_returns_400(
        self, auth_client: AsyncClient, db_session
    ):
        """If DB raises IntegrityError (e.g., uniqueness race), endpoint should return 400."""
        created = await auth_client.post(
            "/api/categories", json={"name": "IntegrityUpdate"}
        )
        assert created.status_code == 201
        category_id = created.json()["id"]

        original_commit = db_session.commit
        db_session.commit = AsyncMock(
            side_effect=IntegrityError("COMMIT", {}, Exception("unique constraint"))
        )
        try:
            response = await auth_client.put(
                f"/api/categories/{category_id}",
                json={"name": "IntegrityUpdateNew"},
            )
        finally:
            db_session.commit = original_commit

        assert response.status_code == 400
        assert "already exists" in response.json().get("detail", "")


class TestAtomicCategoryBackupRestoreCategoryMapping:
    """Atomic tests for category mapping during backup restore."""

    @pytest.mark.asyncio
    async def test_backup_restore_maps_category_name_case_insensitive(
        self, auth_client: AsyncClient
    ):
        """Backup restore should not create duplicate categories for Cyrillic case variants."""
        backup = {
            "metadata": {
                "version": "1.0.0",
                "exported_at": "2026-02-05T00:00:00Z",
                "total_poses": 1,
                "total_categories": 1,
            },
            "categories": [{"name": "Йога", "description": None}],
            "poses": [{"code": "BK01", "name": "Backup Pose", "category_name": "йога"}],
        }
        content = json.dumps(backup, ensure_ascii=False).encode("utf-8")
        response = await auth_client.post(
            "/api/import/backup",
            files={"file": ("backup.json", content, "application/json")},
        )
        assert response.status_code == 200, response.text

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        names = [c["name"] for c in categories.json()]
        assert sum(1 for n in names if n.casefold() == "йога") == 1

        poses = await auth_client.get("/api/poses", params={"limit": 10})
        assert poses.status_code == 200
        assert poses.json()["total"] == 1
        assert poses.json()["items"][0]["code"] == "BK01"
        assert poses.json()["items"][0]["category_name"] == "Йога"


class TestAtomicCategoryTrimmedDuplicate:
    """Atomic tests for duplicates after trimming."""

    @pytest.mark.asyncio
    async def test_create_category_duplicate_after_trimming_rejected(
        self, auth_client: AsyncClient
    ):
        """Whitespace-trimmed duplicate names should be rejected."""
        first = await auth_client.post("/api/categories", json={"name": "TrimDup"})
        assert first.status_code == 201

        second = await auth_client.post(
            "/api/categories", json={"name": "  TrimDup  "}
        )
        assert second.status_code == 400


class TestAtomicCategoryUpdateDescriptionLength:
    """Atomic tests for description length on update."""

    @pytest.mark.asyncio
    async def test_update_category_description_too_long_returns_422(
        self, auth_client: AsyncClient
    ):
        """Overlong description on update should be rejected with 422."""
        create = await auth_client.post("/api/categories", json={"name": "ShortDesc"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        too_long = "b" * 2001
        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"description": too_long},
        )
        assert update.status_code == 422


class TestAtomicCategoryNullDescription:
    """Atomic tests for explicit null description updates."""

    @pytest.mark.asyncio
    async def test_update_category_null_description_returns_200(
        self, auth_client: AsyncClient
    ):
        """Null description should be accepted and stored as null."""
        create = await auth_client.post(
            "/api/categories", json={"name": "HasDesc", "description": "text"}
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"description": None},
        )
        assert update.status_code == 200
        assert update.json()["description"] is None


class TestAtomicCategoryPoseCountAfterDelete:
    """Atomic tests for pose_count after pose deletion."""

    @pytest.mark.asyncio
    async def test_pose_count_updates_after_pose_delete(
        self, auth_client: AsyncClient
    ):
        """pose_count should reflect deletion of poses."""
        category = await auth_client.post(
            "/api/categories", json={"name": "CountAfterDelete"}
        )
        assert category.status_code == 201
        category_id = category.json()["id"]

        pose = await auth_client.post(
            "/api/poses",
            json={"code": "DELPC1", "name": "Pose", "category_id": category_id},
        )
        assert pose.status_code == 201
        pose_id = pose.json()["id"]

        delete_pose = await auth_client.delete(f"/api/poses/{pose_id}")
        assert delete_pose.status_code == 204

        categories = await auth_client.get("/api/categories")
        assert categories.status_code == 200
        matched = next(c for c in categories.json() if c["id"] == category_id)
        assert matched["pose_count"] == 0


class TestAtomicCategoryAccessControl:
    """Atomic tests for category access control."""

    @pytest.mark.asyncio
    async def test_get_category_other_user_returns_404(
        self, auth_client: AsyncClient
    ):
        """User cannot access another user's category."""
        own = await auth_client.post("/api/categories", json={"name": "Private"})
        assert own.status_code == 201
        category_id = own.json()["id"]

        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token-2"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_get = await auth_client.get(
            f"/api/categories/{category_id}",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_get.status_code == 404


class TestAtomicCategoryOwnership:
    """Atomic tests ensuring other users cannot mutate categories."""

    @pytest.mark.asyncio
    async def test_delete_other_user_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Deleting another user's category should return 404 and preserve data."""
        own = await auth_client.post("/api/categories", json={"name": "OwnerOnly"})
        assert own.status_code == 201
        category_id = own.json()["id"]

        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token-3"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_delete = await auth_client.delete(
            f"/api/categories/{category_id}",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_delete.status_code == 404

        still_there = await auth_client.get(f"/api/categories/{category_id}")
        assert still_there.status_code == 200

    @pytest.mark.asyncio
    async def test_update_other_user_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Updating another user's category should return 404 and keep original."""
        own = await auth_client.post("/api/categories", json={"name": "StayMine"})
        assert own.status_code == 201
        category_id = own.json()["id"]

        other_login = await auth_client.post(
            "/api/auth/login", json={"token": "other-user-token-4"}
        )
        assert other_login.status_code == 200
        other_token = other_login.json()["access_token"]

        other_update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "Hacked"},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_update.status_code == 404

        still_there = await auth_client.get(f"/api/categories/{category_id}")
        assert still_there.status_code == 200
        assert still_there.json()["name"] == "StayMine"


class TestAtomicCategoryUpdateNotFound:
    """Atomic tests for updating missing categories."""

    @pytest.mark.asyncio
    async def test_update_missing_category_returns_404(
        self, auth_client: AsyncClient
    ):
        """Updating a missing category should return 404."""
        response = await auth_client.put(
            "/api/categories/999999",
            json={"name": "Nope"},
        )
        assert response.status_code == 404


class TestAtomicCategoryEmptyList:
    """Atomic tests for empty category list behavior."""

    @pytest.mark.asyncio
    async def test_get_categories_empty_returns_empty_list(
        self, auth_client: AsyncClient
    ):
        """When no categories exist, the list should be empty."""
        response = await auth_client.get("/api/categories")
        assert response.status_code == 200
        assert response.json() == []


class TestAtomicCategoryPoseCountDetail:
    """Atomic tests for pose_count on category detail."""

    @pytest.mark.asyncio
    async def test_get_category_pose_count_starts_at_zero(
        self, auth_client: AsyncClient
    ):
        """New category should report pose_count 0 on detail."""
        create = await auth_client.post("/api/categories", json={"name": "DetailCount"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        detail = await auth_client.get(f"/api/categories/{category_id}")
        assert detail.status_code == 200
        assert detail.json()["pose_count"] == 0


class TestAtomicCategoryPoseCountDetailUpdates:
    """Atomic tests for pose_count changes on category detail."""

    @pytest.mark.asyncio
    async def test_category_detail_pose_count_updates_with_pose_changes(
        self, auth_client: AsyncClient
    ):
        """pose_count on category detail should reflect pose create/delete."""
        create = await auth_client.post(
            "/api/categories", json={"name": "DetailUpdates"}
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        pose1 = await auth_client.post(
            "/api/poses",
            json={"code": "DUPD01", "name": "Pose 1", "category_id": category_id},
        )
        assert pose1.status_code == 201
        pose1_id = pose1.json()["id"]

        detail1 = await auth_client.get(f"/api/categories/{category_id}")
        assert detail1.status_code == 200
        assert detail1.json()["pose_count"] == 1

        pose2 = await auth_client.post(
            "/api/poses",
            json={"code": "DUPD02", "name": "Pose 2", "category_id": category_id},
        )
        assert pose2.status_code == 201
        pose2_id = pose2.json()["id"]

        detail2 = await auth_client.get(f"/api/categories/{category_id}")
        assert detail2.status_code == 200
        assert detail2.json()["pose_count"] == 2

        delete_pose = await auth_client.delete(f"/api/poses/{pose1_id}")
        assert delete_pose.status_code == 204

        detail3 = await auth_client.get(f"/api/categories/{category_id}")
        assert detail3.status_code == 200
        assert detail3.json()["pose_count"] == 1

        # Cleanup second pose (best effort; should never 5xx)
        delete_pose2 = await auth_client.delete(f"/api/poses/{pose2_id}")
        assert delete_pose2.status_code == 204


class TestAtomicCategoryEmptyUpdate:
    """Atomic tests for empty update payloads."""

    @pytest.mark.asyncio
    async def test_update_category_empty_payload_keeps_name(
        self, auth_client: AsyncClient
    ):
        """Empty update payload should not alter name."""
        create = await auth_client.post("/api/categories", json={"name": "KeepMe"})
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={},
        )
        assert update.status_code == 200
        assert update.json()["name"] == "KeepMe"


class TestAtomicCategoryPartialUpdate:
    """Atomic tests for partial updates preserving fields."""

    @pytest.mark.asyncio
    async def test_update_category_name_preserves_description(
        self, auth_client: AsyncClient
    ):
        """Updating name only should keep existing description."""
        create = await auth_client.post(
            "/api/categories",
            json={"name": "WithDesc", "description": "Original"},
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"name": "WithDescUpdated"},
        )
        assert update.status_code == 200
        assert update.json()["name"] == "WithDescUpdated"
        assert update.json()["description"] == "Original"


class TestAtomicCategoryDescriptionUpdate:
    """Atomic tests for description-only updates."""

    @pytest.mark.asyncio
    async def test_update_category_description_preserves_name(
        self, auth_client: AsyncClient
    ):
        """Updating description only should keep existing name."""
        create = await auth_client.post(
            "/api/categories",
            json={"name": "KeepName", "description": "Old"},
        )
        assert create.status_code == 201
        category_id = create.json()["id"]

        update = await auth_client.put(
            f"/api/categories/{category_id}",
            json={"description": "New"},
        )
        assert update.status_code == 200
        assert update.json()["name"] == "KeepName"
        assert update.json()["description"] == "New"


class TestAtomicCategoryCreateTrim:
    """Atomic tests for trimming on create."""

    @pytest.mark.asyncio
    async def test_create_category_trims_name_whitespace(
        self, auth_client: AsyncClient
    ):
        """Leading/trailing whitespace should be trimmed on create."""
        response = await auth_client.post(
            "/api/categories",
            json={"name": "  TrimCreate  "},
        )
        assert response.status_code == 201
        assert response.json()["name"] == "TrimCreate"
