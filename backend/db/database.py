"""
Database configuration and session management.

SQLite vs PostgreSQL Compatibility Notes:
-----------------------------------------
This module supports both SQLite (development) and PostgreSQL (production).
All SQL features used are compatible with both databases:

1. func.now() - Works on both (SQLite: datetime('now'), PostgreSQL: NOW())
2. CheckConstraint - Supported by both, though SQLite enforcement varies by version
3. ForeignKey with ondelete - Works on both (SQLite requires PRAGMA foreign_keys=ON)
4. ENUM types - Use SQLAlchemy's Enum() which creates VARCHAR on SQLite
5. Index creation - Syntax is compatible with both databases

Limitations:
- SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS (PostgreSQL only)
- SQLite has limited concurrent write support (single writer at a time)
- SQLite JSON functions differ from PostgreSQL (use SQLAlchemy's JSON type)
- SQLite does not support connection pooling (connections are cheap anyway)

For production, always use PostgreSQL with proper connection pooling.
"""

import hashlib
import logging

from config import get_settings
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

settings = get_settings()

# Convert URL for async drivers
database_url = settings.DATABASE_URL
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Database-specific configuration
is_sqlite = database_url.startswith("sqlite")

engine_kwargs: dict = {
    "echo": False,
}

if not is_sqlite:
    # PostgreSQL connection pool settings
    # These are tuned for a typical web application workload:
    #
    # pool_pre_ping: Verify connections are alive before using them.
    #                Prevents errors from stale connections after DB restarts.
    #
    # pool_size: Number of persistent connections to maintain.
    #            5 is suitable for small-medium apps. Increase for high traffic.
    #            Rule of thumb: (2 * num_cores) + effective_spindle_count
    #
    # max_overflow: Additional connections allowed beyond pool_size during spikes.
    #               Total max connections = pool_size + max_overflow = 15
    #               Ensure this doesn't exceed PostgreSQL's max_connections setting.
    #
    # For high-traffic production:
    #   - Consider pool_size=10-20, max_overflow=20-30
    #   - Use pgbouncer for connection pooling at scale
    #   - Monitor connection usage with pg_stat_activity
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

engine = create_async_engine(database_url, **engine_kwargs)

