"""PostgreSQL pool lifecycle and request transaction helpers."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from app.config import get_settings

_pool: ConnectionPool[Connection[dict[str, Any]]] | None = None


def open_pool() -> None:
    global _pool
    if _pool is not None:
        return
    settings = get_settings().database
    pool = ConnectionPool(
        conninfo=settings.conninfo,
        min_size=1,
        max_size=settings.pool_size + settings.max_overflow,
        timeout=settings.command_timeout_seconds,
        kwargs={
            **settings.connect_kwargs,
            "row_factory": dict_row,
            "autocommit": False,
        },
        open=True,
    )
    try:
        pool.wait(timeout=settings.command_timeout_seconds)
    except PoolTimeout as error:
        pool.close()
        endpoint = f"{settings.host}:{settings.port}/{settings.database_name}"
        raise RuntimeError(
            "Database connection pool did not become ready within "
            f"{settings.command_timeout_seconds}s ({endpoint}, user={settings.user}). "
            "Verify PostgreSQL is running, the database exists, and the deployment "
            "database preflight passes."
        ) from error
    except Exception:
        pool.close()
        raise
    _pool = pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_pool() -> ConnectionPool[Connection[dict[str, Any]]]:
    if _pool is None:
        raise RuntimeError("Database pool is not open")
    return _pool


def get_connection() -> Generator[Connection[dict[str, Any]]]:
    pool = get_pool()
    with pool.connection() as connection:
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
