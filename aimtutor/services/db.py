"""Postgres connection helper for Prisma-managed tables."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
from psycopg2.extras import RealDictCursor

from aimtutor.services.session.db_config import get_postgres_database_url


@contextmanager
def connect() -> Iterator[Any]:
    database_url = get_postgres_database_url()
    if not database_url:
        raise RuntimeError("Postgres DATABASE_URL is required")
    conn = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_prisma():
    """Compatibility alias — quota services use ``connect()`` directly."""
    return connect
