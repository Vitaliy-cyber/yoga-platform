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

engine_kwargs: dict = {
    "echo": False,
}

if not is_sqlite:
    # PostgreSQL специфічні налаштування
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

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
    from sqlalchemy import text

    # Імпортуємо моделі щоб вони зареєструвались
    from models import category, generation_task, muscle, pose, user

    async with engine.begin() as conn:
        # Використовуємо checkfirst=True щоб не падало на існуючих таблицях
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)

        # Migration: Add user_id columns if they don't exist (for PostgreSQL)
        if not is_sqlite:
            try:
                # Add user_id to poses if not exists
                await conn.execute(
                    text("""
                    ALTER TABLE poses ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
                """)
                )
                await conn.execute(
                    text("""
                    CREATE INDEX IF NOT EXISTS ix_poses_user_id ON poses(user_id)
                """)
                )

                # Add user_id to categories if not exists
                await conn.execute(
                    text("""
                    ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
                """)
                )
                await conn.execute(
                    text("""
                    CREATE INDEX IF NOT EXISTS ix_categories_user_id ON categories(user_id)
                """)
                )

                logging.info("Migration: user_id columns ensured")
            except Exception as e:
                logging.warning(f"Migration warning (may be normal): {e}")

    logging.info("Database initialized successfully")
