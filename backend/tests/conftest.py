"""
Test fixtures and configuration for pytest.
"""

import asyncio
import os
import sys
from io import BytesIO
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import Base, get_db
from models.category import Category
from models.muscle import Muscle
from models.pose import Pose, PoseMuscle
from models.user import User

# Test database URL (SQLite for testing)
TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database session for each test."""
    # Import models to register them
    from models import category, muscle, pose, user

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestingSessionLocal() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ============== Mock Fixtures ==============


@pytest.fixture
def mock_settings():
    """Mock application settings."""
    with patch("config.get_settings") as mock:
        settings = MagicMock()
        settings.APP_MODE = "dev"
        settings.STORAGE_BACKEND = "s3"
        settings.S3_BUCKET = "test-bucket"
        settings.S3_REGION = "us-east-1"
        settings.S3_PREFIX = "test"
        settings.S3_ACCESS_KEY_ID = "test-key"
        settings.S3_SECRET_ACCESS_KEY = "test-secret"
        settings.GOOGLE_API_KEY = "test-api-key"
        settings.ENABLE_AI_GENERATION = True
        settings.USE_GOOGLE_AI = True
        settings.CORS_ORIGINS = ["http://localhost:3000"]
        settings.CORS_ALLOWED_ORIGINS = ""
        mock.return_value = settings
        yield settings


@pytest.fixture
def mock_s3_storage():
    """Mock S3Storage singleton for testing."""
    with patch("services.storage.S3Storage") as MockStorage:
        mock_instance = MagicMock()
        mock_instance.bucket = "test-bucket"
        mock_instance.prefix = "test"
        mock_instance.upload_bytes = AsyncMock(
            return_value="https://test-bucket.s3.amazonaws.com/test/file.png"
        )
        MockStorage.get_instance.return_value = mock_instance
        MockStorage.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_s3_storage_for_routes():
    """Mock S3Storage at route level."""
    with patch("api.routes.poses.S3Storage") as MockStorage:
        mock_instance = MagicMock()
        mock_instance.upload_bytes = AsyncMock(
            return_value="https://test-bucket.s3.amazonaws.com/test/file.png"
        )
        MockStorage.get_instance.return_value = mock_instance

        with patch("api.routes.generate.S3Storage") as MockStorageGen:
            MockStorageGen.get_instance.return_value = mock_instance
            yield mock_instance


@pytest.fixture
def mock_google_generator():
    """Mock GoogleGeminiGenerator for testing."""
    with patch("services.google_generator.GoogleGeminiGenerator") as MockGen:
        from services.google_generator import GenerationResult

        mock_instance = MagicMock()
        mock_instance.generate_all_from_image = AsyncMock(
            return_value=GenerationResult(
                photo_bytes=b"fake-photo-bytes",
                muscles_bytes=b"fake-muscles-bytes",
                used_placeholders=False,
            )
        )
        mock_instance.generate_all = AsyncMock(
            return_value=GenerationResult(
                photo_bytes=b"fake-photo-bytes",
                muscles_bytes=b"fake-muscles-bytes",
                used_placeholders=False,
            )
        )
        mock_instance._analyze_pose_from_image = AsyncMock(
            return_value="warrior pose with arms extended"
        )
        MockGen.get_instance.return_value = mock_instance
        MockGen.is_available.return_value = True
        yield mock_instance


# ============== Test Data Fixtures ==============


@pytest.fixture
def sample_image_bytes() -> bytes:
    """Generate sample PNG image bytes for testing."""
    img = Image.new("RGB", (100, 100), color="red")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def sample_jpeg_bytes() -> bytes:
    """Generate sample JPEG image bytes for testing."""
    img = Image.new("RGB", (100, 100), color="blue")
    buffer = BytesIO()
    img.save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def large_image_bytes() -> bytes:
    """Generate large image bytes for size limit testing."""
    img = Image.new("RGB", (4000, 4000), color="green")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest_asyncio.fixture
async def sample_category(db_session: AsyncSession) -> Category:
    """Create a sample category for tests."""
    category = Category(name="Standing Poses", description="Poses performed standing")
    db_session.add(category)
    await db_session.flush()
    await db_session.refresh(category)
    return category


@pytest_asyncio.fixture
async def sample_categories(db_session: AsyncSession) -> list[Category]:
    """Create multiple sample categories."""
    categories = [
        Category(name="Standing", description="Standing poses"),
        Category(name="Sitting", description="Sitting poses"),
        Category(name="Balancing", description="Balance poses"),
    ]
    for cat in categories:
        db_session.add(cat)
    await db_session.flush()
    for cat in categories:
        await db_session.refresh(cat)
    return categories


@pytest_asyncio.fixture
async def sample_muscle(db_session: AsyncSession) -> Muscle:
    """Create a sample muscle for tests."""
    muscle = Muscle(name="Quadriceps", name_ua="Квадрицепс", body_part="legs")
    db_session.add(muscle)
    await db_session.flush()
    await db_session.refresh(muscle)
    return muscle


@pytest_asyncio.fixture
async def sample_muscles(db_session: AsyncSession) -> list[Muscle]:
    """Create multiple sample muscles."""
    muscles = [
        Muscle(name="Quadriceps", name_ua="Квадрицепс", body_part="legs"),
        Muscle(name="Hamstrings", name_ua="Біцепс стегна", body_part="legs"),
        Muscle(name="Core", name_ua="Кор", body_part="core"),
        Muscle(name="Deltoids", name_ua="Дельти", body_part="shoulders"),
    ]
    for muscle in muscles:
        db_session.add(muscle)
    await db_session.flush()
    for muscle in muscles:
        await db_session.refresh(muscle)
    return muscles


@pytest_asyncio.fixture
async def sample_pose(db_session: AsyncSession, sample_category: Category) -> Pose:
    """Create a sample pose for tests."""
    pose = Pose(
        code="WAR01",
        name="Воїн I",
        name_en="Warrior I",
        category_id=sample_category.id,
        description="Базова поза воїна",
        effect="Зміцнює ноги",
        breathing="Глибоке дихання",
    )
    db_session.add(pose)
    await db_session.flush()
    await db_session.refresh(pose)
    return pose


@pytest_asyncio.fixture
async def sample_pose_with_muscles(
    db_session: AsyncSession,
    sample_category: Category,
    sample_muscles: list[Muscle],
) -> Pose:
    """Create a sample pose with muscle associations."""
    pose = Pose(
        code="WAR02",
        name="Воїн II",
        name_en="Warrior II",
        category_id=sample_category.id,
    )
    db_session.add(pose)
    await db_session.flush()

    # Add muscle associations
    for i, muscle in enumerate(sample_muscles[:2]):
        pm = PoseMuscle(
            pose_id=pose.id,
            muscle_id=muscle.id,
            activation_level=50 + i * 20,
        )
        db_session.add(pm)

    await db_session.flush()
    await db_session.refresh(pose)
    return pose


@pytest_asyncio.fixture
async def multiple_poses(
    db_session: AsyncSession, sample_category: Category
) -> list[Pose]:
    """Create multiple poses for pagination/search tests."""
    poses = [
        Pose(
            code="TRI01",
            name="Трикутник",
            name_en="Triangle",
            category_id=sample_category.id,
        ),
        Pose(
            code="TRE01", name="Дерево", name_en="Tree", category_id=sample_category.id
        ),
        Pose(
            code="DOG01",
            name="Собака мордою вниз",
            name_en="Downward Dog",
            category_id=sample_category.id,
        ),
        Pose(
            code="COB01", name="Кобра", name_en="Cobra", category_id=sample_category.id
        ),
        Pose(
            code="BRI01", name="Міст", name_en="Bridge", category_id=sample_category.id
        ),
    ]
    for pose in poses:
        db_session.add(pose)
    await db_session.flush()
    for pose in poses:
        await db_session.refresh(pose)
    return poses


# ============== Client Fixtures ==============


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create a test client with database override."""
    from main import app

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function")
async def client_with_mocked_storage(
    db_session: AsyncSession,
    mock_s3_storage_for_routes,
) -> AsyncGenerator[AsyncClient, None]:
    """Create a test client with mocked S3 storage."""
    from main import app

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
