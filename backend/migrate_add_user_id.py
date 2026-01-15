"""
Migration script to add user_id column to existing tables.
Run this once on the production database.
"""

import asyncio
import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate():
    """Add user_id column to poses and categories tables."""
    import os

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        logger.error("DATABASE_URL not set")
        return

    # Convert to async driver
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(database_url, echo=True)

    async with engine.begin() as conn:
        # Check if users table exists, if not create it
        await conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                token VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(200),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP WITH TIME ZONE
            )
        """)
        )
        logger.info("Users table ensured")

        # Create index on token if not exists
        await conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_users_token ON users(token)
        """)
        )

        # Add user_id column to poses if not exists
        try:
            await conn.execute(
                text("""
                ALTER TABLE poses ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
            """)
            )
            logger.info("Added user_id to poses table")
        except Exception as e:
            logger.warning(f"Could not add user_id to poses: {e}")

        # Create index on poses.user_id
        try:
            await conn.execute(
                text("""
                CREATE INDEX IF NOT EXISTS ix_poses_user_id ON poses(user_id)
            """)
            )
        except Exception as e:
            logger.warning(f"Could not create index on poses.user_id: {e}")

        # Add user_id column to categories if not exists
        try:
            await conn.execute(
                text("""
                ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
            """)
            )
            logger.info("Added user_id to categories table")
        except Exception as e:
            logger.warning(f"Could not add user_id to categories: {e}")

        # Create index on categories.user_id
        try:
            await conn.execute(
                text("""
                CREATE INDEX IF NOT EXISTS ix_categories_user_id ON categories(user_id)
            """)
            )
        except Exception as e:
            logger.warning(f"Could not create index on categories.user_id: {e}")

        logger.info("Migration completed successfully!")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
