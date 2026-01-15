import logging

from config import get_settings
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

settings = get_settings()

# Конвертуємо URL для async драйверів
database_url = settings.DATABASE_URL
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Налаштування для різних БД
is_sqlite = database_url.startswith("sqlite")

engine_kwargs = {
    "echo": False,
}

if not is_sqlite:
    # PostgreSQL специфічні налаштування
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_size": 5,
            "max_overflow": 10,
        }
    )

engine = create_async_engine(database_url, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    """Dependency для отримання сесії БД"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Ініціалізація бази даних"""
    async with engine.begin() as conn:
        # Імпортуємо моделі щоб вони зареєструвались
        from models import category, muscle, pose

        await conn.run_sync(Base.metadata.create_all)

    logging.info("Database initialized successfully")
