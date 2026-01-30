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


class TestGoogleGeminiGeneratorPoseAnalysis:
    """Tests for pose analysis functionality."""

    @pytest.mark.asyncio
    async def test_analyze_pose_from_image_success(self):
        """Test successful pose analysis from image."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Mock the client response
            mock_response = MagicMock()
            mock_response.text = "warrior pose with right leg forward, arms raised"

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            generator._client = mock_client

            # Create test image bytes
            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            with patch("google.genai.types") as mock_types:
                mock_types.Part.from_bytes.return_value = MagicMock()

                result = await generator._analyze_pose_from_image(
                    image_bytes, "image/png"
                )

            assert "warrior" in result.lower()

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_analyze_pose_from_image_fallback_on_error(self):
        """Test fallback description when analysis fails."""
        with patch("services.google_generator.get_settings") as mock_settings:
            settings = MagicMock()
            settings.GOOGLE_API_KEY = "test-key"
            mock_settings.return_value = settings

            from services.google_generator import GoogleGeminiGenerator

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False

            generator = GoogleGeminiGenerator()
            generator._initialized = True

            # Mock the client to raise an exception
            mock_client = MagicMock()
            mock_client.models.generate_content.side_effect = Exception("API Error")
            generator._client = mock_client

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            with patch("google.genai.types") as mock_types:
                mock_types.Part.from_bytes.return_value = MagicMock()

                result = await generator._analyze_pose_from_image(
                    image_bytes, "image/png"
                )

            # Should return fallback description
            assert "yoga pose" in result.lower()

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorGenerateImage:
    """Tests for _generate_image method."""

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
    async def test_generate_image_with_reference(self):
        """Test image generation with reference image."""
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
                mock_types.Part.from_bytes.return_value = MagicMock()
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

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorGenerateAll:
    """Tests for generate_all methods."""

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
            generator._analyze_pose_from_image = AsyncMock(return_value="warrior pose")
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
    async def test_generate_all_from_image_with_placeholders(self):
        """Test generation returns placeholder flag when API quota exhausted."""
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

            generator._analyze_pose_from_image = AsyncMock(return_value="test pose")
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            # Return placeholder images
            mock_img = Image.new("RGB", (1024, 1024), (200, 200, 200))
            generator._generate_image = AsyncMock(return_value=(mock_img, True))

            img = Image.new("RGB", (100, 100), "red")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            result = await generator.generate_all_from_image(
                image_bytes=image_bytes,
                mime_type="image/png",
                task_id="test-task",
            )

            assert result.used_placeholders is True

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
            generator._is_good_muscle_image = MagicMock(return_value=True)
            generator._analyze_muscles_from_image = AsyncMock(return_value=[])

            result = await generator.generate_all(
                pose_description="warrior pose",
                task_id="test-task",
            )

            assert isinstance(result, GenerationResult)
            assert result.used_placeholders is False

            # _generate_image should be called twice (photo + muscles)
            assert generator._generate_image.call_count == 2

            GoogleGeminiGenerator._instance = None
            GoogleGeminiGenerator._initialized = False


class TestGoogleGeminiGeneratorPrompts:
    """Tests for prompt building helpers."""

    def test_build_photo_prompt_uses_white_outfit_and_white_background(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_photo_prompt("warrior pose", None)

        assert "White fitted t-shirt" in prompt
        assert "White head-wrap" in prompt
        assert "No logos" in prompt
        assert "Pure white seamless background" in prompt

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_build_muscle_prompt_deemphasizes_bones(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_muscle_prompt("warrior pose", None, 0)

        assert "NO skeleton" in prompt
        assert "NO internal organs" in prompt
        assert "Negative prompt" in prompt
        assert "skeleton, bones" in prompt
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


class TestGoogleGeminiGeneratorPromptDetails:
    """Tests for prompt details."""

    def test_photo_prompt_requires_white_clothing_and_background(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        prompt = generator._build_photo_prompt("warrior pose", None)

        assert "White fitted t-shirt" in prompt
        assert "White head-wrap" in prompt
        assert "No logos" in prompt
        assert "Pure white seamless background" in prompt

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    def test_muscle_prompt_attempt_rules(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        base_prompt = generator._build_muscle_prompt("warrior pose", None, 0)
        prompt_attempt_1 = generator._build_muscle_prompt("warrior pose", None, 1)
        prompt_attempt_2 = generator._build_muscle_prompt("warrior pose", None, 2)

        assert "Frédéric Delavier" in base_prompt
        assert "ecorché" in base_prompt
        assert "superficial muscular system only" in base_prompt
        assert "dense, opaque muscle tissue" in base_prompt
        assert "Highlight STRETCHING muscles in RED" in base_prompt
        assert "Highlight CONTRACTING muscles in BLUE" in base_prompt
        assert "Negative prompt" in base_prompt
        assert "ABSOLUTELY NO skeleton" in prompt_attempt_1
        assert "Strong contrast between RED (stretching) and BLUE (contracting)" in prompt_attempt_2

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

    @pytest.mark.asyncio
    async def test_generate_all_retries_until_muscle_quality(self):
        from services.google_generator import GoogleGeminiGenerator

        GoogleGeminiGenerator._instance = None
        GoogleGeminiGenerator._initialized = False

        generator = GoogleGeminiGenerator()
        generator._initialized = True

        bad_img = Image.new("RGB", (100, 100), color="white")
        good_img = Image.new("RGB", (100, 100), color="white")
        draw = ImageDraw.Draw(good_img)
        draw.rectangle([0, 0, 29, 29], fill=(255, 0, 0))
        draw.rectangle([30, 0, 49, 19], fill=(0, 0, 255))
        draw.rectangle([0, 90, 15, 95], fill=(0, 0, 0))

        photo_img = Image.new("RGB", (100, 100), color="blue")

        async def generate_image_side_effect(*args, **kwargs):
            call_index = generate_image_side_effect.call_index
            generate_image_side_effect.call_index += 1
            if call_index == 0:
                return photo_img, False
            if call_index < 3:
                return bad_img, False
            return good_img, False

        generate_image_side_effect.call_index = 0

        generator._generate_image = AsyncMock(side_effect=generate_image_side_effect)
        generator._analyze_pose_from_image = AsyncMock(return_value="pose")
        generator._analyze_muscles_from_image = AsyncMock(return_value=[])

        schema_bytes = BytesIO()
        photo_img.save(schema_bytes, format="PNG")
        result = await generator.generate_all_from_image(
            image_bytes=schema_bytes.getvalue(),
            mime_type="image/png",
            task_id="task-1",
        )

        assert generator._generate_image.call_count == 4
        assert result.used_placeholders is False

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
