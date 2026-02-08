from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import types

from PIL import Image, ImageDraw

from services.pose_fidelity import (
    MediaPipeLandmarkExtractor,
    PoseFidelityEvaluator,
    PoseFidelityFailureReason,
)


def _base_landmarks() -> dict[str, tuple[float, float, float]]:
    return {
        "nose": (0.50, 0.12, 0.99),
        "left_shoulder": (0.40, 0.30, 0.99),
        "right_shoulder": (0.60, 0.30, 0.99),
        "left_elbow": (0.32, 0.44, 0.99),
        "right_elbow": (0.68, 0.44, 0.99),
        "left_wrist": (0.25, 0.58, 0.99),
        "right_wrist": (0.75, 0.58, 0.99),
        "left_hip": (0.45, 0.55, 0.99),
        "right_hip": (0.55, 0.55, 0.99),
        "left_knee": (0.44, 0.76, 0.99),
        "right_knee": (0.56, 0.76, 0.99),
        "left_ankle": (0.43, 0.92, 0.99),
        "right_ankle": (0.57, 0.92, 0.99),
    }


def _perturb(
    points: dict[str, tuple[float, float, float]], dx: float, dy: float
) -> dict[str, tuple[float, float, float]]:
    return {k: (v[0] + dx, v[1] + dy, v[2]) for k, v in points.items()}


@dataclass
class _StubExtractor:
    mapping: dict[bytes, dict[str, tuple[float, float, float]] | None]
    available: bool = True

    def extract_landmarks(
        self, image_bytes: bytes
    ) -> dict[str, tuple[float, float, float]] | None:
        return self.mapping.get(image_bytes)


def test_pose_fidelity_unavailable_detector_returns_non_performed_result():
    evaluator = PoseFidelityEvaluator(extractor=_StubExtractor({}, available=False))
    result = evaluator.evaluate(b"source", b"generated")

    assert result.available is False
    assert result.validation_performed is False
    assert result.failure_reason == PoseFidelityFailureReason.DETECTOR_UNAVAILABLE


def test_pose_fidelity_defaults_are_strictened_for_pose_lock():
    evaluator = PoseFidelityEvaluator(extractor=_StubExtractor({}, available=False))

    assert evaluator.score_threshold == 0.80
    assert evaluator.max_joint_delta_degrees == 20.0
    assert evaluator.min_visibility == 0.45
    assert evaluator.min_joint_matches == 8


def test_mediapipe_extractor_gracefully_disables_when_solutions_api_missing(monkeypatch):
    fake_mp = types.SimpleNamespace(__version__="0.10.32", tasks=object())
    monkeypatch.setitem(__import__("sys").modules, "mediapipe", fake_mp)

    extractor = MediaPipeLandmarkExtractor()

    assert extractor.available is False
    assert extractor.extract_landmarks(b"ignored") is None


def test_pose_fidelity_default_min_joint_matches_rejects_half_body_landmarks():
    source = _base_landmarks()
    generated = _base_landmarks()

    # Keep only left-side joints visible to produce ~4 computable joint angles.
    for key in (
        "right_shoulder",
        "right_elbow",
        "right_wrist",
        "right_hip",
        "right_knee",
        "right_ankle",
    ):
        x, y, _ = source[key]
        source[key] = (x, y, 0.0)
        x, y, _ = generated[key]
        generated[key] = (x, y, 0.0)

    evaluator = PoseFidelityEvaluator(
        extractor=_StubExtractor({b"source": source, b"generated": generated})
    )
    result = evaluator.evaluate(b"source", b"generated")

    assert result.validation_performed is True
    assert result.passed is False
    assert result.compared_joints < evaluator.min_joint_matches
    assert result.failure_reason == PoseFidelityFailureReason.INSUFFICIENT_JOINTS


def test_pose_fidelity_detects_matching_pose_as_pass():
    source = _base_landmarks()
    generated = _perturb(source, dx=0.01, dy=0.005)

    evaluator = PoseFidelityEvaluator(
        extractor=_StubExtractor({b"source": source, b"generated": generated}),
        score_threshold=0.75,
        max_joint_delta_degrees=25.0,
    )
    result = evaluator.evaluate(b"source", b"generated")

    assert result.validation_performed is True
    assert result.passed is True
    assert result.pose_score >= 0.75
    assert result.max_joint_delta <= 25.0
    assert result.compared_joints >= 6


