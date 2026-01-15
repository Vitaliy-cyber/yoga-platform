"""
Pose Detection Service using MediaPipe.

Визначає позу людини на зображенні та обчислює кути суглобів
для подальшого визначення активних м'язів.
"""

import logging
from dataclasses import dataclass
from typing import Optional, List, Dict, Tuple
from enum import Enum

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


class BodyPart(Enum):
    """Частини тіла для pose detection"""
    NOSE = 0
    LEFT_EYE_INNER = 1
    LEFT_EYE = 2
    LEFT_EYE_OUTER = 3
    RIGHT_EYE_INNER = 4
    RIGHT_EYE = 5
    RIGHT_EYE_OUTER = 6
    LEFT_EAR = 7
    RIGHT_EAR = 8
    MOUTH_LEFT = 9
    MOUTH_RIGHT = 10
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_PINKY = 17
    RIGHT_PINKY = 18
    LEFT_INDEX = 19
    RIGHT_INDEX = 20
    LEFT_THUMB = 21
    RIGHT_THUMB = 22
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT_INDEX = 31
    RIGHT_FOOT_INDEX = 32


@dataclass
class Landmark:
    """Ключова точка тіла"""
    x: float  # 0-1, normalized
    y: float  # 0-1, normalized
    z: float  # depth
    visibility: float  # 0-1, confidence


@dataclass
class JointAngle:
    """Кут суглоба"""
    name: str
    angle: float  # degrees
    side: str  # "left" or "right"


@dataclass
class PoseAnalysis:
    """Результат аналізу пози"""
    landmarks: Dict[str, Landmark]
    joint_angles: List[JointAngle]
    pose_type: str  # standing, seated, inverted, etc.
    active_muscles: List[str]  # список активних м'язів


