"""Canonical identity store for the optional multi-user layer.

User accounts are persisted in Postgres through the Prisma-managed
``auth_users`` table. The first account must be created through the registration
flow; local JSON/bootstrap users are not considered authoritative.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import logging
import secrets
import threading
from typing import Any, Iterator
from uuid import uuid4

import psycopg2
from psycopg2.extras import RealDictCursor

from aimtutor.runtime.home import get_runtime_home
from aimtutor.services.session.db_config import get_postgres_database_url

from .models import Role

logger = logging.getLogger(__name__)

_USERS_WRITE_LOCK = threading.Lock()
_SCHEMA_LOCK = threading.Lock()
_SCHEMA_READY = False

PROJECT_ROOT = get_runtime_home()
MULTI_USER_ROOT = PROJECT_ROOT / "multi-user"
SYSTEM_ROOT = MULTI_USER_ROOT / "_system"
AUTH_DIR = SYSTEM_ROOT / "auth"
SECRET_FILE = AUTH_DIR / "auth_secret"
LEGACY_SECRET_FILE = PROJECT_ROOT / "data" / "user" / "auth_secret"


def new_user_id() -> str:
    return f"u_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_url() -> str:
    return get_postgres_database_url()


@contextmanager
def _connect() -> Iterator[Any]:
    database_url = _database_url()
    if not database_url:
        raise RuntimeError("Postgres DATABASE_URL is required for user management")
    conn = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        with _connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    disabled BOOLEAN NOT NULL DEFAULT FALSE,
                    CONSTRAINT auth_users_role_check CHECK (role IN ('admin', 'user'))
                );

                CREATE INDEX IF NOT EXISTS auth_users_role_idx
                    ON auth_users(role);

                CREATE TABLE IF NOT EXISTS auth_secrets (
                    name TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            conn.commit()
        _SCHEMA_READY = True


def _row_created_at(row: dict[str, Any]) -> str:
    value = row.get("created_at")
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _row_to_record(row: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    username = str(row["username"])
    role = str(row.get("role") or "user")
    if role not in {"admin", "user"}:
        role = "user"
    return username, {
        "id": str(row.get("id") or ""),
        "hash": str(row.get("password_hash") or ""),
        "role": role,
        "created_at": _row_created_at(row),
        "disabled": bool(row.get("disabled", False)),
    }


def load_users(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> dict[str, dict[str, Any]]:
    """Load canonical users from Postgres only.

    ``env_username`` and ``env_password_hash`` are accepted for legacy call
    compatibility but intentionally ignored. The first persisted account must
    be created through registration.
    """
    _ensure_schema()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, username, password_hash, role, created_at, disabled
            FROM auth_users
            ORDER BY created_at ASC, username ASC
            """
        )
        rows = cur.fetchall()
    users: dict[str, dict[str, Any]] = {}
    for row in rows:
        username, record = _row_to_record(dict(row))
        users[username] = record
    return users


def save_user(username: str, hashed_password: str, role: Role = "user") -> dict[str, Any]:
    """Create or update a user in Postgres.

    The first persisted user is always promoted to admin, matching the
    bootstrap behavior expected by the register UI.
    """
    _ensure_schema()
    with _USERS_WRITE_LOCK:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('aimtutor-auth-users'))")
            cur.execute(
                """
                SELECT id, role, created_at, disabled
                FROM auth_users
                WHERE username = %s
                """,
                (username,),
            )
            existing = cur.fetchone()
            cur.execute("SELECT COUNT(*) AS count FROM auth_users")
            effective_role: Role = "admin" if int(cur.fetchone()["count"]) == 0 else role
            user_id = str(existing["id"]) if existing else new_user_id()
            created_at = existing["created_at"] if existing else datetime.now(timezone.utc)
            disabled = bool(existing["disabled"]) if existing else False
            cur.execute(
                """
                INSERT INTO auth_users (
                    id, username, password_hash, role, created_at, updated_at, disabled
                )
                VALUES (%s, %s, %s, %s, %s, now(), %s)
                ON CONFLICT (username) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = EXCLUDED.role,
                    updated_at = now(),
                    disabled = EXCLUDED.disabled
                RETURNING id, username, password_hash, role, created_at, disabled
                """,
                (user_id, username, hashed_password, effective_role, created_at, disabled),
            )
            row = dict(cur.fetchone())
            conn.commit()
    _, record = _row_to_record(row)
    return record


def list_user_info(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> list[dict[str, Any]]:
    return [
        {
            "id": record.get("id", ""),
            "username": username,
            "role": record.get("role", "user"),
            "created_at": record.get("created_at", ""),
            "disabled": bool(record.get("disabled", False)),
        }
        for username, record in load_users(env_username, env_password_hash).items()
    ]


def get_user(username: str) -> dict[str, Any] | None:
    return load_users().get(username)


def get_user_by_id(user_id: str) -> tuple[str, dict[str, Any]] | None:
    _ensure_schema()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, username, password_hash, role, created_at, disabled
            FROM auth_users
            WHERE id = %s
            """,
            (user_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return _row_to_record(dict(row))


def delete_user(username: str) -> bool:
    _ensure_schema()
    with _USERS_WRITE_LOCK:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM auth_users WHERE username = %s RETURNING id", (username,))
            removed = cur.fetchone() is not None
            conn.commit()
    return removed


def set_role(username: str, role: Role) -> bool:
    if role not in {"admin", "user"}:
        raise ValueError("role must be 'admin' or 'user'")
    _ensure_schema()
    with _USERS_WRITE_LOCK:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_users
                SET role = %s, updated_at = now()
                WHERE username = %s
                RETURNING id
                """,
                (role, username),
            )
            updated = cur.fetchone() is not None
            conn.commit()
    return updated


def _load_legacy_secret() -> str:
    for path in (SECRET_FILE, LEGACY_SECRET_FILE):
        try:
            if path.exists():
                value = path.read_text(encoding="utf-8").strip()
                if value:
                    return value
        except Exception as exc:
            logger.warning("Failed to read legacy auth secret from %s: %s", path, exc)
    return ""


def load_or_create_auth_secret() -> str:
    """Load the JWT signing secret from Postgres, creating it atomically."""
    if not _database_url():
        logger.warning("DATABASE_URL is not configured; using an ephemeral auth secret")
        return secrets.token_hex(32)

    _ensure_schema()
    with _USERS_WRITE_LOCK:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM auth_secrets WHERE name = 'jwt'")
            row = cur.fetchone()
            if row and str(row.get("value") or ""):
                return str(row["value"])

            generated = _load_legacy_secret() or secrets.token_hex(32)
            cur.execute(
                """
                INSERT INTO auth_secrets (name, value, created_at, updated_at)
                VALUES ('jwt', %s, now(), now())
                ON CONFLICT (name) DO UPDATE SET
                    value = auth_secrets.value,
                    updated_at = auth_secrets.updated_at
                RETURNING value
                """,
                (generated,),
            )
            value = str(cur.fetchone()["value"])
            conn.commit()
            logger.info("Initialized JWT auth secret in Postgres")
            return value
