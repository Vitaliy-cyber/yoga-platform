"""
Unit tests for Pydantic schemas
"""

from datetime import datetime

import pytest
from pydantic import ValidationError
from schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from schemas.generate import GenerateResponse, GenerateStatus
from schemas.muscle import MuscleCreate, MuscleResponse, PoseMuscleResponse
from schemas.pose import PoseCreate, PoseMuscleCreate, PoseResponse, PoseUpdate


class TestCategorySchemas:
    """Tests for Category schemas"""

    def test_category_create_valid(self):
        data = {"name": "Test Category"}
        schema = CategoryCreate(**data)
        assert schema.name == "Test Category"

    def test_category_create_with_description(self):
        schema = CategoryCreate(name="With Desc", description="Description text")
        assert schema.description == "Description text"

    def test_category_create_empty_name_fails(self):
        with pytest.raises(ValidationError):
            CategoryCreate(name="")

    def test_category_update_partial(self):
        schema = CategoryUpdate(name="Updated Name")
        assert schema.name == "Updated Name"

    def test_category_update_all_fields(self):
        schema = CategoryUpdate(name="Full Update", description="New description")
        assert schema.name == "Full Update"
        assert schema.description == "New description"

    def test_category_response_structure(self):
        data = {
            "id": 1,
            "name": "Response Cat",
            "description": "Desc",
            "created_at": datetime.now(),
            "pose_count": 5,
        }
        schema = CategoryResponse(**data)
        assert schema.id == 1
        assert schema.pose_count == 5

    def test_category_response_without_pose_count(self):
        data = {
            "id": 2,
            "name": "No Count",
            "description": None,
            "created_at": datetime.now(),
        }
        schema = CategoryResponse(**data)
        assert schema.pose_count is None

    def test_category_name_length(self):
        # Test reasonable name lengths
        short_name = CategoryCreate(name="A")
        assert len(short_name.name) == 1

        long_name = CategoryCreate(name="A" * 100)
        assert len(long_name.name) == 100

    def test_category_name_too_long_fails(self):
        with pytest.raises(ValidationError):
            CategoryCreate(name="A" * 101)


class TestMuscleSchemas:
    """Tests for Muscle schemas"""

    def test_muscle_create_valid(self):
        schema = MuscleCreate(name="Quadriceps", name_ua="Квадрицепс", body_part="legs")
        assert schema.name == "Quadriceps"
        assert schema.body_part == "legs"

    def test_muscle_create_minimal(self):
        schema = MuscleCreate(name="Basic Muscle")
        assert schema.name == "Basic Muscle"
        assert schema.name_ua is None
        assert schema.body_part is None

    def test_muscle_body_parts_valid(self):
        valid_parts = ["legs", "arms", "core", "back", "chest", "shoulders"]
        for part in valid_parts:
            schema = MuscleCreate(name=f"Test {part}", body_part=part)
            assert schema.body_part == part

    def test_muscle_response_structure(self):
        data = {
            "id": 1,
            "name": "Response Muscle",
            "name_ua": "Відповідь М'яз",
            "body_part": "core",
        }
        schema = MuscleResponse(**data)
        assert schema.id == 1
        assert schema.name_ua == "Відповідь М'яз"

    def test_muscle_without_optional_fields(self):
        schema = MuscleCreate(name="Basic")
        assert schema.body_part is None

    def test_pose_muscle_response(self):
        data = {
            "muscle_id": 1,
            "muscle_name": "Quadriceps",
            "muscle_name_ua": "Квадрицепс",
            "body_part": "legs",
            "activation_level": 75,
        }
        schema = PoseMuscleResponse(**data)
        assert schema.activation_level == 75

    def test_pose_muscle_activation_range(self):
        # Valid range 0-100
        valid_levels = [0, 25, 50, 75, 100]
        for level in valid_levels:
            schema = PoseMuscleResponse(
                muscle_id=1, muscle_name="Test", activation_level=level
            )
            assert schema.activation_level == level

    def test_pose_muscle_invalid_activation_fails(self):
        with pytest.raises(ValidationError):
            PoseMuscleResponse(muscle_id=1, muscle_name="Test", activation_level=101)