class PoseDetector:
    """
    Детектор пози на основі MediaPipe.

    Визначає 33 ключові точки тіла та обчислює кути суглобів.
    """

    _instance: Optional["PoseDetector"] = None
    _pose = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls) -> "PoseDetector":
        if cls._instance is None:
            cls._instance = cls()
        if not cls._initialized:
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        """Ініціалізація MediaPipe Pose"""
        if self._initialized:
            return

        try:
            import mediapipe as mp

            self._mp_pose = mp.solutions.pose
            self._pose = self._mp_pose.Pose(
                static_image_mode=True,
                model_complexity=2,  # 0, 1, or 2 (higher = more accurate)
                enable_segmentation=False,
                min_detection_confidence=0.5,
            )

            self._initialized = True
            logger.info("PoseDetector initialized successfully")

        except ImportError:
            raise RuntimeError("MediaPipe не встановлено! pip install mediapipe")
        except Exception as e:
            logger.error(f"Failed to initialize PoseDetector: {e}")
            raise

    def detect(self, image_path: str) -> Optional[PoseAnalysis]:
        """
        Детектує позу на зображенні.

        Args:
            image_path: шлях до зображення

        Returns:
            PoseAnalysis або None якщо позу не знайдено
        """
        import cv2

        # Завантажуємо зображення
        image = cv2.imread(image_path)
        if image is None:
            logger.error(f"Could not load image: {image_path}")
            return None

        # Конвертуємо BGR -> RGB
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Детектуємо позу
        results = self._pose.process(image_rgb)

        if not results.pose_landmarks:
            logger.warning(f"No pose detected in image: {image_path}")
            return None

        # Конвертуємо landmarks
        landmarks = self._extract_landmarks(results.pose_landmarks)

        # Обчислюємо кути суглобів
        joint_angles = self._calculate_joint_angles(landmarks)

        # Визначаємо тип пози
        pose_type = self._classify_pose(landmarks, joint_angles)

        # Визначаємо активні м'язи
        active_muscles = self._determine_active_muscles(joint_angles, pose_type)

        return PoseAnalysis(
            landmarks=landmarks,
            joint_angles=joint_angles,
            pose_type=pose_type,
            active_muscles=active_muscles,
        )

    def _extract_landmarks(self, pose_landmarks) -> Dict[str, Landmark]:
        """Витягує landmarks у зручний формат"""
        landmarks = {}

        for part in BodyPart:
            lm = pose_landmarks.landmark[part.value]
            landmarks[part.name.lower()] = Landmark(
                x=lm.x,
                y=lm.y,
                z=lm.z,
                visibility=lm.visibility,
            )

        return landmarks

    def _calculate_angle(self, a: Landmark, b: Landmark, c: Landmark) -> float:
        """
        Обчислює кут між трьома точками (кут при точці b).

        Returns:
            Кут в градусах (0-180)
        """
        # Вектори
        ba = np.array([a.x - b.x, a.y - b.y])
        bc = np.array([c.x - b.x, c.y - b.y])

        # Косинус кута
        cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
        cos_angle = np.clip(cos_angle, -1, 1)

        # Кут в градусах
        angle = np.degrees(np.arccos(cos_angle))

        return angle

    def _calculate_joint_angles(self, landmarks: Dict[str, Landmark]) -> List[JointAngle]:
        """Обчислює кути всіх основних суглобів"""
        angles = []

        # Лівий лікоть (плече-лікоть-зап'ястя)
        if all(landmarks.get(p) for p in ["left_shoulder", "left_elbow", "left_wrist"]):
            angle = self._calculate_angle(
                landmarks["left_shoulder"],
                landmarks["left_elbow"],
                landmarks["left_wrist"],
            )
            angles.append(JointAngle("elbow", angle, "left"))

        # Правий лікоть
        if all(landmarks.get(p) for p in ["right_shoulder", "right_elbow", "right_wrist"]):
            angle = self._calculate_angle(
                landmarks["right_shoulder"],
                landmarks["right_elbow"],
                landmarks["right_wrist"],
            )
            angles.append(JointAngle("elbow", angle, "right"))

        # Ліве плече (лікоть-плече-стегно)
        if all(landmarks.get(p) for p in ["left_elbow", "left_shoulder", "left_hip"]):
            angle = self._calculate_angle(
                landmarks["left_elbow"],
                landmarks["left_shoulder"],
                landmarks["left_hip"],
            )
            angles.append(JointAngle("shoulder", angle, "left"))

        # Праве плече
        if all(landmarks.get(p) for p in ["right_elbow", "right_shoulder", "right_hip"]):
            angle = self._calculate_angle(
                landmarks["right_elbow"],
                landmarks["right_shoulder"],
                landmarks["right_hip"],
            )
            angles.append(JointAngle("shoulder", angle, "right"))

        # Ліве коліно (стегно-коліно-щиколотка)
        if all(landmarks.get(p) for p in ["left_hip", "left_knee", "left_ankle"]):
            angle = self._calculate_angle(
                landmarks["left_hip"],
                landmarks["left_knee"],
                landmarks["left_ankle"],
            )
            angles.append(JointAngle("knee", angle, "left"))

        # Праве коліно
        if all(landmarks.get(p) for p in ["right_hip", "right_knee", "right_ankle"]):
            angle = self._calculate_angle(
                landmarks["right_hip"],
                landmarks["right_knee"],
                landmarks["right_ankle"],
            )
            angles.append(JointAngle("knee", angle, "right"))

        # Ліве стегно (плече-стегно-коліно)
        if all(landmarks.get(p) for p in ["left_shoulder", "left_hip", "left_knee"]):
            angle = self._calculate_angle(
                landmarks["left_shoulder"],
                landmarks["left_hip"],
                landmarks["left_knee"],
            )
            angles.append(JointAngle("hip", angle, "left"))

        # Праве стегно
        if all(landmarks.get(p) for p in ["right_shoulder", "right_hip", "right_knee"]):
            angle = self._calculate_angle(
                landmarks["right_shoulder"],
                landmarks["right_hip"],
                landmarks["right_knee"],
            )
            angles.append(JointAngle("hip", angle, "right"))

        return angles

    def _classify_pose(self, landmarks: Dict[str, Landmark], angles: List[JointAngle]) -> str:
        """Класифікує тип пози"""
        # Перевіряємо положення голови відносно стегон
        nose = landmarks.get("nose")
        left_hip = landmarks.get("left_hip")
        right_hip = landmarks.get("right_hip")

        if not all([nose, left_hip, right_hip]):
            return "unknown"

        hip_y = (left_hip.y + right_hip.y) / 2

        # Якщо голова нижче стегон - перевернута поза
        if nose.y > hip_y + 0.1:
            return "inverted"

        # Перевіряємо кути колін
        knee_angles = [a for a in angles if a.name == "knee"]
        avg_knee_angle = np.mean([a.angle for a in knee_angles]) if knee_angles else 180

        # Якщо коліна зігнуті - сидяча поза
        if avg_knee_angle < 120:
            return "seated"

        # Перевіряємо кути стегон
        hip_angles = [a for a in angles if a.name == "hip"]
        avg_hip_angle = np.mean([a.angle for a in hip_angles]) if hip_angles else 180

        # Якщо стегна сильно зігнуті - нахил
        if avg_hip_angle < 90:
            return "forward_bend"

        return "standing"

    def _determine_active_muscles(self, angles: List[JointAngle], pose_type: str) -> List[str]:
        """
        Визначає активні м'язи на основі кутів суглобів та типу пози.

        Це спрощена версія - в реальності потрібна більш детальна біомеханічна модель.
        """
        active = []

        for angle in angles:
            # Ліктьові м'язи
            if angle.name == "elbow":
                if angle.angle < 90:  # Зігнутий лікоть
                    active.append(f"{angle.side}_biceps")
                elif angle.angle > 150:  # Випрямлений лікоть
                    active.append(f"{angle.side}_triceps")

            # Плечові м'язи
            elif angle.name == "shoulder":
                if angle.angle < 60:  # Рука притиснута
                    active.append(f"{angle.side}_latissimus")
                elif angle.angle > 90:  # Рука піднята
                    active.append(f"{angle.side}_deltoid")
                    active.append(f"{angle.side}_trapezius")

            # Колінні м'язи
            elif angle.name == "knee":
                if angle.angle < 120:  # Зігнуте коліно
                    active.append(f"{angle.side}_quadriceps")
                    active.append(f"{angle.side}_hamstrings")
                elif angle.angle > 160:  # Випрямлене коліно
                    active.append(f"{angle.side}_quadriceps")

            # Стегнові м'язи
            elif angle.name == "hip":
                if angle.angle < 90:  # Нахил вперед
                    active.append(f"{angle.side}_gluteus")
                    active.append(f"{angle.side}_hamstrings")
                elif angle.angle > 150:  # Пряма постава
                    active.append(f"{angle.side}_hip_flexors")

        # Додаємо м'язи корпусу для балансових поз
        if pose_type in ["standing", "inverted"]:
            active.extend(["core_abs", "core_obliques", "erector_spinae"])

        if pose_type == "forward_bend":
            active.extend(["erector_spinae", "hamstrings"])

        # Видаляємо дублікати
        return list(set(active))

    def close(self):
        """Закриває ресурси"""
        if self._pose:
            self._pose.close()
            self._pose = None
            self._initialized = False
