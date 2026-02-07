from __future__ import annotations

import types

from services.pose_context import PoseContext, build_pose_context_from_image_bytes


def test_pose_context_to_prompt_text_contains_core_fields():
    context = PoseContext(
        pose_type="seated",
        orientation="left-facing",
        joint_angles={"left_knee": 91.6, "right_knee": 140.1},
        landmarks_detected=14,
        source_kind="schematic",
    )

    text = context.to_prompt_text()
    assert "Pose type: seated" in text
    assert "Orientation: left-facing" in text
    assert "left_knee=92deg" in text
    assert "right_knee=140deg" in text


def test_build_pose_context_returns_none_when_mediapipe_has_no_solutions(monkeypatch):
    fake_mp = types.SimpleNamespace(__version__="0.0-test", tasks=object())
    monkeypatch.setitem(__import__("sys").modules, "mediapipe", fake_mp)

    result = build_pose_context_from_image_bytes(b"not-an-image")
    assert result is None
