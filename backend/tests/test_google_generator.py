"""
Tests for Google Gemini Generator Service.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from io import BytesIO
from PIL import Image, ImageDraw


class TestGoogleGeminiGeneratorInitialization:
    """Tests for GoogleGeminiGenerator initialization."""

    def test_is_available_with_api_key(self):
        """Test is_available returns True when API key is set."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-api-key"
            mock_settings.return_value = settings

            with patch.dict(
                "sys.modules", {"google": MagicMock(), "google.genai": MagicMock()}
            ):
                from services.google_generator import GoogleGeminiGenerator

                GoogleGeminiGenerator._instance = None
                GoogleGeminiGenerator._initialized = False
                import services.google_generator as google_generator_module
                google_generator_module.settings = settings

                assert GoogleGeminiGenerator.is_available() is True

    def test_is_available_without_api_key(self):
        """Test is_available returns False when no API key."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = ""
            mock_settings.return_value = settings

            with patch.dict(
                "sys.modules", {"google": MagicMock(), "google.genai": MagicMock()}
            ):
                from services.google_generator import GoogleGeminiGenerator

                GoogleGeminiGenerator._instance = None
                GoogleGeminiGenerator._initialized = False
                import services.google_generator as google_generator_module
                google_generator_module.settings = settings

                assert GoogleGeminiGenerator.is_available() is False

    def test_is_available_without_google_package(self):
        """Test is_available returns False when google package not installed."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            # Simulate ImportError for google package
            import sys

            original_modules = sys.modules.copy()

            # Remove google from modules to simulate not installed
            if "google" in sys.modules:
                del sys.modules["google"]
            if "google.genai" in sys.modules:
                del sys.modules["google.genai"]

            try:
                # This should handle ImportError gracefully
                from services.google_generator import GoogleGeminiGenerator

                GoogleGeminiGenerator._instance = None
                GoogleGeminiGenerator._initialized = False

                # Force reimport with missing module
                with patch.object(
                    GoogleGeminiGenerator, "is_available", return_value=False
                ):
                    result = GoogleGeminiGenerator.is_available()
                    assert result is False
            finally:
                sys.modules.update(original_modules)

    def test_singleton_pattern(self):
        """Test GoogleGeminiGenerator follows singleton pattern."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            instance1 = GoogleGeminiGenerator()
            instance2 = GoogleGeminiGenerator()

            assert instance1 is instance2


class TestGoogleGeminiGeneratorImageGeneration:
    """Tests for image generation functionality."""

    @pytest.fixture
    def mock_generator(self):
        """Create a mocked generator for testing."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._client = MagicMock()
            generator._initialized = True

            yield generator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    def test_image_to_bytes_png(self, mock_generator):
        """Test converting PIL Image to PNG bytes."""
        img = Image.new("RGB", (100, 100), color="red")
        result = mock_generator._image_to_bytes(img, format="PNG")

        assert isinstance(result, bytes)
        assert len(result) > 0

        # Verify it's valid PNG by loading it
        loaded = Image.open(BytesIO(result))
        assert loaded.format == "PNG"

    def test_image_to_bytes_jpeg(self, mock_generator):
        """Test converting PIL Image to JPEG bytes."""
        img = Image.new("RGB", (100, 100), color="blue")
        result = mock_generator._image_to_bytes(img, format="JPEG")

        assert isinstance(result, bytes)

        loaded = Image.open(BytesIO(result))
        assert loaded.format == "JPEG"


