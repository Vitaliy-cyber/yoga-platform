"""
Muscle Mapper Service.

Визначає активні м'язи на основі pose detection та підсвічує їх на зображенні.
"""

import logging
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

logger = logging.getLogger(__name__)


# Українські назви м'язів
MUSCLE_NAMES_UA = {
    "hamstrings": "Задня поверхня стегна",
    "erector_spinae": "Прямий м'яз спини",
    "gluteus_maximus": "Великий сідничний м'яз",
    "gluteus_medius": "Середній сідничний м'яз",
    "rectus_abdominis": "Прямий м'яз живота",
    "obliques": "Косі м'язи живота",
    "transverse_abdominis": "Поперечний м'яз живота",
    "hip_flexors": "Згиначі стегна",
    "deltoids": "Дельтоподібний м'яз",
    "trapezius": "Трапецієподібний м'яз",
    "latissimus_dorsi": "Найширший м'яз спини",
    "rhomboids": "Ромбоподібні м'язи",
    "quadriceps": "Чотириголовий м'яз",
    "calves": "Литкові м'язи",
    "rotator_cuff": "Ротаторна манжета",
    "biceps": "Біцепс",
    "triceps": "Тріцепс",
    "forearms": "М'язи передпліччя",
    "pectoralis": "Грудні м'язи",
    "serratus_anterior": "Передній зубчастий м'яз",
    # Нові ключі з pose_detector
    "left_biceps": "Біцепс (Л)",
    "right_biceps": "Біцепс (П)",
    "left_triceps": "Трицепс (Л)",
    "right_triceps": "Трицепс (П)",
    "left_deltoid": "Дельта (Л)",
    "right_deltoid": "Дельта (П)",
    "left_trapezius": "Трапеція (Л)",
    "right_trapezius": "Трапеція (П)",
    "left_latissimus": "Широчайша (Л)",
    "right_latissimus": "Широчайша (П)",
    "left_quadriceps": "Квадрицепс (Л)",
    "right_quadriceps": "Квадрицепс (П)",
    "left_hamstrings": "Біцепс стегна (Л)",
    "right_hamstrings": "Біцепс стегна (П)",
    "left_gluteus": "Сідниці (Л)",
    "right_gluteus": "Сідниці (П)",
    "left_hip_flexors": "Згиначі стегна (Л)",
    "right_hip_flexors": "Згиначі стегна (П)",
    "core_abs": "Прес",
    "core_obliques": "Косі м'язи",
}


# Кольори для м'язів (RGB)
MUSCLE_COLORS = {
    "default": (220, 60, 60),  # Червоний
    "high_activation": (255, 50, 50),  # Яскраво-червоний
    "medium_activation": (220, 80, 80),  # Середній червоний
    "low_activation": (180, 100, 100),  # Блідо-червоний
}


