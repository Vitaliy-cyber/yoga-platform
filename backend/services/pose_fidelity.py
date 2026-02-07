"""
Pose fidelity evaluation for image-to-image generation.

Compares source and generated poses using body landmarks and joint angles.
The implementation is dependency-tolerant: if MediaPipe is unavailable,
validation is marked as unavailable rather than crashing generation.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from enum import Enum
from io import BytesIO
from statistics import mean
from typing import Dict, Protocol

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


class PoseMismatchError(RuntimeError):
    """Raised when generated image does not preserve source pose geometry."""


class PoseFidelityFailureReason(str, Enum):
    DETECTOR_UNAVAILABLE = "detector_unavailable"
    SOURCE_NO_POSE = "source_no_pose"
    GENERATED_NO_POSE = "generated_no_pose"
    INSUFFICIENT_JOINTS = "insufficient_joints"
    SCORE_BELOW_THRESHOLD = "score_below_threshold"


@dataclass(frozen=True)
class PoseFidelityResult:
    available: bool
    validation_performed: bool
    passed: bool
    pose_score: float
    angle_score: float
    position_score: float
    max_joint_delta: float
    joint_deltas: dict[str, float]
    compared_joints: int
    compared_points: int
    source_detected: bool
    generated_detected: bool
    failure_reason: PoseFidelityFailureReason | None = None
    mirror_suspected: bool = False


class LandmarkExtractorProtocol(Protocol):
    @property
    def available(self) -> bool: ...

    def extract_landmarks(
        self, image_bytes: bytes
    ) -> Dict[str, tuple[float, float, float]] | None: ...


class MediaPipeLandmarkExtractor:
    """Extract pose landmarks using MediaPipe (if available)."""

    LANDMARK_IDS = {
        "nose": 0,
        "left_ear": 7,
        "right_ear": 8,
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
        "left_heel": 29,
        "right_heel": 30,
        "left_foot_index": 31,
        "right_foot_index": 32,
    }

    def __init__(self, *, min_detection_confidence: float = 0.45):
        self._available = False
        self._mp_pose = None
        self._pose = None
        self._np = None
        try:
            import mediapipe as mp
            import numpy as np

            self._np = np
            mp_solutions = getattr(mp, "solutions", None)
            mp_pose = getattr(mp_solutions, "pose", None) if mp_solutions is not None else None
            if mp_pose is None:
                logger.warning(
                    "MediaPipe package lacks solutions.pose API (version=%s); "
                    "landmark-based pose fidelity is disabled on this runtime.",
                    getattr(mp, "__version__", "unknown"),
                )
                return
            self._mp_pose = mp_pose
            self._pose = self._mp_pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                enable_segmentation=False,
                min_detection_confidence=min_detection_confidence,
            )
            self._available = True
        except Exception as exc:
            logger.warning("Pose fidelity detector unavailable: %s", exc)

    @property
    def available(self) -> bool:
        return self._available

    def extract_landmarks(
        self, image_bytes: bytes
    ) -> Dict[str, tuple[float, float, float]] | None:
        if not self._available or not self._pose or self._np is None:
            return None
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                rgb = ImageOps.exif_transpose(image).convert("RGB")
                image_np = self._np.array(rgb)
            results = self._pose.process(image_np)
            if not results.pose_landmarks:
                return None
            out: Dict[str, tuple[float, float, float]] = {}
            raw = results.pose_landmarks.landmark
            for name, idx in self.LANDMARK_IDS.items():
                lm = raw[idx]
                out[name] = (float(lm.x), float(lm.y), float(lm.visibility))
            return out
        except Exception as exc:
            logger.warning("Pose fidelity landmark extraction failed: %s", exc)
            return None


class PoseFidelityEvaluator:
    """
    Evaluate geometric similarity between source and generated human poses.
    """

    ANGLE_TRIPLES = {
        "left_elbow": ("left_shoulder", "left_elbow", "left_wrist"),
        "right_elbow": ("right_shoulder", "right_elbow", "right_wrist"),
        "left_shoulder": ("left_elbow", "left_shoulder", "left_hip"),
        "right_shoulder": ("right_elbow", "right_shoulder", "right_hip"),
        "left_hip": ("left_shoulder", "left_hip", "left_knee"),
        "right_hip": ("right_shoulder", "right_hip", "right_knee"),
        "left_knee": ("left_hip", "left_knee", "left_ankle"),
        "right_knee": ("right_hip", "right_knee", "right_ankle"),
        "left_ankle": ("left_knee", "left_ankle", "left_foot_index"),
        "right_ankle": ("right_knee", "right_ankle", "right_foot_index"),
        "left_neck": ("nose", "left_shoulder", "left_hip"),
        "right_neck": ("nose", "right_shoulder", "right_hip"),
    }
    POSITION_POINTS = (
        "nose",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
        "left_heel",
        "right_heel",
        "left_foot_index",
        "right_foot_index",
    )

    def __init__(
        self,
        *,
        extractor: LandmarkExtractorProtocol | None = None,
        score_threshold: float = 0.86,
        silhouette_score_threshold: float = 0.82,
        max_joint_delta_degrees: float = 14.0,
        min_visibility: float = 0.45,
        min_joint_matches: int = 6,
    ):
        self._extractor = extractor or MediaPipeLandmarkExtractor()
        self._allow_silhouette_fallback = extractor is None
        self.score_threshold = score_threshold
        self.silhouette_score_threshold = silhouette_score_threshold
        self.max_joint_delta_degrees = max_joint_delta_degrees
        self.min_visibility = min_visibility
        self.min_joint_matches = min_joint_matches

    @property
    def available(self) -> bool:
        return bool(getattr(self._extractor, "available", False))

    def evaluate(self, source_bytes: bytes, generated_bytes: bytes) -> PoseFidelityResult:
        if not self.available:
            if self._allow_silhouette_fallback:
                silhouette_result = self._evaluate_by_silhouette(
                    source_bytes, generated_bytes
                )
                if silhouette_result is not None:
                    return silhouette_result
            return PoseFidelityResult(
                available=False,
                validation_performed=False,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=0.0,
                joint_deltas={},
                compared_joints=0,
                compared_points=0,
                source_detected=False,
                generated_detected=False,
                failure_reason=PoseFidelityFailureReason.DETECTOR_UNAVAILABLE,
            )

        source_landmarks = self._extractor.extract_landmarks(source_bytes)
        generated_landmarks = self._extractor.extract_landmarks(generated_bytes)

        if not source_landmarks:
            if self._allow_silhouette_fallback:
                silhouette_result = self._evaluate_by_silhouette(
                    source_bytes, generated_bytes
                )
                if silhouette_result is not None:
                    return silhouette_result
            return PoseFidelityResult(
                available=True,
                validation_performed=True,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=0.0,
                joint_deltas={},
                compared_joints=0,
                compared_points=0,
                source_detected=False,
                generated_detected=bool(generated_landmarks),
                failure_reason=PoseFidelityFailureReason.SOURCE_NO_POSE,
            )

        if not generated_landmarks:
            if self._allow_silhouette_fallback:
                silhouette_result = self._evaluate_by_silhouette(
                    source_bytes, generated_bytes
                )
                if silhouette_result is not None:
                    return silhouette_result
            return PoseFidelityResult(
                available=True,
                validation_performed=True,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=0.0,
                joint_deltas={},
                compared_joints=0,
                compared_points=0,
                source_detected=True,
                generated_detected=False,
                failure_reason=PoseFidelityFailureReason.GENERATED_NO_POSE,
            )

        joint_deltas = self._compute_joint_deltas(source_landmarks, generated_landmarks)
        if len(joint_deltas) < self.min_joint_matches:
            if self._allow_silhouette_fallback:
                silhouette_result = self._evaluate_by_silhouette(
                    source_bytes, generated_bytes
                )
                if silhouette_result is not None:
                    return silhouette_result
            return PoseFidelityResult(
                available=True,
                validation_performed=True,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=max(joint_deltas.values()) if joint_deltas else 0.0,
                joint_deltas=joint_deltas,
                compared_joints=len(joint_deltas),
                compared_points=0,
                source_detected=True,
                generated_detected=True,
                failure_reason=PoseFidelityFailureReason.INSUFFICIENT_JOINTS,
            )

        angle_score = self._joint_score(joint_deltas)
        position_score, compared_points = self._position_score(
            source_landmarks, generated_landmarks
        )
        pose_score = (0.68 * angle_score) + (0.32 * position_score)
        max_joint_delta = max(joint_deltas.values()) if joint_deltas else 0.0
        mirror_suspected = self._is_mirror_suspected(source_landmarks, generated_landmarks)
        passed = (
            pose_score >= self.score_threshold
            and max_joint_delta <= self.max_joint_delta_degrees
            and not mirror_suspected
        )

        return PoseFidelityResult(
            available=True,
            validation_performed=True,
            passed=passed,
            pose_score=float(max(0.0, min(1.0, pose_score))),
            angle_score=float(max(0.0, min(1.0, angle_score))),
            position_score=float(max(0.0, min(1.0, position_score))),
            max_joint_delta=float(max_joint_delta),
            joint_deltas=joint_deltas,
            compared_joints=len(joint_deltas),
            compared_points=compared_points,
            source_detected=True,
            generated_detected=True,
            failure_reason=(
                None if passed else PoseFidelityFailureReason.SCORE_BELOW_THRESHOLD
            ),
            mirror_suspected=mirror_suspected,
        )

    def _is_landmark_visible(
        self, landmarks: Dict[str, tuple[float, float, float]], name: str
    ) -> bool:
        point = landmarks.get(name)
        if point is None:
            return False
        return point[2] >= self.min_visibility

    def _compute_joint_deltas(
        self,
        source: Dict[str, tuple[float, float, float]],
        generated: Dict[str, tuple[float, float, float]],
    ) -> dict[str, float]:
        deltas: dict[str, float] = {}
        for joint_name, (a, b, c) in self.ANGLE_TRIPLES.items():
            if not (
                self._is_landmark_visible(source, a)
                and self._is_landmark_visible(source, b)
                and self._is_landmark_visible(source, c)
                and self._is_landmark_visible(generated, a)
                and self._is_landmark_visible(generated, b)
                and self._is_landmark_visible(generated, c)
            ):
                continue
            src_angle = self._calculate_angle(source[a], source[b], source[c])
            gen_angle = self._calculate_angle(generated[a], generated[b], generated[c])
            if src_angle is None or gen_angle is None:
                continue
            deltas[joint_name] = abs(src_angle - gen_angle)
        return deltas

    @staticmethod
    def _calculate_angle(
        a: tuple[float, float, float],
        b: tuple[float, float, float],
        c: tuple[float, float, float],
    ) -> float | None:
        ba_x, ba_y = a[0] - b[0], a[1] - b[1]
        bc_x, bc_y = c[0] - b[0], c[1] - b[1]
        dot = (ba_x * bc_x) + (ba_y * bc_y)
        mag_ba = math.hypot(ba_x, ba_y)
        mag_bc = math.hypot(bc_x, bc_y)
        if mag_ba < 1e-6 or mag_bc < 1e-6:
            return None
        cos_theta = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
        return math.degrees(math.acos(cos_theta))

    @staticmethod
    def _joint_score(joint_deltas: dict[str, float]) -> float:
        # 0 delta -> 1.0 score, 45+ deg delta -> 0 score for that joint.
        per_joint = [max(0.0, 1.0 - (delta / 45.0)) for delta in joint_deltas.values()]
        return float(mean(per_joint)) if per_joint else 0.0

    def _position_score(
        self,
        source: Dict[str, tuple[float, float, float]],
        generated: Dict[str, tuple[float, float, float]],
    ) -> tuple[float, int]:
        source_norm = self._normalize_to_torso(source)
        generated_norm = self._normalize_to_torso(generated)
        if not source_norm or not generated_norm:
            return 0.0, 0

        point_scores: list[float] = []
        for name in self.POSITION_POINTS:
            if name not in source_norm or name not in generated_norm:
                continue
            dx = source_norm[name][0] - generated_norm[name][0]
            dy = source_norm[name][1] - generated_norm[name][1]
            distance = math.hypot(dx, dy)
            # Distances around 1.2 torso-widths are considered mismatch.
            point_scores.append(max(0.0, 1.0 - (distance / 1.2)))

        if not point_scores:
            return 0.0, 0
        return float(mean(point_scores)), len(point_scores)

    def _evaluate_by_silhouette(
        self, source_bytes: bytes, generated_bytes: bytes
    ) -> PoseFidelityResult | None:
        try:
            import cv2
            import numpy as np
        except Exception as exc:
            logger.warning("Pose silhouette fallback unavailable: %s", exc)
            return None

        source_mask, source_contour = self._normalized_silhouette(
            source_bytes, cv2=cv2, np=np
        )
        generated_mask, generated_contour = self._normalized_silhouette(
            generated_bytes, cv2=cv2, np=np
        )

        if source_mask is None:
            return PoseFidelityResult(
                available=True,
                validation_performed=True,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=0.0,
                joint_deltas={},
                compared_joints=0,
                compared_points=0,
                source_detected=False,
                generated_detected=generated_mask is not None,
                failure_reason=PoseFidelityFailureReason.SOURCE_NO_POSE,
            )

        if generated_mask is None:
            return PoseFidelityResult(
                available=True,
                validation_performed=True,
                passed=False,
                pose_score=0.0,
                angle_score=0.0,
                position_score=0.0,
                max_joint_delta=0.0,
                joint_deltas={},
                compared_joints=0,
                compared_points=0,
                source_detected=True,
                generated_detected=False,
                failure_reason=PoseFidelityFailureReason.GENERATED_NO_POSE,
            )

        iou = self._mask_iou(source_mask, generated_mask, np=np)
        profile_score = self._profile_similarity(
            source_mask, generated_mask, cv2=cv2, np=np
        )
        shape_score = 0.0
        if source_contour is not None and generated_contour is not None:
            # Lower is better for matchShapes, clamp to 0..1 score
            shape_distance = cv2.matchShapes(
                source_contour, generated_contour, cv2.CONTOURS_MATCH_I1, 0.0
            )
            shape_score = max(0.0, 1.0 - (min(float(shape_distance), 1.4) / 1.4))

        pose_score = (0.45 * iou) + (0.35 * shape_score) + (0.20 * profile_score)
        passed = pose_score >= self.silhouette_score_threshold

        return PoseFidelityResult(
            available=True,
            validation_performed=True,
            passed=passed,
            pose_score=float(max(0.0, min(1.0, pose_score))),
            angle_score=float(max(0.0, min(1.0, shape_score))),
            position_score=float(max(0.0, min(1.0, iou))),
            max_joint_delta=0.0,
            joint_deltas={},
            compared_joints=0,
            compared_points=int(np.count_nonzero(source_mask)),
            source_detected=True,
            generated_detected=True,
            failure_reason=(
                None if passed else PoseFidelityFailureReason.SCORE_BELOW_THRESHOLD
            ),
        )

    @staticmethod
    def _mask_iou(mask_a, mask_b, *, np) -> float:
        a = mask_a > 0
        b = mask_b > 0
        inter = np.logical_and(a, b).sum()
        union = np.logical_or(a, b).sum()
        if union <= 0:
            return 0.0
        return float(inter / union)

    @staticmethod
    def _profile_similarity(mask_a, mask_b, *, cv2, np) -> float:
        a = (mask_a > 0).astype(np.float32)
        b = (mask_b > 0).astype(np.float32)

        a_h = a.sum(axis=1)
        b_h = b.sum(axis=1)
        a_w = a.sum(axis=0)
        b_w = b.sum(axis=0)

        if a_h.sum() <= 0 or b_h.sum() <= 0 or a_w.sum() <= 0 or b_w.sum() <= 0:
            return 0.0

        a_h /= max(1e-6, float(a_h.sum()))
        b_h /= max(1e-6, float(b_h.sum()))
        a_w /= max(1e-6, float(a_w.sum()))
        b_w /= max(1e-6, float(b_w.sum()))

        a_h_small = cv2.resize(a_h.reshape(-1, 1), (1, 64), interpolation=cv2.INTER_AREA).reshape(-1)
        b_h_small = cv2.resize(b_h.reshape(-1, 1), (1, 64), interpolation=cv2.INTER_AREA).reshape(-1)
        a_w_small = cv2.resize(a_w.reshape(1, -1), (64, 1), interpolation=cv2.INTER_AREA).reshape(-1)
        b_w_small = cv2.resize(b_w.reshape(1, -1), (64, 1), interpolation=cv2.INTER_AREA).reshape(-1)

        h_score = max(0.0, 1.0 - float(np.mean(np.abs(a_h_small - b_h_small))) * 6.0)
        w_score = max(0.0, 1.0 - float(np.mean(np.abs(a_w_small - b_w_small))) * 6.0)
        return float((h_score + w_score) / 2.0)

    @classmethod
    def _normalized_silhouette(cls, image_bytes: bytes, *, cv2, np):
        image = None
        try:
            with Image.open(BytesIO(image_bytes)) as pil_image:
                rgb = ImageOps.exif_transpose(pil_image).convert("RGB")
                rgb_np = np.array(rgb)
                image = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2BGR)
        except Exception:
            image = None

        if image is None:
            image_array = np.frombuffer(image_bytes, dtype=np.uint8)
            image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image is None:
            return None, None

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        masks = []
        for threshold_mode in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
            _, mask = cv2.threshold(
                gray, 0, 255, threshold_mode | cv2.THRESH_OTSU
            )
            mask = cv2.morphologyEx(
                mask, cv2.MORPH_OPEN, np.ones((3, 3), dtype=np.uint8), iterations=1
            )
            mask = cv2.morphologyEx(
                mask, cv2.MORPH_CLOSE, np.ones((5, 5), dtype=np.uint8), iterations=1
            )
            masks.append(mask)

        best_mask = None
        best_contour = None
        best_score = -1.0
        h, w = gray.shape
        frame_area = float(max(1, h * w))

        for mask in masks:
            contours, _ = cv2.findContours(
                mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not contours:
                continue
            contour = max(contours, key=cv2.contourArea)
            area = float(cv2.contourArea(contour))
            if area < 0.01 * frame_area:
                continue
            area_ratio = area / frame_area
            # Prefer realistic body occupancy (~10-70% of frame).
            occupancy_score = 1.0 - min(abs(area_ratio - 0.35), 0.35) / 0.35
            if occupancy_score > best_score:
                best_score = occupancy_score
                best_mask = mask
                best_contour = contour

        if best_mask is None or best_contour is None:
            return None, None

        filled = np.zeros_like(best_mask)
        cv2.drawContours(filled, [best_contour], -1, 255, thickness=cv2.FILLED)
        x, y, ww, hh = cv2.boundingRect(best_contour)
        margin_x = int(max(2, ww * 0.08))
        margin_y = int(max(2, hh * 0.08))
        x0 = max(0, x - margin_x)
        y0 = max(0, y - margin_y)
        x1 = min(filled.shape[1], x + ww + margin_x)
        y1 = min(filled.shape[0], y + hh + margin_y)
        cropped = filled[y0:y1, x0:x1]
        if cropped.size == 0:
            return None, None

        side = max(cropped.shape[0], cropped.shape[1])
        square = np.zeros((side, side), dtype=np.uint8)
        oy = (side - cropped.shape[0]) // 2
        ox = (side - cropped.shape[1]) // 2
        square[oy:oy + cropped.shape[0], ox:ox + cropped.shape[1]] = cropped

        normalized = cv2.resize(square, (256, 256), interpolation=cv2.INTER_AREA)
        normalized = (normalized > 127).astype(np.uint8) * 255

        contours, _ = cv2.findContours(
            normalized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        contour = max(contours, key=cv2.contourArea) if contours else None
        return normalized, contour

    def _normalize_to_torso(
        self, landmarks: Dict[str, tuple[float, float, float]]
    ) -> dict[str, tuple[float, float]]:
        required = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")
        if not all(self._is_landmark_visible(landmarks, name) for name in required):
            return {}

        left_shoulder = landmarks["left_shoulder"]
        right_shoulder = landmarks["right_shoulder"]
        left_hip = landmarks["left_hip"]
        right_hip = landmarks["right_hip"]

        cx = (left_shoulder[0] + right_shoulder[0] + left_hip[0] + right_hip[0]) / 4.0
        cy = (left_shoulder[1] + right_shoulder[1] + left_hip[1] + right_hip[1]) / 4.0
        shoulder_span = math.hypot(
            left_shoulder[0] - right_shoulder[0],
            left_shoulder[1] - right_shoulder[1],
        )
        hip_span = math.hypot(left_hip[0] - right_hip[0], left_hip[1] - right_hip[1])
        scale = max(1e-3, (shoulder_span + hip_span) / 2.0)

        out: dict[str, tuple[float, float]] = {}
        for name, (x, y, visibility) in landmarks.items():
            if visibility < self.min_visibility:
                continue
            out[name] = ((x - cx) / scale, (y - cy) / scale)
        return out

    def _is_mirror_suspected(
        self,
        source: Dict[str, tuple[float, float, float]],
        generated: Dict[str, tuple[float, float, float]],
    ) -> bool:
        required = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")
        if not all(name in source and name in generated for name in required):
            return False

        source_shoulder_order = source["left_shoulder"][0] < source["right_shoulder"][0]
        generated_shoulder_order = (
            generated["left_shoulder"][0] < generated["right_shoulder"][0]
        )
        source_hip_order = source["left_hip"][0] < source["right_hip"][0]
        generated_hip_order = generated["left_hip"][0] < generated["right_hip"][0]
        return (source_shoulder_order != generated_shoulder_order) and (
            source_hip_order != generated_hip_order
        )