class TestGoogleGeminiGeneratorGenerateImage:
    """Tests for _generate_image method."""

    def test_build_generation_config_includes_square_image_config(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"], seed=123456
        )

        assert config.kwargs["response_modalities"] == ["TEXT", "IMAGE"]
        image_config = config.kwargs["image_config"]
        assert image_config.kwargs["aspect_ratio"] == "1:1"
        assert image_config.kwargs["image_size"] == "1K"
        assert config.kwargs["temperature"] == GoogleGeminiGenerator.IMAGE_TEMPERATURE
        assert config.kwargs["top_p"] == GoogleGeminiGenerator.IMAGE_TOP_P
        assert config.kwargs["top_k"] == GoogleGeminiGenerator.IMAGE_TOP_K
        assert config.kwargs["seed"] == 123456

    def test_build_generation_config_clamps_seed_to_int32(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"], seed=4_105_969_288
        )
        assert config.kwargs["seed"] == (4_105_969_288 & 0x7FFFFFFF)
        assert 0 <= config.kwargs["seed"] <= 2_147_483_647

    def test_build_generation_config_falls_back_to_aspect_only_when_image_size_rejected(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    if "image_size" in kwargs:
                        raise ValueError("image_size unsupported")
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"]
        )

        assert config.kwargs["response_modalities"] == ["TEXT", "IMAGE"]
        image_config = config.kwargs["image_config"]
        assert image_config.kwargs["aspect_ratio"] == "1:1"
        assert "image_size" not in image_config.kwargs

    def test_build_generation_config_drops_unsupported_sampling_keys_progressively(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    if "seed" in kwargs:
                        raise TypeError(
                            "__init__() got an unexpected keyword argument 'seed'"
                        )
                    if "top_k" in kwargs:
                        raise TypeError(
                            "__init__() got an unexpected keyword argument 'top_k'"
                        )
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"], seed=42
        )
        assert config.kwargs["response_modalities"] == ["TEXT", "IMAGE"]
        assert "seed" not in config.kwargs
        assert "top_k" not in config.kwargs
        assert config.kwargs["temperature"] == GoogleGeminiGenerator.IMAGE_TEMPERATURE
        assert config.kwargs["top_p"] == GoogleGeminiGenerator.IMAGE_TOP_P

    def test_build_generation_config_falls_back_to_base_when_sampling_fields_all_unsupported(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    for field in ("seed", "top_k", "top_p", "temperature"):
                        if field in kwargs:
                            raise TypeError(
                                f"__init__() got an unexpected keyword argument '{field}'"
                            )
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"], seed=777
        )

        assert config.kwargs["response_modalities"] == ["TEXT", "IMAGE"]
        assert "image_config" in config.kwargs
        assert "temperature" not in config.kwargs
        assert "top_p" not in config.kwargs
        assert "top_k" not in config.kwargs
        assert "seed" not in config.kwargs

    def test_build_generation_config_drops_guidance_scale_on_validation_error(self):
        from services.google_generator import GoogleGeminiGenerator

        class DummyTypes:
            class ImageConfig:
                def __init__(self, **kwargs):
                    self.kwargs = kwargs

            class GenerateContentConfig:
                def __init__(self, **kwargs):
                    if "guidance_scale" in kwargs:
                        raise ValueError(
                            "1 validation error for GenerateContentConfig\n"
                            "guidance_scale\n"
                            "  Extra inputs are not permitted [type=extra_forbidden]"
                        )
                    self.kwargs = kwargs

        config = GoogleGeminiGenerator._build_generation_config(
            DummyTypes, ["TEXT", "IMAGE"], seed=42
        )

        assert "guidance_scale" not in config.kwargs
        assert config.kwargs["temperature"] == GoogleGeminiGenerator.IMAGE_TEMPERATURE
        assert config.kwargs["top_p"] == GoogleGeminiGenerator.IMAGE_TOP_P
        assert config.kwargs["top_k"] == GoogleGeminiGenerator.IMAGE_TOP_K
        assert config.kwargs["seed"] == 42

    def test_seed_from_task_is_deterministic_and_stage_specific(self):
        from services.google_generator import GoogleGeminiGenerator

        s1 = GoogleGeminiGenerator._seed_from_task("task-abc", "photo", 0)
        s2 = GoogleGeminiGenerator._seed_from_task("task-abc", "photo", 0)
        s3 = GoogleGeminiGenerator._seed_from_task("task-abc", "photo", 1)
        s4 = GoogleGeminiGenerator._seed_from_task("task-abc", "muscles", 0)

        assert s1 == s2
        assert s1 != s3
        assert s1 != s4
        assert isinstance(s1, int)
        assert s1 >= 0
        assert s1 <= 2_147_483_647

    def test_prepare_reference_image_letterboxes_to_square_png(self):
        from services.google_generator import GoogleGeminiGenerator

        img = Image.new("RGB", (640, 360), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle((120, 80, 520, 320), outline="black", width=8)

        src = BytesIO()
        img.save(src, format="JPEG")

        prepared_bytes, prepared_mime, original_size, prepared_size = (
            GoogleGeminiGenerator._prepare_reference_image(
                src.getvalue(), "image/jpeg"
            )
        )

        assert prepared_mime == "image/png"
        assert original_size == (640, 360)
        assert prepared_size[0] == prepared_size[1]
        assert prepared_size[0] >= 360

        prepared_img = Image.open(BytesIO(prepared_bytes))
        assert prepared_img.format == "PNG"
        assert prepared_img.size == prepared_size

    def test_prepare_reference_image_autocrops_sparse_subject_before_square(self):
        from services.google_generator import GoogleGeminiGenerator

        img = Image.new("RGB", (1200, 600), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle((520, 220, 620, 420), fill="black")

        src = BytesIO()
        img.save(src, format="PNG")

        prepared_bytes, prepared_mime, original_size, prepared_size = (
            GoogleGeminiGenerator._prepare_reference_image(
                src.getvalue(), "image/png"
            )
        )

        assert prepared_mime == "image/png"
        assert original_size == (1200, 600)
        assert prepared_size[0] == prepared_size[1]

        prepared_img = Image.open(BytesIO(prepared_bytes)).convert("RGB")
        # Subject should occupy a meaningful area after autocrop+letterbox.
        pixels = prepared_img.load()
        w, h = prepared_img.size
        nonwhite = 0
        for y in range(h):
            for x in range(w):
                r, g, b = pixels[x, y]
                if r < 245 or g < 245 or b < 245:
                    nonwhite += 1
        ratio = nonwhite / float(w * h)
        assert ratio > 0.03

    @pytest.mark.asyncio
    async def test_generate_image_success(self):
        """Test successful image generation."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Create mock image data
            img = Image.new("RGB", (512, 512), "green")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            mock_image_data = buffer.getvalue()

            # Mock response with image
            mock_part = MagicMock()
            mock_part.inline_data = MagicMock()
            mock_part.inline_data.data = mock_image_data

            mock_response = MagicMock()
            mock_response.parts = [mock_part]

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            generator._client = mock_client

            with patch("google.genai.types") as mock_types:
                mock_types.GenerateContentConfig.return_value = MagicMock()

                result_img, is_placeholder = await generator._generate_image(
                    "test prompt"
                )

            assert isinstance(result_img, Image.Image)
            assert is_placeholder is False

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_image_returns_placeholder_on_failure(self):
        """Test that placeholder image is returned on API failure."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Mock client to raise exception
            mock_client = MagicMock()
            mock_client.models.generate_content.side_effect = Exception("API Error")
            generator._client = mock_client

            with patch("google.genai.types") as mock_types:
                mock_types.GenerateContentConfig.return_value = MagicMock()

                result_img, is_placeholder = await generator._generate_image(
                    "test prompt", max_retries=1
                )

            assert isinstance(result_img, Image.Image)
            assert is_placeholder is True
            assert result_img.size == (1024, 1024)

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_image_retries_without_seed_on_invalid_seed_error(self):
        """Gemini INVALID_ARGUMENT on generation_config.seed should auto-fallback to no-seed."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            img = Image.new("RGB", (128, 128), "green")
            img_buf = BytesIO()
            img.save(img_buf, format="PNG")
            image_bytes = img_buf.getvalue()

            mock_part = MagicMock()
            mock_part.inline_data = MagicMock()
            mock_part.inline_data.data = image_bytes
            mock_response = MagicMock()
            mock_response.parts = [mock_part]

            class FakeClientError(Exception):
                pass

            mock_client = MagicMock()
            mock_client.models.generate_content.side_effect = [
                FakeClientError(
                    "400 INVALID_ARGUMENT. Invalid value at 'generation_config.seed' (TYPE_INT32), 3076203216"
                ),
                mock_response,
            ]
            generator._client = mock_client

            seen_seeds: list[int | None] = []

            def build_config_side_effect(types_module, modalities, *, seed=None):
                seen_seeds.append(seed)
                return MagicMock()

            with (
                patch("google.genai.types"),
                patch("google.genai.errors.ClientError", FakeClientError),
                patch.object(
                    GoogleGeminiGenerator,
                    "_build_generation_config",
                    side_effect=build_config_side_effect,
                ),
            ):
                result_img, is_placeholder = await generator._generate_image(
                    "test prompt",
                    max_retries=2,
                    generation_seed=1_234_567_890,
                )

            assert isinstance(result_img, Image.Image)
            assert is_placeholder is False
            assert seen_seeds[0] == 1_234_567_890
            assert None in seen_seeds[1:]

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_image_with_reference(self):
        """Test image generation with reference image."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_image_with_pose_control_uses_two_reference_parts(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            img = Image.new("RGB", (512, 512), "blue")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            mock_image_data = buffer.getvalue()

            mock_part = MagicMock()
            mock_part.inline_data = MagicMock()
            mock_part.inline_data.data = mock_image_data
            mock_response = MagicMock()
            mock_response.parts = [mock_part]

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            generator._client = mock_client

            with patch("google.genai.types") as mock_types:
                ref_part = MagicMock(name="ref_part")
                pose_part = MagicMock(name="pose_part")
                mock_types.Part.from_bytes.side_effect = [ref_part, pose_part]
                mock_types.GenerateContentConfig.return_value = MagicMock()

                result_img, is_placeholder = await generator._generate_image(
                    "test prompt",
                    reference_image_bytes=mock_image_data,
                    reference_mime_type="image/png",
                    reference_already_prepared=True,
                    include_pose_control=True,
                )

            assert isinstance(result_img, Image.Image)
            assert is_placeholder is False

            called = mock_client.models.generate_content.call_args.kwargs
            assert isinstance(called.get("contents"), list)
            assert called["contents"][0] == ref_part
            assert called["contents"][1] == pose_part
            assert "Image #2 is a pose-control guide" in called["contents"][2]

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Create mock image data
            img = Image.new("RGB", (512, 512), "blue")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            mock_image_data = buffer.getvalue()

            # Mock response
            mock_part = MagicMock()
            mock_part.inline_data = MagicMock()
            mock_part.inline_data.data = mock_image_data

            mock_response = MagicMock()
            mock_response.parts = [mock_part]

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            generator._client = mock_client

            # Reference image bytes
            ref_img = Image.new("RGB", (100, 100), "red")
            ref_buffer = BytesIO()
            ref_img.save(ref_buffer, format="PNG")
            ref_bytes = ref_buffer.getvalue()

            with patch("google.genai.types") as mock_types:
                ref_part = MagicMock(name="ref_part")
                mock_types.Part.from_bytes.return_value = ref_part
                mock_types.GenerateContentConfig.return_value = MagicMock()

                result_img, is_placeholder = await generator._generate_image(
                    "test prompt",
                    reference_image_bytes=ref_bytes,
                    reference_mime_type="image/png",
                )

            assert isinstance(result_img, Image.Image)
            assert is_placeholder is False

            # Verify Part.from_bytes was called with reference
            mock_types.Part.from_bytes.assert_called()
            # Verify ordering: reference image first, then prompt text
            called = mock_client.models.generate_content.call_args.kwargs
            assert isinstance(called.get("contents"), list)
            assert called["contents"][0] == ref_part
            assert called["contents"][1] == "test prompt"
            config_kwargs = mock_types.GenerateContentConfig.call_args.kwargs
            assert config_kwargs["response_modalities"] == ["TEXT", "IMAGE"]
            assert "image_config" in config_kwargs

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    def test_normalize_reference_mime_type_jpg(self):
        """Test image/jpg is normalized to image/jpeg for Gemini API."""
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        assert GoogleGeminiGenerator._normalize_reference_mime_type("image/jpg") == "image/jpeg"
        assert GoogleGeminiGenerator._normalize_reference_mime_type("image/jpeg") == "image/jpeg"
        assert GoogleGeminiGenerator._normalize_reference_mime_type("image/png") == "image/png"
        assert GoogleGeminiGenerator._normalize_reference_mime_type("unknown/type") == "image/png"

    def test_extract_image_from_candidate_content_parts(self):
        """Test image extraction works when SDK puts parts under candidates[].content.parts."""
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        img = Image.new("RGB", (32, 32), "purple")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        image_bytes = buffer.getvalue()

        part = MagicMock()
        part.inline_data = MagicMock()
        part.inline_data.data = image_bytes

        content = MagicMock()
        content.parts = [part]
        candidate = MagicMock()
        candidate.content = content

        response = MagicMock()
        response.parts = None
        response.candidates = [candidate]

        extracted = GoogleGeminiGenerator._extract_image_from_response(response)
        assert isinstance(extracted, Image.Image)


class TestGoogleGeminiGeneratorGenerateAll:
    """Tests for generate_all methods."""

    @pytest.mark.asyncio
    async def test_generate_all_from_image_passes_prompt_before_reference(self):
        """Regression: ensure normalized reference bytes and pose-control flags are forwarded."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_keeps_explicit_pose_description(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])
            generator._is_good_muscle_metrics = MagicMock(return_value=True)
            generator._describe_pose_geometry = AsyncMock(return_value="AUTO-DESCRIPTION")

            mock_img = Image.new("RGB", (256, 256), "green")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))

            img = Image.new("RGB", (128, 128), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="task-pose-context",
                pose_description="Janu Sirsasana",
            )

            photo_prompt = generator._generate_image.call_args_list[0].args[0]
            assert "Janu Sirsasana" in photo_prompt
            assert "AUTO-DESCRIPTION" in photo_prompt
            generator._describe_pose_geometry.assert_awaited_once()

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            mock_img = Image.new("RGB", (512, 512), "green")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="test-task",
            )

            # First call is photo generation: uses prepared reference bytes.
            first_call = generator._generate_image.call_args_list[0].kwargs
            assert isinstance(first_call.get("reference_image_bytes"), bytes)
            assert len(first_call.get("reference_image_bytes")) > 0
            assert first_call.get("reference_mime_type") == "image/png"
            assert first_call.get("reference_already_prepared") is True
            assert first_call.get("include_pose_control") is False
            assert isinstance(first_call.get("generation_seed"), int)

            # Muscle generation is conditioned on the generated photo.
            second_call = generator._generate_image.call_args_list[1].kwargs
            assert isinstance(second_call.get("reference_image_bytes"), bytes)
            assert len(second_call.get("reference_image_bytes")) > 0
            assert second_call.get("reference_mime_type") == "image/png"
            assert second_call.get("reference_already_prepared") in (None, False)
            assert second_call.get("include_pose_control") is False
            assert isinstance(second_call.get("generation_seed"), int)
            assert first_call.get("generation_seed") != second_call.get("generation_seed")

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_auto_generates_pose_description_when_missing(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True
            generator._client = MagicMock()

            generator._describe_pose_geometry = AsyncMock(
                return_value="The subject is seated with one leg extended forward."
            )
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])
            generator._is_good_muscle_metrics = MagicMock(return_value=True)

            mock_img = Image.new("RGB", (256, 256), "green")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))

            img = Image.new("RGB", (128, 128), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="task-auto-pose-description",
            )

            generator._describe_pose_geometry.assert_awaited_once()
            photo_prompt = generator._generate_image.call_args_list[0].args[0]
            assert "The subject is seated with one leg extended forward." in photo_prompt

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_success(self):
        """Test successful generation of all images from schema."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import (
                GoogleGeminiGenerator,
                GenerationResult,
            )

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Mock methods
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            mock_img = Image.new("RGB", (512, 512), "green")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))

            # Test image bytes
            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            progress_calls = []

            def progress_callback(progress, message):
                progress_calls.append((progress, message))

            result = await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="test-task",
                progress_callback=progress_callback,
            )

            assert isinstance(result, GenerationResult)
            assert isinstance(result.photo_bytes, bytes)
            assert isinstance(result.muscles_bytes, bytes)
            assert result.used_placeholders is False

            # Verify progress callbacks
            assert len(progress_calls) >= 3
            assert progress_calls[-1][0] == 100

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_raises_when_photo_generation_falls_back_to_placeholder(self):
        """Generation must fail fast instead of silently returning placeholders."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import (
                GoogleGeminiGenerator,
                GenerationResult,
            )

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            # Return placeholder images
            mock_img = Image.new("RGB", (1024, 1024), (200, 200, 200))
            generator._generate_image = AsyncMock(return_value=(mock_img, True))

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            with pytest.raises(RuntimeError, match="studio photo"):
                await generator.generate_all_from_image(
                    image_bytes=image_bytes,
                    mime_type="image/png",
                    task_id="test-task",
                )

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_does_not_fail_on_pose_validation(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            mock_img = Image.new("RGB", (512, 512), "green")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])
            generator._is_good_muscle_metrics = MagicMock(return_value=True)

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            result = await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="test-task",
            )

            assert result.used_placeholders is False
            # 1 photo + 1 muscles generation when muscle quality passes immediately.
            assert generator._generate_image.call_count == 2
            generator._analyze_muscles_from_image.assert_awaited_once()

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_emits_pose_validation_progress(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator
            from services.pose_fidelity import PoseFidelityResult

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_uses_prepared_reference_without_fidelity_step(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            source_img = Image.new("RGB", (128, 96), "red")
            source_buffer = BytesIO()
            source_img.save(source_buffer, format="PNG")
            source_bytes = source_buffer.getvalue()

            prepared_bytes = b"prepared-reference-bytes"
            generator._prepare_reference_image = MagicMock(
                return_value=(prepared_bytes, "image/png", (128, 96), (128, 128))
            )

            generated_img = Image.new("RGB", (128, 128), "green")
            generator._generate_image = AsyncMock(return_value=(generated_img, False))
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])
            generator._is_good_muscle_metrics = MagicMock(return_value=True)

            await generator.generate_all_from_image(
                image_bytes=source_bytes,
                mime_type="image/png",
                task_id="task-source-prepared",
            )

            first_call = generator._generate_image.call_args_list[0].kwargs
            second_call = generator._generate_image.call_args_list[1].kwargs
            assert first_call["reference_image_bytes"] == prepared_bytes
            assert first_call["reference_mime_type"] == "image/png"
            assert first_call["reference_already_prepared"] is True
            assert second_call["reference_image_bytes"] != prepared_bytes
            assert second_call.get("reference_already_prepared") in (None, False)

            progress_calls = []

            def progress_callback(progress, message):
                progress_calls.append((progress, message))

            await generator.generate_all_from_image(
                image_bytes=source_bytes,
                mime_type="image/png",
                task_id="test-task",
                progress_callback=progress_callback,
            )

            assert all("Validating pose fidelity" not in message for _, message in progress_calls)

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_text_description(self):
        """Test generation from text description."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import (
                GoogleGeminiGenerator,
                GenerationResult,
            )

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            mock_img = Image.new("RGB", (512, 512), "blue")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))
            generator._is_good_muscle_metrics = MagicMock(return_value=True)
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            result = await generator.generate_all(
                pose_description="warrior pose",
                task_id="test-task",
            )

            assert isinstance(result, GenerationResult)
            assert result.used_placeholders is False

            # _generate_image should be called twice (photo + muscles)
            assert generator._generate_image.call_count == 2
            first_call = generator._generate_image.call_args_list[0].kwargs
            second_call = generator._generate_image.call_args_list[1].kwargs
            assert isinstance(first_call.get("generation_seed"), int)
            assert isinstance(second_call.get("generation_seed"), int)
            assert first_call.get("generation_seed") != second_call.get("generation_seed")

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_text_passes_additional_notes_to_prompts(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            mock_img = Image.new("RGB", (512, 512), "blue")
            generator._generate_image = AsyncMock(return_value=(mock_img, False))
            generator._is_good_muscle_metrics = MagicMock(return_value=True)
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            notes = "keep shoulders down and neck relaxed"
            await generator.generate_all(
                pose_description="warrior pose",
                task_id="test-task",
                additional_notes=notes,
            )

            photo_prompt = generator._generate_image.call_args_list[0].args[0]
            muscle_prompt = generator._generate_image.call_args_list[1].args[0]
            assert notes in photo_prompt
            assert notes in muscle_prompt
            assert "ADDITIONAL USER INSTRUCTIONS" in muscle_prompt

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorPrompts:
    """Tests for prompt building helpers."""

    def test_build_photo_prompt_uses_narrative_scene_description(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_photo_prompt("warrior pose", None)

        assert "performing this yoga pose" in prompt
        assert "studio" in prompt.lower()
        assert "warrior pose" in prompt
        assert "Match the body position exactly." in prompt
        assert "white seamless background" in prompt

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_build_muscle_prompt_deemphasizes_bones(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_muscle_prompt(None, 0)

        assert "NO skeleton" in prompt
        assert "NO internal organs" in prompt
        assert "single source of truth for pose geometry" in prompt
        assert "Negative prompt" not in prompt
        assert "LIGHT GRAY" not in prompt

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorMuscleQuality:
    """Tests for muscle image quality checks."""

    def test_is_good_muscle_image_rejects_all_white(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        img = Image.new("RGB", (256, 256), "white")
        assert GoogleGeminiGenerator._is_good_muscle_image(img) is False

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_is_good_muscle_image_accepts_red_blue_black_mix(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        img = Image.new("RGB", (200, 200), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle([20, 20, 90, 180], fill=(220, 0, 0))
        draw.rectangle([110, 20, 180, 180], fill=(0, 0, 220))
        draw.line([10, 10, 190, 10], fill=(0, 0, 0), width=3)

        assert GoogleGeminiGenerator._is_good_muscle_image(img) is True

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_is_good_muscle_image_accepts_muted_red_blue(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        img = Image.new("RGB", (200, 200), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle([20, 20, 110, 170], fill=(140, 80, 80))
        draw.rectangle([115, 20, 180, 170], fill=(80, 95, 145))
        draw.line([10, 185, 190, 185], fill=(30, 30, 30), width=3)

        assert GoogleGeminiGenerator._is_good_muscle_image(img) is True

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorPromptDetails:
    """Tests for prompt details."""

    def test_photo_prompt_integrates_pose_description_naturally(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_photo_prompt("warrior pose", None)

        assert "warrior pose" in prompt
        assert "performing this yoga pose" in prompt
        assert "Match the body position exactly." in prompt

        prompt_no_desc = generator._build_photo_prompt(None, None)
        assert "performing this yoga pose" not in prompt_no_desc
        assert "Studio photo of a woman performing a yoga pose." in prompt_no_desc

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_muscle_prompt_attempt_rules(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        base_prompt = generator._build_muscle_prompt(None, 0)
        prompt_attempt_1 = generator._build_muscle_prompt(None, 1)
        prompt_attempt_2 = generator._build_muscle_prompt(None, 2)

        assert "Frédéric Delavier" in base_prompt
        assert "ecorché" in base_prompt
        assert "superficial muscular system only" in base_prompt
        assert "dense, opaque muscle tissue" in base_prompt
        assert "Highlight STRETCHING muscles in RED" in base_prompt
        assert "Highlight CONTRACTING muscles in BLUE" in base_prompt
        assert "Negative prompt" not in base_prompt
        assert "ABSOLUTELY NO skeleton" in prompt_attempt_1
        assert "Strong contrast between RED (stretching) and BLUE (contracting)" in prompt_attempt_2

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_uses_single_shot_generation(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        generator._initialized = True

        photo_img = Image.new("RGB", (100, 100), color="blue")
        muscle_img = Image.new("RGB", (100, 100), color="white")
        generator._generate_image = AsyncMock(
            side_effect=[(photo_img, False), (muscle_img, False)]
        )
        generator._analyze_muscles_from_image = AsyncMock(return_value=[])

        schema_bytes = BytesIO()
        photo_img.save(schema_bytes, format="PNG")
        result = await generator.generate_all_from_image(
            image_bytes=schema_bytes.getvalue(),
            mime_type="image/png",
            task_id="task-1",
        )

        assert generator._generate_image.call_count == 2
        assert result.used_placeholders is False

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_from_image_single_shot_uses_first_muscle_result(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        generator._initialized = True

        photo_img = Image.new("RGB", (100, 100), color="blue")
        single_muscle_result = Image.new("RGB", (100, 100), color="white")

        generator._generate_image = AsyncMock(
            side_effect=[
                (photo_img, False),
                (single_muscle_result, False),
            ]
        )
        generator._analyze_muscles_from_image = AsyncMock(return_value=[])

        schema_bytes = BytesIO()
        photo_img.save(schema_bytes, format="PNG")

        result = await generator.generate_all_from_image(
            image_bytes=schema_bytes.getvalue(),
            mime_type="image/png",
            task_id="task-2",
        )

        assert generator._generate_image.call_count == 2
        assert result.used_placeholders is False
        assert result.muscles_bytes == generator._image_to_bytes(single_muscle_result)

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorMuscleParsing:
    """Tests for muscle parsing."""

    @pytest.mark.asyncio
    async def test_analyze_muscles_parses_json_fences(self):
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            mock_response = MagicMock()
            mock_response.text = "```json\n[{\"name\": \"quadriceps\", \"activation\": 80}]\n```"

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            generator._client = mock_client

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            with patch("google.genai.types") as mock_types:
                mock_types.Part.from_bytes.return_value = MagicMock()

                result = await generator._analyze_muscles_from_image(
                    image_bytes, "image/png", "pose"
                )

            assert len(result) == 1
            assert result[0].name == "quadriceps"
            assert result[0].activation_level == 80

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False


class TestGenerationResult:
    """Tests for GenerationResult dataclass."""

    def test_generation_result_creation(self):
        """Test GenerationResult can be created with required fields."""
        from services.google_generator import GenerationResult

        result = GenerationResult(
            photo_bytes=b"photo",
            muscles_bytes=b"muscles",
        )

        assert result.photo_bytes == b"photo"
        assert result.muscles_bytes == b"muscles"
        assert result.used_placeholders is False

    def test_generation_result_with_placeholders(self):
        """Test GenerationResult with placeholders flag."""
        from services.google_generator import GenerationResult

        result = GenerationResult(
            photo_bytes=b"photo",
            muscles_bytes=b"muscles",
            used_placeholders=True,
        )

        assert result.used_placeholders is True