class TestPoseSchemas:
    """Tests for Pose schemas"""

    def test_pose_create_minimal(self):
        schema = PoseCreate(code="TEST01", name="Test Pose", category_id=1)
        assert schema.code == "TEST01"
        assert schema.category_id == 1

    def test_pose_create_full(self):
        schema = PoseCreate(
            code="FULL01",
            name="Повна поза",
            name_en="Full Pose",
            category_id=1,
            description="Опис",
            effect="Ефект",
            breathing="Дихання",
        )
        assert schema.name_en == "Full Pose"
        assert schema.description == "Опис"

    def test_pose_create_with_muscles(self):
        muscles = [
            PoseMuscleCreate(muscle_id=1, activation_level=80),
            PoseMuscleCreate(muscle_id=2, activation_level=60),
        ]
        schema = PoseCreate(
            code="MUSC01", name="Muscle Pose", category_id=1, muscles=muscles
        )
        assert len(schema.muscles) == 2
        assert schema.muscles[0].activation_level == 80

    def test_pose_muscle_create_valid(self):
        schema = PoseMuscleCreate(muscle_id=1, activation_level=75)
        assert schema.muscle_id == 1
        assert schema.activation_level == 75

    def test_pose_muscle_activation_range(self):
        # Valid range 0-100
        valid_levels = [0, 25, 50, 75, 100]
        for level in valid_levels:
            schema = PoseMuscleCreate(muscle_id=1, activation_level=level)
            assert schema.activation_level == level

    def test_pose_update_partial(self):
        schema = PoseUpdate(name="Updated Name")
        assert schema.name == "Updated Name"
        assert schema.code is None

    def test_pose_code_format(self):
        # Test various code formats
        codes = ["TADA", "VIRA1", "UTTAN", "SAVAN", "TEST01"]
        for code in codes:
            schema = PoseCreate(code=code, name=f"Pose {code}", category_id=1)
            assert schema.code == code

    def test_pose_create_without_name_fails(self):
        with pytest.raises(ValidationError):
            PoseCreate(code="TEST", category_id=1)

    def test_pose_create_without_code_fails(self):
        with pytest.raises(ValidationError):
            PoseCreate(name="Test", category_id=1)


class TestGenerateSchemas:
    """Tests for Generate schemas"""

    def test_generate_status_values(self):
        statuses = [
            GenerateStatus.PENDING,
            GenerateStatus.PROCESSING,
            GenerateStatus.COMPLETED,
            GenerateStatus.FAILED,
        ]
        for status in statuses:
            assert status.value in ["pending", "processing", "completed", "failed"]

    def test_generate_response_pending(self):
        schema = GenerateResponse(
            task_id="task-123", status=GenerateStatus.PENDING, progress=0
        )
        assert schema.status == GenerateStatus.PENDING
        assert schema.progress == 0

    def test_generate_response_processing(self):
        schema = GenerateResponse(
            task_id="task-456", status=GenerateStatus.PROCESSING, progress=50
        )
        assert schema.progress == 50

    def test_generate_response_completed(self):
        schema = GenerateResponse(
            task_id="task-789",
            status=GenerateStatus.COMPLETED,
            progress=100,
        )
        assert schema.status == GenerateStatus.COMPLETED

    def test_generate_response_failed(self):
        schema = GenerateResponse(
            task_id="task-fail",
            status=GenerateStatus.FAILED,
            progress=30,
            error_message="Generation failed",
        )
        assert schema.error_message == "Generation failed"

    def test_generate_progress_range(self):
        for progress in [0, 25, 50, 75, 100]:
            schema = GenerateResponse(
                task_id=f"task-{progress}",
                status=GenerateStatus.PROCESSING,
                progress=progress,
            )
            assert schema.progress == progress
