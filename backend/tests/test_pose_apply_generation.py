from sqlalchemy import select
from sqlalchemy.orm import selectinload

import pytest

from models.generation_task import GenerationTask
from models.pose import Pose, PoseMuscle
from models.user import User


@pytest.mark.asyncio
async def test_apply_generation_clears_existing_muscle_outputs_when_task_has_no_muscles(
    auth_client,
    db_session,
    sample_muscles,
):
    # Resolve authenticated user created by auth_client fixture.
    user_result = await db_session.execute(select(User).order_by(User.id.asc()))
    user = user_result.scalars().first()
    assert user is not None

    pose = Pose(
        user_id=user.id,
        code="APPLY001",
        name="Apply Generation Pose",
        schema_path="/storage/uploads/source.png",
        photo_path="/storage/generated/old_photo.png",
        muscle_layer_path="/storage/generated/old_muscles.png",
    )
    db_session.add(pose)
    await db_session.flush()

    db_session.add(
        PoseMuscle(
            pose_id=pose.id,
            muscle_id=sample_muscles[0].id,
            activation_level=88,
        )
    )

    task = GenerationTask(
        task_id="task-clear-muscles",
        user_id=user.id,
        status="completed",
        progress=100,
        status_message="Completed!",
        photo_url="/storage/generated/new_photo.png",
        muscles_url=None,
        analyzed_muscles_json=None,
    )
    db_session.add(task)
    await db_session.commit()

    response = await auth_client.post(
        f"/api/poses/{pose.id}/apply-generation/{task.task_id}"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["photo_path"] == "/storage/generated/new_photo.png"
    assert payload["muscle_layer_path"] is None
    assert payload["muscles"] == []

    refreshed_result = await db_session.execute(
        select(Pose)
        .options(selectinload(Pose.pose_muscles))
        .where(Pose.id == pose.id)
    )
    refreshed_pose = refreshed_result.scalar_one()
    assert refreshed_pose.muscle_layer_path is None
    assert refreshed_pose.pose_muscles == []
