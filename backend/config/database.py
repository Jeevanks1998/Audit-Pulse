"""
config/database.py

Async SQLAlchemy engine + session management. Models (in a future
`models/` package) should inherit from `Base`. Routes/services should
depend on `get_db` to obtain a request-scoped AsyncSession.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from config.logging import logger
from config.settings import settings


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


_engine_kwargs = {"echo": settings.DB_ECHO, "pool_pre_ping": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    # SQLite's async driver uses NullPool and doesn't accept pool sizing args.
    _engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    _engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yields a request-scoped DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """
    Create tables on startup for local/dev use.
    In staging/production, prefer Alembic migrations instead of this.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables verified/created")


async def close_db() -> None:
    """Dispose of the engine's connection pool on shutdown."""
    await engine.dispose()
    logger.info("Database connections closed")
