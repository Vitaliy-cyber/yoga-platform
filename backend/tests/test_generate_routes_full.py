from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.generation_task import GenerationTask
from models.pose import Pose
from models.user import User
from schemas.generate import GenerateStatus


def _tiny_png_bytes() -> bytes:
    img = Image.new("RGB", (128, 128), "white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


class TestGenerateFromTextRoutes:
    @pytest.mark.asyncio
    async def test_from_text_creates_task_with_trimmed_notes_and_schedules_runner(
        self, auth_client: AsyncClient, db_session: AsyncSession
    ):
        mock_runner = AsyncMock(return_value=None)
        description = "  Detailed warrior pose with stable footing and extended arms.  "
        notes = "  keep elbows straight  "
        with patch("api.routes.generate.run_generation_from_text", mock_runner):
            response = await auth_client.post(
                "/api/generate/from-text",
                json={"description": description, "additional_notes": notes},
            )

        assert response.status_code == 200
        task_id = response.json()["task_id"]

        result = await db_session.execute(
            select(GenerationTask).where(GenerationTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        assert task is not None
        assert task.additional_notes == "keep elbows straight"

        mock_runner.assert_awaited_once()
        called_args = mock_runner.await_args.args
        assert called_args[0] == task_id
        assert called_args[1] == description.strip()
        assert called_args[2] == "keep elbows straight"
        assert called_args[3] is True

    @pytest.mark.asyncio
    async def test_from_text_forwards_generate_muscles_flag(
        self, auth_client: AsyncClient
    ):
        mock_runner = AsyncMock(return_value=None)
        with patch("api.routes.generate.run_generation_from_text", mock_runner):
            response = await auth_client.post(
                "/api/generate/from-text",
                json={
                    "description": "Detailed warrior pose with stable footing and extended arms.",
                    "generate_muscles": False,
                },
            )

        assert response.status_code == 200
        called_args = mock_runner.await_args.args
        assert called_args[3] is False

    @pytest.mark.asyncio
    async def test_from_text_rejects_too_long_additional_notes(self, auth_client: AsyncClient):
        response = await auth_client.post(
            "/api/generate/from-text",
            json={
                "description": "Detailed warrior pose with stable footing and extended arms.",
                "additional_notes": "x" * 501,
            },
        )
        assert response.status_code == 422


class TestGenerateFromPoseRoutes:
    @pytest.mark.asyncio
    async def test_from_pose_creates_task_and_persists_trimmed_notes(
        self, auth_client: AsyncClient, db_session: AsyncSession
    ):
        create_pose_response = await auth_client.post(
            "/api/poses",
            json={"code": "FPOSE01", "name": "From Pose Source"},
        )
        assert create_pose_response.status_code == 201
        pose_id = create_pose_response.json()["id"]

        pose_result = await db_session.execute(select(Pose).where(Pose.id == pose_id))
        pose = pose_result.scalar_one()
        pose.schema_path = "schemas/source.png"
        await db_session.commit()

        mock_storage = MagicMock()
        mock_storage.download_bytes = AsyncMock(return_value=_tiny_png_bytes())
        with patch("api.routes.generate.get_storage", return_value=mock_storage):
            response = await auth_client.post(
                f"/api/generate/from-pose/{pose_id}",
                json={"additional_notes": "   mirror left side   "},
            )

        assert response.status_code == 200
        task_id = response.json()["task_id"]
        mock_storage.download_bytes.assert_awaited_once_with("schemas/source.png")

        task_result = await db_session.execute(
            select(GenerationTask).where(GenerationTask.task_id == task_id)
        )
        task = task_result.scalar_one_or_none()
        assert task is not None
        assert task.additional_notes == "mirror left side"

    @pytest.mark.asyncio
    async def test_from_pose_rejects_corrupted_schema_image(
        self, auth_client: AsyncClient, db_session: AsyncSession
    ):
        create_pose_response = await auth_client.post(
            "/api/poses",
            json={"code": "FPOSE02", "name": "Broken Pose Source"},
        )
        assert create_pose_response.status_code == 201
        pose_id = create_pose_response.json()["id"]

        pose_result = await db_session.execute(select(Pose).where(Pose.id == pose_id))
        pose = pose_result.scalar_one()
        pose.schema_path = "schemas/corrupted.bin"
        await db_session.commit()

        mock_storage = MagicMock()
        mock_storage.download_bytes = AsyncMock(return_value=b"this-is-not-an-image")
        with patch("api.routes.generate.get_storage", return_value=mock_storage):
            response = await auth_client.post(f"/api/generate/from-pose/{pose_id}", json={})

        assert response.status_code == 400
        assert "Invalid file type" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_from_pose_rejects_too_small_schema_image(
        self, auth_client: AsyncClient, db_session: AsyncSession
    ):
        create_pose_response = await auth_client.post(
            "/api/poses",
            json={"code": "FPOSE04", "name": "Tiny Pose Source"},
        )
        assert create_pose_response.status_code == 201
        pose_id = create_pose_response.json()["id"]

        pose_result = await db_session.execute(select(Pose).where(Pose.id == pose_id))
        pose = pose_result.scalar_one()
        pose.schema_path = "schemas/tiny.png"
        await db_session.commit()

        tiny = Image.new("RGB", (1, 1), "white")
        buf = BytesIO()
        tiny.save(buf, format="PNG")

        mock_storage = MagicMock()
        mock_storage.download_bytes = AsyncMock(return_value=buf.getvalue())
        with patch("api.routes.generate.get_storage", return_value=mock_storage):
            response = await auth_client.post(f"/api/generate/from-pose/{pose_id}", json={})

        assert response.status_code == 400
        assert "too small" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_from_pose_enforces_owner_visibility(
        self, auth_client: AsyncClient, db_session: AsyncSession
    ):
        other_user = User.create_with_token("other-user-token", name="Other User")
        db_session.add(other_user)
        await db_session.flush()

        pose = Pose(
            user_id=other_user.id,
            code="FPOSE03",
            name="Other User Pose",
            schema_path="schemas/other.png",
        )
        db_session.add(pose)
        await db_session.commit()

        response = await auth_client.post(f"/api/generate/from-pose/{pose.id}", json={})
        assert response.status_code == 404
        assert "Pose not found" in response.json()["detail"]


class TestRunGenerationFailures:
    @pytest.mark.asyncio
    async def test_run_generation_marks_task_failed_on_generation_error(
        self, db_session: AsyncSession
    ):
        from api.routes.generate import run_generation

        user = User.create_with_token("gen-fail-user-token", name="GenFailUser")
        db_session.add(user)
        await db_session.flush()
        task = GenerationTask(
            task_id="generation-fail-task",
            user_id=user.id,
            status=GenerateStatus.PENDING.value,
            progress=0,
            status_message="In queue...",
        )
        db_session.add(task)
        await db_session.commit()

        mock_generator = MagicMock()
        mock_generator.generate_all_from_image = AsyncMock(
            side_effect=RuntimeError("generation boom")
        )
        mock_storage = MagicMock()
        mock_storage.upload_bytes = AsyncMock()

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        with patch("api.routes.generate.get_storage", return_value=mock_storage), patch(
            "api.routes.generate.AsyncSessionLocal",
            return_value=_SessionCtx(db_session),
        ), patch(
            "services.google_generator.GoogleGeminiGenerator.get_instance",
            return_value=mock_generator,
        ):
            await run_generation("generation-fail-task", _tiny_png_bytes(), "image/png")

        updated = (
            await db_session.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id == "generation-fail-task"
                )
            )
        ).scalar_one()
        assert updated.status == GenerateStatus.FAILED.value
        assert updated.status_message == "Generation failed"
        assert "generation boom" in (updated.error_message or "").lower()

    @pytest.mark.asyncio
    async def test_run_generation_forwards_pose_description_to_generator(
        self, db_session: AsyncSession
    ):
        from api.routes.generate import run_generation
        from services.google_generator import GenerationResult

        user = User.create_with_token("pose-desc-user-token", name="PoseDescUser")
        db_session.add(user)
        await db_session.flush()
        task = GenerationTask(
            task_id="generation-pose-desc-task",
            user_id=user.id,
            status=GenerateStatus.PENDING.value,
            progress=0,
            status_message="In queue...",
        )
        db_session.add(task)
        await db_session.commit()

        mock_generator = MagicMock()
        mock_generator.generate_all_from_image = AsyncMock(
            return_value=GenerationResult(
                photo_bytes=_tiny_png_bytes(),
                muscles_bytes=_tiny_png_bytes(),
                used_placeholders=False,
                analyzed_muscles=[],
            )
        )
        mock_storage = MagicMock()
        mock_storage.upload_bytes = AsyncMock(side_effect=["/p.png", "/m.png"])

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        with patch("api.routes.generate.get_storage", return_value=mock_storage), patch(
            "api.routes.generate.AsyncSessionLocal",
            return_value=_SessionCtx(db_session),
        ), patch(
            "services.google_generator.GoogleGeminiGenerator.get_instance",
            return_value=mock_generator,
        ):
            await run_generation(
                "generation-pose-desc-task",
                _tiny_png_bytes(),
                "image/png",
                additional_notes="keep shoulders down",
                pose_description="Janu Sirsasana seated forward fold",
            )

        kwargs = mock_generator.generate_all_from_image.await_args.kwargs
        assert kwargs["pose_description"] == "Janu Sirsasana seated forward fold"

    @pytest.mark.asyncio
    async def test_run_generation_marks_task_failed_when_placeholders_returned(
        self, db_session: AsyncSession
    ):
        from api.routes.generate import run_generation
        from services.google_generator import GenerationResult

        user = User.create_with_token("placeholder-fail-token", name="PlaceholderFail")
        db_session.add(user)
        await db_session.flush()
        task = GenerationTask(
            task_id="generation-placeholder-task",
            user_id=user.id,
            status=GenerateStatus.PENDING.value,
            progress=0,
            status_message="In queue...",
        )
        db_session.add(task)
        await db_session.commit()

        mock_generator = MagicMock()
        mock_generator.generate_all_from_image = AsyncMock(
            return_value=GenerationResult(
                photo_bytes=_tiny_png_bytes(),
                muscles_bytes=_tiny_png_bytes(),
                used_placeholders=True,
                analyzed_muscles=[],
            )
        )
        mock_storage = MagicMock()
        mock_storage.upload_bytes = AsyncMock()

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        with patch("api.routes.generate.get_storage", return_value=mock_storage), patch(
            "api.routes.generate.AsyncSessionLocal",
            return_value=_SessionCtx(db_session),
        ), patch(
            "services.google_generator.GoogleGeminiGenerator.get_instance",
            return_value=mock_generator,
        ):
            await run_generation("generation-placeholder-task", _tiny_png_bytes(), "image/png")

        updated = (
            await db_session.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id == "generation-placeholder-task"
                )
            )
        ).scalar_one()
        assert updated.status == GenerateStatus.FAILED.value
        assert "placeholders" in (updated.error_message or "").lower()

    @pytest.mark.asyncio
    async def test_run_generation_without_muscles_skips_muscle_outputs(
        self, db_session: AsyncSession
    ):
        from api.routes.generate import run_generation
        from services.google_generator import GenerationResult

        user = User.create_with_token("no-muscles-token", name="NoMusclesUser")
        db_session.add(user)
        await db_session.flush()
        task = GenerationTask(
            task_id="generation-no-muscles-task",
            user_id=user.id,
            status=GenerateStatus.PENDING.value,
            progress=0,
            status_message="In queue...",
        )
        db_session.add(task)
        await db_session.commit()

        mock_generator = MagicMock()
        mock_generator.generate_all_from_image = AsyncMock(
            return_value=GenerationResult(
                photo_bytes=_tiny_png_bytes(),
                muscles_bytes=_tiny_png_bytes(),
                used_placeholders=False,
                analyzed_muscles=[],
            )
        )
        mock_storage = MagicMock()
        mock_storage.upload_bytes = AsyncMock(return_value="/p.png")

        class _SessionCtx:
            def __init__(self, session):
                self._session = session

            async def __aenter__(self):
                return self._session

            async def __aexit__(self, exc_type, exc, tb):
                return False

        with patch("api.routes.generate.get_storage", return_value=mock_storage), patch(
            "api.routes.generate.AsyncSessionLocal",
            return_value=_SessionCtx(db_session),
        ), patch(
            "services.google_generator.GoogleGeminiGenerator.get_instance",
            return_value=mock_generator,
        ):
            await run_generation(
                "generation-no-muscles-task",
                _tiny_png_bytes(),
                "image/png",
                generate_muscles=False,
            )

        updated = (
            await db_session.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id == "generation-no-muscles-task"
                )
            )
        ).scalar_one()
        assert updated.status == GenerateStatus.COMPLETED.value
        assert updated.photo_url == "/p.png"
        assert updated.muscles_url is None
        assert updated.analyzed_muscles_json is None
        assert mock_storage.upload_bytes.await_count == 1