# Enable foreign key constraints for SQLite
# SQLite does not enforce foreign keys by default - must be enabled per connection
if is_sqlite:
    from sqlalchemy import event as sa_event

    @sa_event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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
    """
    Dependency для отримання сесії БД.

    Note: This dependency no longer auto-commits after yield. Routes are expected
    to call db.commit() explicitly when they want to persist changes. This allows
    routes to have proper transaction control (e.g., for rollbacks on validation
    errors after partial changes). The rollback on exception is kept as a safety net.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            # Routes should call db.commit() explicitly when needed.
            # Auto-commit removed to give routes proper transaction control.
        except Exception:
            await session.rollback()
            raise


async def _migrate_sqlite_users_table(conn):
    """
    Migrate SQLite users table from old schema (token) to new schema (token_hash).

    SQLite doesn't support ALTER TABLE ADD COLUMN with constraints properly,
    so we need to recreate the table with the new schema.
    """
    from sqlalchemy import text
    import hashlib

    # Check if migration is needed (old schema has 'token', new has 'token_hash')
    result = await conn.execute(text("PRAGMA table_info(users)"))
    columns = {row[1]: row for row in result.fetchall()}

    if 'token_hash' in columns:
        # Already migrated
        return False

    if 'token' not in columns:
        # Table doesn't exist or has unexpected schema
        return False

    logging.info("Migrating users table: token -> token_hash")

    # Get existing users
    result = await conn.execute(text("SELECT id, token, name, created_at, last_login FROM users"))
    existing_users = result.fetchall()

    # Drop old table and indexes
    await conn.execute(text("DROP INDEX IF EXISTS ix_users_token"))
    await conn.execute(text("DROP INDEX IF EXISTS ix_users_id"))
    await conn.execute(text("DROP TABLE users"))

    # Create new table with correct schema
    await conn.execute(text("""
        CREATE TABLE users (
            id INTEGER NOT NULL PRIMARY KEY,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            name VARCHAR(200),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        )
    """))
    await conn.execute(text("CREATE INDEX ix_users_id ON users (id)"))
    await conn.execute(text("CREATE INDEX ix_users_token_hash ON users (token_hash)"))

    # Migrate existing users (hash their tokens)
    for user_row in existing_users:
        user_id, token, name, created_at, last_login = user_row
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        await conn.execute(
            text("INSERT INTO users (id, token_hash, name, created_at, updated_at, last_login) VALUES (:id, :token_hash, :name, :created_at, :updated_at, :last_login)"),
            {"id": user_id, "token_hash": token_hash, "name": name, "created_at": created_at, "updated_at": created_at, "last_login": last_login}
        )

    logging.info(f"Migrated {len(existing_users)} users to new schema")
    return True


async def init_db():
    """Ініціалізація бази даних"""
    from sqlalchemy import text

    # Імпортуємо моделі щоб вони зареєструвались
    from models import (
        auth_audit,
        category,
        generation_task,
        muscle,
        pose,
        refresh_token,
        sequence,
        token_blacklist,
        user,
    )

    async with engine.begin() as conn:
        # For PostgreSQL: use advisory lock to prevent race conditions
        # when multiple workers start simultaneously
        if not is_sqlite:
            # Acquire advisory lock (key 1 = migration lock)
            # pg_advisory_xact_lock is released automatically when transaction ends
            await conn.execute(text("SELECT pg_advisory_xact_lock(1)"))
            logging.info("Acquired database migration lock")

        # SQLite-specific migrations (must run before create_all)
        if is_sqlite:
            try:
                await _migrate_sqlite_users_table(conn)
            except Exception as e:
                logging.warning(f"SQLite migration warning: {e}")

            # Add missing columns to generation_tasks (SQLite supports ALTER TABLE ADD COLUMN)
            try:
                result = await conn.execute(text("PRAGMA table_info(generation_tasks)"))
                columns = {row[1] for row in result.fetchall()}

                if 'analyzed_muscles_json' not in columns and 'generation_tasks' in columns or columns:
                    # Check if table exists
                    tables_result = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_tasks'"))
                    if tables_result.fetchone():
                        if 'analyzed_muscles_json' not in columns:
                            await conn.execute(text("ALTER TABLE generation_tasks ADD COLUMN analyzed_muscles_json TEXT"))
                            logging.info("Added analyzed_muscles_json column to generation_tasks")
                        if 'additional_notes' not in columns:
                            await conn.execute(text("ALTER TABLE generation_tasks ADD COLUMN additional_notes TEXT"))
                            logging.info("Added additional_notes column to generation_tasks")
            except Exception as e:
                logging.warning(f"SQLite generation_tasks migration warning: {e}")

        # Використовуємо checkfirst=True щоб не падало на існуючих таблицях
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)

        # Migration: Add user_id columns if they don't exist (for PostgreSQL)
        if not is_sqlite:
            try:
                # Migrate users table: token -> token_hash (PostgreSQL)
                # Check if token_hash column exists
                result = await conn.execute(text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'token_hash'
                """))
                has_token_hash = result.fetchone() is not None

                # Also check if there are users with NULL token_hash that need migration
                needs_hash_migration = False
                if has_token_hash:
                    result = await conn.execute(text("""
                        SELECT EXISTS(SELECT 1 FROM users WHERE token_hash IS NULL LIMIT 1)
                    """))
                    needs_hash_migration = result.scalar()

                if not has_token_hash:
                    logging.info("Migrating users table: adding token_hash column")
                    # Add token_hash column (nullable initially)
                    await conn.execute(text("""
                        ALTER TABLE users ADD COLUMN token_hash VARCHAR(64)
                    """))

                    # Check if old 'token' column exists and migrate data
                    result = await conn.execute(text("""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'token'
                    """))
                    has_old_token = result.fetchone() is not None

                    if has_old_token:
                        # Fetch users with old tokens and hash them in Python
                        result = await conn.execute(text("""
                            SELECT id, token FROM users WHERE token IS NOT NULL AND token_hash IS NULL
                        """))
                        users_to_migrate = result.fetchall()

                        for user_id, token in users_to_migrate:
                            # Hash using Python's hashlib (same as model code)
                            token_hash = hashlib.sha256(token.encode()).hexdigest()
                            await conn.execute(
                                text("UPDATE users SET token_hash = :hash WHERE id = :id"),
                                {"hash": token_hash, "id": user_id}
                            )
                        logging.info(f"Migrated {len(users_to_migrate)} existing user tokens to SHA256 hashes")

                    # Create unique index (allows NULL values)
                    await conn.execute(text("""
                        CREATE UNIQUE INDEX IF NOT EXISTS ix_users_token_hash ON users(token_hash)
                    """))
                    logging.info("Users table migration completed")

                elif needs_hash_migration:
                    # Column exists but some users have NULL token_hash - need to migrate
                    logging.info("Migrating existing users with NULL token_hash")
                    result = await conn.execute(text("""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'token'
                    """))
                    has_old_token = result.fetchone() is not None

                    if has_old_token:
                        # Fetch users with old tokens and hash them in Python
                        result = await conn.execute(text("""
                            SELECT id, token FROM users WHERE token IS NOT NULL AND token_hash IS NULL
                        """))
                        users_to_migrate = result.fetchall()

                        for user_id, token in users_to_migrate:
                            # Hash using Python's hashlib (same as model code)
                            token_hash = hashlib.sha256(token.encode()).hexdigest()
                            await conn.execute(
                                text("UPDATE users SET token_hash = :hash WHERE id = :id"),
                                {"hash": token_hash, "id": user_id}
                            )
                        logging.info(f"Migrated {len(users_to_migrate)} users to SHA256 hashes")

                # Add updated_at column to users if missing
                result = await conn.execute(text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'updated_at'
                """))
                if result.fetchone() is None:
                    await conn.execute(text("""
                        ALTER TABLE users ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    """))
                    logging.info("Added updated_at column to users table")

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

                # Add analyzed_muscles_json to generation_tasks if not exists
                await conn.execute(
                    text("""
                    ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS analyzed_muscles_json TEXT
                """)
                )

                # Add additional_notes to generation_tasks if not exists
                await conn.execute(
                    text("""
                    ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS additional_notes TEXT
                """)
                )

                # Add version column to poses if not exists (for optimistic locking)
                await conn.execute(
                    text("""
                    ALTER TABLE poses ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1
                """)
                )

                logging.info("Migration: user_id columns ensured")
            except Exception as e:
                logging.warning(f"Migration warning (may be normal): {e}")

    logging.info("Database initialized successfully")
