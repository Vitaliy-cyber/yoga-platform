import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union, Callable

import torch
from config import get_settings
from PIL import Image

settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    """Результат повної генерації всіх шарів"""
    photo_path: str
    muscles_path: str
    skeleton_path: str


class AIGenerator:
    """
    AI генератор зображень на основі SDXL + ControlNet.

    Оптимізовано для GPU з 8GB VRAM.
    Моделі завантажуються автоматично через HuggingFace при першому запуску.
    """

    _instance: Optional["AIGenerator"] = None
    _pipe = None
    _initialized = False

    # HuggingFace model IDs - SDXL (підходить для 8GB VRAM)
    SDXL_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"
    CONTROLNET_MODEL_ID = "diffusers/controlnet-canny-sdxl-1.0"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls) -> "AIGenerator":
        if cls._instance is None:
            cls._instance = cls()
        if not cls._initialized:
            cls._instance._load_models()
        return cls._instance

    @classmethod
    def is_available(cls) -> bool:
        """Перевіряє чи доступні необхідні бібліотеки"""
        try:
            import diffusers
            import bitsandbytes
            return True
        except ImportError as e:
            logger.debug(f"Missing dependency: {e}")
            return False

    def _load_models(self):
        """Завантаження SDXL + ControlNet моделей"""

        if self._initialized:
            return

        logger.info("Initializing AI Generator with SDXL + ControlNet...")

        if not self.is_available():
            raise RuntimeError(
                "Необхідні бібліотеки не встановлені! "
                "Виконайте: pip install diffusers accelerate"
            )

        logger.info("Loading SDXL with ControlNet (first run will download ~10GB)...")

        try:
            from diffusers import StableDiffusionXLControlNetPipeline, ControlNetModel, AutoencoderKL

            # Завантажуємо ControlNet для SDXL
            logger.info("Loading ControlNet Canny for SDXL...")
            controlnet = ControlNetModel.from_pretrained(
                self.CONTROLNET_MODEL_ID,
                torch_dtype=torch.float16,
                variant="fp16",
            )

            # Завантажуємо VAE (краща якість)
            logger.info("Loading VAE...")
            vae = AutoencoderKL.from_pretrained(
                "madebyollin/sdxl-vae-fp16-fix",
                torch_dtype=torch.float16,
            )

            # Завантажуємо повний SDXL pipeline
            logger.info("Loading SDXL pipeline...")
            self._pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
                self.SDXL_MODEL_ID,
                controlnet=controlnet,
                vae=vae,
                torch_dtype=torch.float16,
                variant="fp16",
                use_safetensors=True,
            )

            # Оптимізації для економії VRAM
            if torch.cuda.is_available():
                logger.info(f"CUDA available: {torch.cuda.get_device_name(0)}")
                vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
                logger.info(f"VRAM: {vram_gb:.1f} GB")

                # Для GPU з <=8GB VRAM використовуємо CPU offload
                if vram_gb <= 8:
                    logger.info("Using model CPU offload for 8GB GPU")
                    self._pipe.enable_model_cpu_offload()
                else:
                    self._pipe = self._pipe.to("cuda")

                # VAE оптимізації
                self._pipe.vae.enable_slicing()
                self._pipe.vae.enable_tiling()
            else:
                logger.warning("CUDA not available, running on CPU (will be very slow)")
                self._pipe = self._pipe.to("cpu")

            self._initialized = True
            logger.info("AI Generator initialized successfully!")

        except Exception as e:
            logger.error(f"Failed to load AI models: {e}")
            raise

    def _get_target_size(self, image: Union[str, Image.Image]) -> tuple:
        """
        Визначає цільовий розмір на основі орієнтації вхідного зображення.
        Flux працює найкраще з 1024x1024, але для 8GB GPU використовуємо менші розміри.
        """
        if isinstance(image, str):
            with Image.open(image) as img:
                orig_w, orig_h = img.size
        else:
            orig_w, orig_h = image.size

        # Перевіряємо VRAM
        if torch.cuda.is_available():
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
        else:
            vram_gb = 0

        # Для GPU з <12GB VRAM використовуємо менші розміри
        if vram_gb < 12:
            # Менший розмір для 8GB GPU
            if orig_w > orig_h:
                return (896, 640)  # Landscape
            else:
                return (640, 896)  # Portrait
        else:
            # Повний розмір для >12GB GPU
            if orig_w > orig_h:
                return (1024, 768)  # Landscape
            else:
                return (768, 1024)  # Portrait

    def _preprocess_image(
        self, image: Union[str, Image.Image], target_size: tuple = None
    ) -> Image.Image:
        """
        Препроцесинг вхідного зображення.
        Масштабує зображення щоб заповнити цільовий розмір зберігаючи пропорції.
        """
        if isinstance(image, str):
            image = Image.open(image)

        # Конвертуємо в RGB якщо потрібно
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Якщо target_size не вказано, визначаємо автоматично
        if target_size is None:
            target_size = self._get_target_size(image)

        # Розраховуємо масштаб
        target_w, target_h = target_size
        orig_w, orig_h = image.size

        scale = min(target_w / orig_w, target_h / orig_h)

        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)

        # Resize зображення
        image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # Створюємо нове зображення з бажаним розміром і центруємо
        new_image = Image.new("RGB", target_size, (255, 255, 255))
        offset = (
            (target_w - new_w) // 2,
            (target_h - new_h) // 2,
        )
        new_image.paste(image, offset)

        return new_image

    def _apply_canny(
        self, image: Image.Image, low_threshold: int = 50, high_threshold: int = 150
    ) -> Image.Image:
        """
        Застосовує Canny edge detection до зображення.
        """
        import cv2
        import numpy as np

        img_array = np.array(image)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, low_threshold, high_threshold)
        edges_rgb = cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)

        return Image.fromarray(edges_rgb)

    async def generate_photo(
        self,
        schema_path: str,
        output_path: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> str:
        """Генерація реалістичного фото з схеми через Flux + ControlNet"""

        logger.info(f"Generating photo for task {task_id}")

        if progress_callback:
            progress_callback(5, "Підготовка зображення...")

        # Визначаємо розмір
        target_size = self._get_target_size(schema_path)
        gen_width, gen_height = target_size
        logger.info(f"[{task_id}] Target size: {gen_width}x{gen_height}")

        # Препроцесинг
        schema = self._preprocess_image(schema_path, target_size)
        canny_image = self._apply_canny(schema)

        if progress_callback:
            progress_callback(10, "Генерація фото...")

        # Промпт для реалістичного фото
        prompt = """professional yoga studio photography,
young fit woman in yoga pose,
wearing black yoga outfit,
clean white seamless background,
soft diffused lighting,
full body shot,
sharp focus,
high quality photography,
natural skin texture"""

        # Генерація з SDXL + ControlNet
        result = self._pipe(
            prompt=prompt,
            negative_prompt="blurry, low quality, distorted, deformed, ugly, bad anatomy",
            image=canny_image,
            controlnet_conditioning_scale=0.7,
            num_inference_steps=25,
            height=gen_height,
            width=gen_width,
            guidance_scale=7.5,
        ).images[0]

        # Зберегти результат
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        result.save(output_path, "PNG", quality=95)

        logger.info(f"Photo generated successfully: {output_path}")
        return output_path

    async def generate_muscle_outline(
        self,
        photo_path: str,
        output_path: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> str:
        """
        Генерація контурного зображення м'язів (без підсвітки).
        Підсвітка буде додана пізніше через pose detection.
        """

        logger.info(f"Generating muscle outline for task {task_id}")

        if progress_callback:
            progress_callback(40, "Генерація контурів м'язів...")

        target_size = self._get_target_size(photo_path)
        gen_width, gen_height = target_size

        # Використовуємо фото як вхід
        photo = self._preprocess_image(photo_path, target_size)
        photo_canny = self._apply_canny(photo)

        # Промпт для анатомічної діаграми з контурами м'язів (БЕЗ підсвітки)
        prompt = """anatomical muscle diagram, educational anatomy illustration,
human body outline in beige cream color,
all muscles clearly outlined with thin black lines,
clean simple anatomical drawing style,
dark navy blue background,
medical textbook illustration,
all muscle groups visible with black outlines,
flat color style, no shading, no highlighting,
professional anatomy reference chart,
neutral pose diagram"""

        negative_prompt = """highlighted muscles, red muscles, colored muscles,
active muscles, glowing, shading, gradients,
photorealistic, photo, 3d render, blurry, low quality"""

        result = self._pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=photo_canny,
            controlnet_conditioning_scale=0.75,
            num_inference_steps=25,
            height=gen_height,
            width=gen_width,
            guidance_scale=7.5,
        ).images[0]

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        result.save(output_path, "PNG", quality=95)

        logger.info(f"Muscle outline generated: {output_path}")
        return output_path

    async def generate_skeleton(
        self,
        photo_path: str,
        output_path: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> str:
        """Генерація анатомічного шару зі скелетом"""

        logger.info(f"Generating skeleton layer for task {task_id}")

        if progress_callback:
            progress_callback(70, "Генерація скелету...")

        target_size = self._get_target_size(photo_path)
        gen_width, gen_height = target_size

        photo = self._preprocess_image(photo_path, target_size)
        photo_canny = self._apply_canny(photo)

        prompt = """X-ray medical visualization of human skeleton in yoga pose,
skeletal anatomy clearly visible,
bones glowing white on dark blue background,
medical imaging style,
educational anatomy diagram,
anatomically accurate bone structure,
spine and joints clearly visible,
professional radiograph aesthetic,
high contrast skeletal visualization"""

        negative_prompt = """blurry, low quality, cartoon,
unrealistic anatomy, text, watermark, deformed"""

        result = self._pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=photo_canny,
            controlnet_conditioning_scale=0.75,
            num_inference_steps=25,
            height=gen_height,
            width=gen_width,
            guidance_scale=7.5,
        ).images[0]

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        result.save(output_path, "PNG", quality=95)

        logger.info(f"Skeleton layer generated: {output_path}")
        return output_path

    async def generate_all(
        self,
        schema_path: str,
        output_dir: str,
        task_id: str,
        progress_callback: Optional[Callable] = None,
    ) -> GenerationResult:
        """
        Повна генерація всіх шарів:
        1. Схема → ControlNet → Реалістичне фото
        2. Фото → Контури м'язів (без підсвітки)
        3. Фото → Скелет

        Підсвітка м'язів буде додана окремо через pose detection.
        """
        os.makedirs(output_dir, exist_ok=True)

        photo_path = os.path.join(output_dir, f"{task_id}_photo.png")
        muscles_outline_path = os.path.join(output_dir, f"{task_id}_muscles_outline.png")
        skeleton_path = os.path.join(output_dir, f"{task_id}_skeleton.png")

        # === Крок 1: Генерація фото зі схеми ===
        await self.generate_photo(schema_path, photo_path, task_id, progress_callback)

        # === Крок 2: Генерація контурів м'язів ===
        await self.generate_muscle_outline(photo_path, muscles_outline_path, task_id, progress_callback)

        # === Крок 3: Генерація скелету ===
        await self.generate_skeleton(photo_path, skeleton_path, task_id, progress_callback)

        if progress_callback:
            progress_callback(100, "Завершено!")

        return GenerationResult(
            photo_path=photo_path,
            muscles_path=muscles_outline_path,
            skeleton_path=skeleton_path,
        )
