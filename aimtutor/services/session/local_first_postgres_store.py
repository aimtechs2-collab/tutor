"""Local-first session store with asynchronous Postgres sync."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from .postgres_store import PostgresSessionStore
from .sqlite_store import _PARENT_AUTO, _Unset, SQLiteSessionStore


logger = logging.getLogger(__name__)


class LocalFirstPostgresSessionStore:
    """Use SQLite for hot chat state and mirror completed state to Postgres.

    Chat rendering and context reads stay local. Neon/Postgres receives an
    upserted session snapshot after terminal turn updates and other non-hot
    mutations, so remote latency does not sit in the response stream path.
    """

    _TERMINAL_TURN_STATUSES = {"completed", "failed", "cancelled"}

    def __init__(
        self,
        *,
        local: SQLiteSessionStore | None = None,
        remote: PostgresSessionStore | None = None,
    ) -> None:
        self.local = local or SQLiteSessionStore()
        self.remote = remote or PostgresSessionStore()
        self._sync_tasks: set[asyncio.Task[Any]] = set()

    def _schedule_session_sync(self, session_id: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self.sync_session_to_remote(session_id))
        self._sync_tasks.add(task)
        task.add_done_callback(self._sync_tasks.discard)

    async def sync_session_to_remote(self, session_id: str) -> bool:
        try:
            snapshot = await self.local.export_session_snapshot(session_id)
            if snapshot is None:
                with contextlib.suppress(Exception):
                    await self.remote.delete_session(session_id)
                return False
            import_snapshot = getattr(self.remote, "import_session_snapshot")
            return bool(await import_snapshot(snapshot))
        except Exception:
            logger.exception("Failed to sync local session %s to Postgres", session_id)
            return False

    async def create_session(
        self,
        title: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        session = await self.local.create_session(title=title, session_id=session_id)
        self._schedule_session_sync(session["id"])
        return session

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return await self.local.get_session(session_id)

    async def ensure_session(self, session_id: str | None = None) -> dict[str, Any]:
        if session_id:
            session = await self.local.get_session(session_id)
            if session is not None:
                return session
        return await self.create_session(session_id=session_id)

    async def create_turn(self, session_id: str, capability: str = "") -> dict[str, Any]:
        return await self.local.create_turn(session_id, capability=capability)

    async def get_turn(self, turn_id: str) -> dict[str, Any] | None:
        return await self.local.get_turn(turn_id)

    async def get_active_turn(self, session_id: str) -> dict[str, Any] | None:
        return await self.local.get_active_turn(session_id)

    async def list_active_turns(self, session_id: str) -> list[dict[str, Any]]:
        return await self.local.list_active_turns(session_id)

    async def update_turn_status(self, turn_id: str, status: str, error: str = "") -> bool:
        updated = await self.local.update_turn_status(turn_id, status, error)
        if updated and status in self._TERMINAL_TURN_STATUSES:
            turn = await self.local.get_turn(turn_id)
            if turn is not None:
                self._schedule_session_sync(turn["session_id"])
        return updated

    async def append_turn_event(self, turn_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await self.local.append_turn_event(turn_id, event)

    async def append_turn_events(
        self,
        turn_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        persisted = []
        for event in events:
            persisted.append(await self.local.append_turn_event(turn_id, event))
        return persisted

    async def get_turn_events(self, turn_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        return await self.local.get_turn_events(turn_id, after_seq=after_seq)

    async def update_session_title(self, session_id: str, title: str) -> bool:
        updated = await self.local.update_session_title(session_id, title)
        if updated:
            self._schedule_session_sync(session_id)
        return updated

    async def delete_session(self, session_id: str) -> bool:
        deleted = await self.local.delete_session(session_id)
        if deleted:
            with contextlib.suppress(Exception):
                await self.remote.delete_session(session_id)
        return deleted

    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        capability: str = "",
        events: list[dict[str, Any]] | None = None,
        attachments: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
        parent_message_id: int | None | _Unset = _PARENT_AUTO,
    ) -> int:
        return await self.local.add_message(
            session_id=session_id,
            role=role,
            content=content,
            capability=capability,
            events=events,
            attachments=attachments,
            metadata=metadata,
            parent_message_id=parent_message_id,
        )

    async def delete_message(self, message_id: int | str) -> bool:
        return await self.local.delete_message(message_id)

    async def get_last_message(
        self,
        session_id: str,
        role: str | None = None,
    ) -> dict[str, Any] | None:
        return await self.local.get_last_message(session_id, role=role)

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return await self.local.get_messages(session_id)

    async def get_messages_for_context(
        self,
        session_id: str,
        leaf_message_id: int | None = None,
    ) -> list[dict[str, Any]]:
        return await self.local.get_messages_for_context(session_id, leaf_message_id)

    async def list_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        return await self.local.list_sessions(limit=limit, offset=offset)

    async def update_summary(self, session_id: str, summary: str, up_to_msg_id: int) -> bool:
        updated = await self.local.update_summary(session_id, summary, up_to_msg_id)
        if updated:
            self._schedule_session_sync(session_id)
        return updated

    async def update_session_preferences(
        self,
        session_id: str,
        preferences: dict[str, Any],
    ) -> bool:
        updated = await self.local.update_session_preferences(session_id, preferences)
        if updated:
            self._schedule_session_sync(session_id)
        return updated

    async def get_session_with_messages(self, session_id: str) -> dict[str, Any] | None:
        return await self.local.get_session_with_messages(session_id)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.local, name)
