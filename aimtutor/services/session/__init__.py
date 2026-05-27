"""
Session Management Module
=========================

Provides unified session management for all agent modules.

Usage:
    from aimtutor.services.session import BaseSessionManager

    class MySessionManager(BaseSessionManager):
        def __init__(self):
            super().__init__("my_module")

        def _get_session_id_prefix(self) -> str:
            return "my_"

        def _get_default_title(self) -> str:
            return "New My Session"

        # ... implement other abstract methods
"""

from .base_session_manager import BaseSessionManager
from .db_config import is_postgres_session_store_enabled
from .local_first_postgres_store import LocalFirstPostgresSessionStore
from .postgres_store import PostgresSessionStore, get_postgres_session_store
from .protocol import SessionStoreProtocol
from .sqlite_store import SQLiteSessionStore, get_sqlite_session_store as get_local_sqlite_session_store
from .turn_runtime import TurnRuntimeManager, get_turn_runtime_manager


_local_first_postgres_store: LocalFirstPostgresSessionStore | None = None


def get_local_first_postgres_session_store() -> LocalFirstPostgresSessionStore:
    global _local_first_postgres_store
    if _local_first_postgres_store is None:
        _local_first_postgres_store = LocalFirstPostgresSessionStore(
            local=get_local_sqlite_session_store(),
            remote=get_postgres_session_store(),
        )
    return _local_first_postgres_store


def get_sqlite_session_store() -> SessionStoreProtocol:
    """Backward-compatible store getter used by older routers/modules.

    The name is historical. When Postgres is configured, this returns the
    active Postgres store so direct imports do not accidentally split chat
    state across Postgres and SQLite.
    """
    if is_postgres_session_store_enabled():
        return get_local_first_postgres_session_store()
    return get_local_sqlite_session_store()


def get_session_store() -> SessionStoreProtocol:
    """
    Return the active session store backend.

    When a Postgres database URL is configured, returns a
    PostgresSessionStore. When integrations.pocketbase_url is configured,
    returns a PocketBaseSessionStore. Otherwise falls back to the local
    SQLiteSessionStore (default, zero-config behaviour).
    """
    if is_postgres_session_store_enabled():
        return get_local_first_postgres_session_store()

    from aimtutor.services.pocketbase_client import is_pocketbase_enabled

    if is_pocketbase_enabled():
        from .pocketbase_store import PocketBaseSessionStore

        return PocketBaseSessionStore()
    return get_sqlite_session_store()


__all__ = [
    "BaseSessionManager",
    "LocalFirstPostgresSessionStore",
    "PostgresSessionStore",
    "SessionStoreProtocol",
    "SQLiteSessionStore",
    "TurnRuntimeManager",
    "get_local_sqlite_session_store",
    "get_local_first_postgres_session_store",
    "get_postgres_session_store",
    "get_session_store",
    "get_sqlite_session_store",
    "get_turn_runtime_manager",
]