class MuscleHighlighter:
    """
    Сервіс для підсвітки активних м'язів на анатомічному зображенні.

    Алгоритм:
    1. Аналізує вхідне зображення з контурами м'язів
    2. Знаходить регіони тіла за кольором (бежевий колір)
    3. Накладає червону підсвітку на активні області
    """

    def __init__(self):
        # Діапазон кольорів тіла на вхідному зображенні (бежевий)
        self.body_color_range = {
            "min": (160, 130, 100),  # Мінімальний RGB
            "max": (255, 240, 220),  # Максимальний RGB
        }

    def highlight_muscles(
        self,
        outline_image_path: str,
        active_muscles: List[str],
        output_path: str,
        activation_levels: Optional[Dict[str, float]] = None,
    ) -> str:
        """
        Підсвічує активні м'язи на зображенні.

        Args:
            outline_image_path: шлях до зображення з контурами м'язів
            active_muscles: список назв активних м'язів
            output_path: шлях для збереження результату
            activation_levels: словник з рівнями активації (0-1)

        Returns:
            шлях до результуючого зображення
        """
        logger.info(f"Highlighting {len(active_muscles)} muscles on image")

        # Завантажуємо зображення
        image = Image.open(outline_image_path).convert("RGBA")
        width, height = image.size

        # Отримуємо пікселі як numpy array
        pixels = np.array(image)

        # Знаходимо пікселі тіла (бежевий колір)
        body_mask = self._create_body_mask(pixels)

        # Якщо рівні активації не вказані - використовуємо за замовчуванням
        if activation_levels is None:
            activation_levels = {m: 0.7 for m in active_muscles}

        # Обчислюємо середню активацію
        avg_activation = np.mean(list(activation_levels.values())) if activation_levels else 0.7

        # Визначаємо колір підсвітки на основі активації
        if avg_activation > 0.7:
            highlight_color = MUSCLE_COLORS["high_activation"]
        elif avg_activation > 0.4:
            highlight_color = MUSCLE_COLORS["medium_activation"]
        else:
            highlight_color = MUSCLE_COLORS["low_activation"]

        # Інтенсивність підсвітки
        alpha = int(avg_activation * 160)  # 0-160 прозорість

        # Створюємо шар підсвітки
        highlight_array = np.zeros((height, width, 4), dtype=np.uint8)
        highlight_array[body_mask] = [
            highlight_color[0],
            highlight_color[1],
            highlight_color[2],
            alpha,
        ]

        # Конвертуємо в PIL Image
        highlight_layer = Image.fromarray(highlight_array, mode="RGBA")

        # Розмиваємо підсвітку для плавності
        highlight_layer = highlight_layer.filter(ImageFilter.GaussianBlur(radius=5))

        # Накладаємо підсвітку на оригінал
        result = Image.alpha_composite(image, highlight_layer)

        # Зберігаємо результат
        result.save(output_path, "PNG", quality=95)

        logger.info(f"Highlighted muscles saved to: {output_path}")
        return output_path

    def _create_body_mask(self, pixels: np.ndarray) -> np.ndarray:
        """
        Створює маску для області тіла (бежевий колір).

        Args:
            pixels: numpy array зображення (H, W, 4) RGBA

        Returns:
            булева маска (H, W)
        """
        r = pixels[:, :, 0]
        g = pixels[:, :, 1]
        b = pixels[:, :, 2]

        min_r, min_g, min_b = self.body_color_range["min"]
        max_r, max_g, max_b = self.body_color_range["max"]

        # Маска для бежевих відтінків
        mask = (
            (r >= min_r) & (r <= max_r) &
            (g >= min_g) & (g <= max_g) &
            (b >= min_b) & (b <= max_b)
        )

        # Додатково перевіряємо що це не чисто білий колір
        not_white = ~((r > 250) & (g > 250) & (b > 250))
        mask = mask & not_white

        return mask


class MuscleMapper:
    """
    Сервіс для аналізу поз та визначення активних м'язів.
    """

    @staticmethod
    def get_muscle_display_name(muscle_id: str) -> str:
        """Отримати українську назву м'яза"""
        return MUSCLE_NAMES_UA.get(muscle_id, muscle_id)

    @staticmethod
    def get_muscle_info(muscle_id: str) -> Dict:
        """Отримати інформацію про м'яз"""
        return {
            "id": muscle_id,
            "name": muscle_id,
            "name_ua": MUSCLE_NAMES_UA.get(muscle_id, muscle_id),
        }

    @staticmethod
    def get_all_muscles() -> List[Dict]:
        """Отримати список всіх м'язів"""
        return [
            {"id": muscle_id, "name": muscle_id, "name_ua": name_ua}
            for muscle_id, name_ua in MUSCLE_NAMES_UA.items()
        ]


def process_muscle_image(
    photo_path: str,
    outline_path: str,
    output_path: str,
) -> Tuple[str, List[str]]:
    """
    Повний pipeline обробки м'язів:
    1. Детектує позу на фото
    2. Визначає активні м'язи
    3. Підсвічує м'язи на контурному зображенні

    Args:
        photo_path: шлях до згенерованого фото
        outline_path: шлях до зображення з контурами м'язів
        output_path: шлях для результату

    Returns:
        (шлях до результату, список активних м'язів)
    """
    from services.pose_detector import PoseDetector

    # Детектуємо позу
    detector = PoseDetector.get_instance()
    pose_analysis = detector.detect(photo_path)

    if pose_analysis is None:
        logger.warning("No pose detected, using default muscle highlighting")
        active_muscles = ["core_abs", "erector_spinae", "quadriceps"]
    else:
        active_muscles = pose_analysis.active_muscles
        logger.info(f"Detected pose type: {pose_analysis.pose_type}")
        logger.info(f"Active muscles: {active_muscles}")

    # Підсвічуємо м'язи
    highlighter = MuscleHighlighter()
    result_path = highlighter.highlight_muscles(
        outline_path,
        active_muscles,
        output_path,
    )

    return result_path, active_muscles
