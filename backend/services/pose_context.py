from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Dict, Optional

import logging
import math

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)
_missing_solutions_warned = False


@dataclass(frozen=True)
class PoseContext:
    pose_type: str
    orientation: str
    joint_angles: dict[str, float]
    landmarks_detected: int
    source_kind: str = "schematic"

    def to_prompt_text(self) -> str:
        angle_parts = [
            f"{name}={int(round(value))}deg" for name, value in self.joint_angles.items()
        ]
        angles = ", ".join(angle_parts) if angle_parts else "no-joint-angles"
        return (
            "Detected pose context from input image:\n"
            f"- Source kind: {self.source_kind}\n"
            f"- Pose type: {self.pose_type}\n"
            f"- Orientation: {self.orientation}\n"
            f"- Landmarks detected: {self.landmarks_detected}\n"
            f"- Joint angles: {angles}\n"
        )


def _calculate_angle(
    a: tuple[float, float, float], b: tuple[float, float, float], c: tuple[float, float, float]
) -> float:
    ba = (a[0] - b[0], a[1] - b[1], a[2] - b[2])
    bc = (c[0] - b[0], c[1] - b[1], c[2] - b[2])
    dot = (ba[0] * bc[0]) + (ba[1] * bc[1]) + (ba[2] * bc[2])
    mag_ba = math.sqrt((ba[0] ** 2) + (ba[1] ** 2) + (ba[2] ** 2))
    mag_bc = math.sqrt((bc[0] ** 2) + (bc[1] ** 2) + (bc[2] ** 2))
    if mag_ba < 1e-6 or mag_bc < 1e-6:
        return 180.0
    cos_theta = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_theta))


def _safe_pose_type(landmarks: Dict[str, tuple[float, float, float]]) -> str:
    nose = landmarks.get("nose")
    left_hip = landmarks.get("left_hip")
    right_hip = landmarks.get("right_hip")
    if not nose or not left_hip or not right_hip:
        return "unknown"

    hip_y = (left_hip[1] + right_hip[1]) / 2.0
    if nose[1] > hip_y + 0.1:
        return "inverted"

    knees = []
    for side in ("left", "right"):
        hip = landmarks.get(f"{side}_hip")
        knee = landmarks.get(f"{side}_knee")
        ankle = landmarks.get(f"{side}_ankle")
        if hip and knee and ankle:
            knees.append(_calculate_angle(hip, knee, ankle))
    if knees and (sum(knees) / len(knees)) < 120.0:
        return "seated"

    return "standing"


def build_pose_context_from_image_bytes(image_bytes: bytes) -> Optional[PoseContext]:
    """
    Best-effort pose context extraction for prompt enrichment.
    Gracefully returns None when MediaPipe is unavailable in runtime.
    """
    try:
        import mediapipe as mp
        import numpy as np
    except Exception:
        return None

    mp_solutions = getattr(mp, "solutions", None)
    mp_pose = getattr(mp_solutions, "pose", None) if mp_solutions is not None else None
    if mp_pose is None:
        global _missing_solutions_warned
        if not _missing_solutions_warned:
            logger.warning(
                "MediaPipe package lacks solutions.pose API (version=%s); skipping pose-context extraction.",
                getattr(mp, "__version__", "unknown"),
            )
            _missing_solutions_warned = True
        return None

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            image_np = np.array(rgb)
    except Exception:
        return None

    try:
        with mp_pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.4,
        ) as pose:
            results = pose.process(image_np)
    except Exception as exc:
        logger.warning("Pose-context extraction failed: %s", exc)
        return None

    raw_landmarks = getattr(results, "pose_landmarks", None)
    if not raw_landmarks:
        return None

    lm = raw_landmarks.landmark
    ids = {
        "nose": 0,
        "left_shoulder": 11,
        "right_shoulder": 12,
        "left_elbow": 13,
        "right_elbow": 14,
        "left_wrist": 15,
        "right_wrist": 16,
        "left_hip": 23,
        "right_hip": 24,
        "left_knee": 25,
        "right_knee": 26,
        "left_ankle": 27,
        "right_ankle": 28,
    }
    landmarks: Dict[str, tuple[float, float, float]] = {}
    for name, idx in ids.items():
        entry = lm[idx]
        if float(entry.visibility) < 0.35:
            continue
        landmarks[name] = (float(entry.x), float(entry.y), float(entry.z))

    if not landmarks:
        return None

    joint_angles: dict[str, float] = {}
    triples = {
        "left_elbow": ("left_shoulder", "left_elbow", "left_wrist"),
        "right_elbow": ("right_shoulder", "right_elbow", "right_wrist"),
        "left_knee": ("left_hip", "left_knee", "left_ankle"),
        "right_knee": ("right_hip", "right_knee", "right_ankle"),
        "left_hip": ("left_shoulder", "left_hip", "left_knee"),
        "right_hip": ("right_shoulder", "right_hip", "right_knee"),
    }
    for joint_name, (a, b, c) in triples.items():
        if a in landmarks and b in landmarks and c in landmarks:
            joint_angles[joint_name] = _calculate_angle(landmarks[a], landmarks[b], landmarks[c])

    orientation = "left-facing"
    if "left_shoulder" in landmarks and "right_shoulder" in landmarks:
        orientation = (
            "right-facing"
            if landmarks["left_shoulder"][0] > landmarks["right_shoulder"][0]
            else "left-facing"
        )

    return PoseContext(
        pose_type=_safe_pose_type(landmarks),
        orientation=orientation,
        joint_angles=joint_angles,
        landmarks_detected=len(landmarks),
    )
