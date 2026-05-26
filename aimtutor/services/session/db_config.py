"""Database configuration helpers for session persistence."""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


POSTGRES_ENV_KEYS = (
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_DATABASE_URL",
    "AIMTUTOR_DATABASE_URL",
)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_project_env() -> None:
    load_dotenv(_project_root() / ".env", override=False)


def _read_bare_postgres_url() -> str:
    env_path = _project_root() / ".env"
    if not env_path.exists():
        return ""
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" in line:
                continue
            if line.startswith(("postgresql://", "postgres://")):
                return line
    except OSError:
        return ""
    return ""


@lru_cache(maxsize=1)
def get_postgres_database_url() -> str:
    """Return the configured Postgres URL without logging or exposing it."""
    _load_project_env()
    for key in POSTGRES_ENV_KEYS:
        value = os.getenv(key, "").strip()
        if value.startswith(("postgresql://", "postgres://")):
            return value
    return _read_bare_postgres_url()


def is_postgres_session_store_enabled() -> bool:
    return bool(get_postgres_database_url())