def test_pose_fidelity_accepts_best_mirrored_candidate():
    source = _base_landmarks()
    source["left_wrist"] = (0.22, 0.46, 0.99)
    source["right_wrist"] = (0.78, 0.66, 0.99)
    source["left_ankle"] = (0.38, 0.90, 0.99)
    source["right_ankle"] = (0.62, 0.96, 0.99)

    generated = {k: (1.0 - v[0], v[1], v[2]) for k, v in source.items()}

    evaluator = PoseFidelityEvaluator(
        extractor=_StubExtractor({b"source": source, b"generated": generated}),
        score_threshold=0.70,
        max_joint_delta_degrees=25.0,
        min_joint_matches=6,
    )
    result = evaluator.evaluate(b"source", b"generated")

    assert result.validation_performed is True
    assert result.passed is True
    assert result.failure_reason is None
    assert result.pose_score >= 0.70
    assert result.mirror_suspected is False


def test_pose_fidelity_rejects_large_joint_deviation():
    source = _base_landmarks()
    generated = _base_landmarks()
    # Force clear geometric drift on left leg to break knee/hip consistency.
    generated["left_knee"] = (0.26, 0.62, 0.99)
    generated["left_ankle"] = (0.22, 0.79, 0.99)

    evaluator = PoseFidelityEvaluator(
        extractor=_StubExtractor({b"source": source, b"generated": generated}),
        score_threshold=0.82,
        max_joint_delta_degrees=20.0,
    )
    result = evaluator.evaluate(b"source", b"generated")

    assert result.validation_performed is True
    assert result.passed is False
    assert result.failure_reason == PoseFidelityFailureReason.SCORE_BELOW_THRESHOLD
    assert result.max_joint_delta > 20.0 or result.pose_score < 0.82


def test_pose_fidelity_source_without_pose_returns_reason():
    evaluator = PoseFidelityEvaluator(
        extractor=_StubExtractor(
            {
                b"source": None,
                b"generated": _base_landmarks(),
            }
        )
    )
    result = evaluator.evaluate(b"source", b"generated")

    assert result.validation_performed is True
    assert result.passed is False
    assert result.failure_reason == PoseFidelityFailureReason.SOURCE_NO_POSE


def _silhouette_bytes(*, shift_leg: bool = False) -> bytes:
    img = Image.new("RGB", (256, 256), "white")
    draw = ImageDraw.Draw(img)
    # Head + torso
    draw.ellipse((108, 28, 148, 68), fill="black")
    draw.polygon([(128, 68), (96, 150), (160, 150)], fill="black")
    # Arms
    draw.rectangle((70, 90, 110, 112), fill="black")
    draw.rectangle((146, 90, 186, 112), fill="black")
    # Legs
    if shift_leg:
        draw.polygon([(96, 150), (72, 220), (96, 228), (120, 162)], fill="black")
        draw.polygon([(160, 150), (178, 226), (202, 220), (176, 156)], fill="black")
    else:
        draw.polygon([(96, 150), (84, 228), (108, 228), (120, 156)], fill="black")
        draw.polygon([(160, 150), (148, 228), (172, 228), (176, 156)], fill="black")

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def test_pose_fidelity_uses_silhouette_fallback_when_landmark_detector_unavailable():
    evaluator = PoseFidelityEvaluator(extractor=None, silhouette_score_threshold=0.7)
    # Keep silhouette fallback enabled while forcing primary extractor unavailable.
    evaluator._extractor = _StubExtractor({}, available=False)  # type: ignore[attr-defined]

    src = _silhouette_bytes(shift_leg=False)
    gen = _silhouette_bytes(shift_leg=True)
    result = evaluator.evaluate(src, gen)

    assert result.validation_performed is True
    assert result.available is True
    assert result.source_detected is True
    assert result.generated_detected is True
    assert result.failure_reason in {
        PoseFidelityFailureReason.SCORE_BELOW_THRESHOLD,
        None,
    }
