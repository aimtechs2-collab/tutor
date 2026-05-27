"""Postgres-backed unified chat session store."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
import time
from typing import Any
import uuid

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from psycopg2.pool import SimpleConnectionPool

from .db_config import get_postgres_database_url
from .sqlite_store import _PARENT_AUTO, _Unset, TurnRecord


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


class PostgresSessionStore:
    """Persist unified chat sessions, messages, turns, and events in Postgres."""

    _TERMINAL_TURN_STATUSES = {"completed", "failed", "cancelled"}
    _TERMINAL_EVENT_TYPES = {"done", "error"}
    _TURN_EVENT_FLUSH_BATCH_SIZE = 1000

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or get_postgres_database_url()
        if not self.database_url:
            raise RuntimeError("Postgres session store requested without a database URL")
        self._lock = asyncio.Lock()
        self._turn_seq_cache: dict[str, int] = {}
        self._turn_session_cache: dict[str, str] = {}
        self._turn_event_buffers: dict[str, list[dict[str, Any]]] = {}
        self._pool = SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            dsn=self.database_url,
            cursor_factory=RealDictCursor,
        )
        self._initialize()

    async def _run(self, fn, *args):
        async with self._lock:
            return await asyncio.to_thread(fn, *args)

    @contextmanager
    def _connect(self):
        conn = self._pool.getconn()
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def _initialize(self) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New conversation',
                    created_at DOUBLE PRECISION NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL,
                    compressed_summary TEXT DEFAULT '',
                    summary_up_to_msg_id INTEGER DEFAULT 0,
                    preferences_json TEXT DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id BIGSERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    capability TEXT DEFAULT '',
                    events_json TEXT DEFAULT '',
                    attachments_json TEXT DEFAULT '',
                    metadata_json TEXT DEFAULT '{}',
                    created_at DOUBLE PRECISION NOT NULL,
                    parent_message_id BIGINT
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session_created
                    ON messages(session_id, created_at, id);
                CREATE INDEX IF NOT EXISTS idx_messages_parent
                    ON messages(session_id, parent_message_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
                    ON sessions(updated_at DESC);

                CREATE TABLE IF NOT EXISTS turns (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    capability TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'running',
                    error TEXT DEFAULT '',
                    created_at DOUBLE PRECISION NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL,
                    finished_at DOUBLE PRECISION
                );

                CREATE INDEX IF NOT EXISTS idx_turns_session_updated
                    ON turns(session_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_turns_session_status
                    ON turns(session_id, status, updated_at DESC);

                CREATE TABLE IF NOT EXISTS turn_events (
                    id BIGSERIAL PRIMARY KEY,
                    turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
                    seq INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    source TEXT DEFAULT '',
                    stage TEXT DEFAULT '',
                    content TEXT DEFAULT '',
                    metadata_json TEXT DEFAULT '',
                    timestamp DOUBLE PRECISION NOT NULL,
                    created_at DOUBLE PRECISION NOT NULL,
                    UNIQUE(turn_id, seq)
                );

                CREATE INDEX IF NOT EXISTS idx_turn_events_turn_seq
                    ON turn_events(turn_id, seq);

                CREATE TABLE IF NOT EXISTS notebook_entries (
                    id BIGSERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    turn_id TEXT NOT NULL DEFAULT '',
                    question_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    question_type TEXT DEFAULT '',
                    options_json TEXT DEFAULT '{}',
                    correct_answer TEXT DEFAULT '',
                    explanation TEXT DEFAULT '',
                    difficulty TEXT DEFAULT '',
                    user_answer TEXT DEFAULT '',
                    user_answer_images_json TEXT DEFAULT '[]',
                    is_correct INTEGER DEFAULT 0,
                    bookmarked INTEGER DEFAULT 0,
                    followup_session_id TEXT DEFAULT '',
                    ai_judgment TEXT DEFAULT '',
                    created_at DOUBLE PRECISION NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL,
                    UNIQUE(session_id, turn_id, question_id)
                );

                CREATE INDEX IF NOT EXISTS idx_notebook_entries_session
                    ON notebook_entries(session_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_notebook_entries_bookmarked
                    ON notebook_entries(bookmarked, created_at DESC);

                CREATE TABLE IF NOT EXISTS notebook_categories (
                    id BIGSERIAL PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    created_at DOUBLE PRECISION NOT NULL
                );

                CREATE TABLE IF NOT EXISTS notebook_entry_categories (
                    entry_id BIGINT NOT NULL REFERENCES notebook_entries(id) ON DELETE CASCADE,
                    category_id BIGINT NOT NULL REFERENCES notebook_categories(id) ON DELETE CASCADE,
                    PRIMARY KEY (entry_id, category_id)
                );
                """
            )
            conn.commit()

    def _create_session_sync(
        self,
        title: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        now = time.time()
        resolved_id = session_id or f"unified_{int(now * 1000)}_{uuid.uuid4().hex[:8]}"
        resolved_title = (title or "New conversation").strip() or "New conversation"
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (
                    id, title, created_at, updated_at,
                    compressed_summary, summary_up_to_msg_id, preferences_json
                )
                VALUES (%s, %s, %s, %s, '', 0, '{}')
                ON CONFLICT (id) DO NOTHING
                """,
                (resolved_id, resolved_title[:100], now, now),
            )
            conn.commit()
        return {
            "id": resolved_id,
            "session_id": resolved_id,
            "title": resolved_title[:100],
            "created_at": now,
            "updated_at": now,
            "compressed_summary": "",
            "summary_up_to_msg_id": 0,
            "preferences": {},
        }

    async def create_session(
        self,
        title: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._run(self._create_session_sync, title, session_id)

    def _get_session_sync(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.title,
                    s.created_at,
                    s.updated_at,
                    s.compressed_summary,
                    s.summary_up_to_msg_id,
                    s.preferences_json,
                    COALESCE(
                        (
                            SELECT t.status
                            FROM turns t
                            WHERE t.session_id = s.id
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        'idle'
                    ) AS status,
                    COALESCE(
                        (
                            SELECT t.id
                            FROM turns t
                            WHERE t.session_id = s.id AND t.status = 'running'
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS active_turn_id,
                    COALESCE(
                        (
                            SELECT t.capability
                            FROM turns t
                            WHERE t.session_id = s.id
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS capability
                FROM sessions s
                WHERE s.id = %s
                """,
                (session_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        payload = _row_to_dict(row)
        payload["session_id"] = payload["id"]
        payload["preferences"] = _json_loads(payload.pop("preferences_json", ""), {})
        return payload

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_session_sync, session_id)

    async def ensure_session(self, session_id: str | None = None) -> dict[str, Any]:
        if session_id:
            session = await self.get_session(session_id)
            if session is not None:
                return session
        return await self.create_session()

    @staticmethod
    def _serialize_turn(row: Any) -> dict[str, Any]:
        payload = _row_to_dict(row)
        return TurnRecord(
            id=payload["id"],
            session_id=payload["session_id"],
            capability=payload.get("capability") or "",
            status=payload.get("status") or "running",
            error=payload.get("error") or "",
            created_at=payload["created_at"],
            updated_at=payload["updated_at"],
            finished_at=payload.get("finished_at"),
            last_seq=payload.get("last_seq") or 0,
        ).to_dict()

    def _create_turn_sync(self, session_id: str, capability: str = "") -> dict[str, Any]:
        now = time.time()
        turn_id = f"turn_{int(now * 1000)}_{uuid.uuid4().hex[:10]}"
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM sessions WHERE id = %s", (session_id,))
            if cur.fetchone() is None:
                raise ValueError(f"Session not found: {session_id}")
            cur.execute(
                """
                SELECT id
                FROM turns
                WHERE session_id = %s AND status = 'running'
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (session_id,),
            )
            active = cur.fetchone()
            if active is not None:
                raise RuntimeError(f"Session already has an active turn: {active['id']}")
            cur.execute(
                """
                INSERT INTO turns (id, session_id, capability, status, error, created_at, updated_at, finished_at)
                VALUES (%s, %s, %s, 'running', '', %s, %s, NULL)
                """,
                (turn_id, session_id, capability or "", now, now),
            )
            conn.commit()
        self._turn_seq_cache[turn_id] = 0
        self._turn_session_cache[turn_id] = session_id
        return {
            "id": turn_id,
            "turn_id": turn_id,
            "session_id": session_id,
            "capability": capability or "",
            "status": "running",
            "error": "",
            "created_at": now,
            "updated_at": now,
            "finished_at": None,
            "last_seq": 0,
        }

    async def create_turn(self, session_id: str, capability: str = "") -> dict[str, Any]:
        return await self._run(self._create_turn_sync, session_id, capability)

    def _get_turn_sync(self, turn_id: str) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    t.*,
                    COALESCE((SELECT MAX(seq) FROM turn_events te WHERE te.turn_id = t.id), 0) AS last_seq
                FROM turns t
                WHERE t.id = %s
                """,
                (turn_id,),
            )
            row = cur.fetchone()
        return self._serialize_turn(row) if row is not None else None

    async def get_turn(self, turn_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_turn_sync, turn_id)

    def _get_active_turn_sync(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    t.*,
                    COALESCE((SELECT MAX(seq) FROM turn_events te WHERE te.turn_id = t.id), 0) AS last_seq
                FROM turns t
                WHERE t.session_id = %s AND t.status = 'running'
                ORDER BY t.updated_at DESC
                LIMIT 1
                """,
                (session_id,),
            )
            row = cur.fetchone()
        return self._serialize_turn(row) if row is not None else None

    async def get_active_turn(self, session_id: str) -> dict[str, Any] | None:
        return await self._run(self._get_active_turn_sync, session_id)

    def _list_active_turns_sync(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    t.*,
                    COALESCE((SELECT MAX(seq) FROM turn_events te WHERE te.turn_id = t.id), 0) AS last_seq
                FROM turns t
                WHERE t.session_id = %s AND t.status = 'running'
                ORDER BY t.updated_at DESC
                """,
                (session_id,),
            )
            rows = cur.fetchall()
        return [self._serialize_turn(row) for row in rows]

    async def list_active_turns(self, session_id: str) -> list[dict[str, Any]]:
        return await self._run(self._list_active_turns_sync, session_id)

    def _update_turn_status_sync(self, turn_id: str, status: str, error: str = "") -> bool:
        if status in self._TERMINAL_TURN_STATUSES:
            self._flush_turn_events_sync(turn_id)
        now = time.time()
        finished_at = now if status in self._TERMINAL_TURN_STATUSES else None
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE turns
                SET status = %s, error = %s, updated_at = %s, finished_at = %s
                WHERE id = %s
                """,
                (status, error or "", now, finished_at, turn_id),
            )
            updated = cur.rowcount > 0
            conn.commit()
        if status in self._TERMINAL_TURN_STATUSES:
            self._turn_seq_cache.pop(turn_id, None)
            self._turn_session_cache.pop(turn_id, None)
            self._turn_event_buffers.pop(turn_id, None)
        return updated

    async def update_turn_status(self, turn_id: str, status: str, error: str = "") -> bool:
        return await self._run(self._update_turn_status_sync, turn_id, status, error)

    def _resolve_turn_for_event(self, cur, turn_id: str) -> tuple[str, int]:
        cached_session_id = self._turn_session_cache.get(turn_id)
        cached_last_seq = self._turn_seq_cache.get(turn_id)
        if cached_session_id is not None and cached_last_seq is not None:
            return cached_session_id, cached_last_seq

        cur.execute(
            """
            SELECT
                t.session_id,
                COALESCE((SELECT MAX(seq) FROM turn_events te WHERE te.turn_id = t.id), 0) AS last_seq
            FROM turns t
            WHERE t.id = %s
            """,
            (turn_id,),
        )
        turn = cur.fetchone()
        if turn is None:
            raise ValueError(f"Turn not found: {turn_id}")
        session_id = turn["session_id"]
        last_seq = int(turn["last_seq"] or 0)
        self._turn_session_cache[turn_id] = session_id
        self._turn_seq_cache[turn_id] = last_seq
        return session_id, last_seq

    def _append_turn_event_sync(self, turn_id: str, event: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        cached_session_id = self._turn_session_cache.get(turn_id)
        cached_last_seq = self._turn_seq_cache.get(turn_id)
        if cached_session_id is None or cached_last_seq is None:
            with self._connect() as conn, conn.cursor() as cur:
                cached_session_id, cached_last_seq = self._resolve_turn_for_event(cur, turn_id)

        payload = dict(event)
        payload["turn_id"] = payload.get("turn_id") or turn_id
        payload["session_id"] = payload.get("session_id") or cached_session_id

        provided_seq = int(payload.get("seq") or 0)
        if provided_seq > 0:
            seq = provided_seq
            self._turn_seq_cache[turn_id] = max(int(self._turn_seq_cache.get(turn_id, 0)), seq)
        else:
            seq = int(cached_last_seq) + 1
            self._turn_seq_cache[turn_id] = seq
        payload["seq"] = seq
        payload["timestamp"] = float(payload.get("timestamp") or now)

        buffer = self._turn_event_buffers.setdefault(turn_id, [])
        buffer.append(payload)
        if (
            len(buffer) >= self._TURN_EVENT_FLUSH_BATCH_SIZE
            or str(payload.get("type") or "") in self._TERMINAL_EVENT_TYPES
        ):
            self._flush_turn_events_sync(turn_id)
        return payload

    def _flush_turn_events_sync(self, turn_id: str) -> None:
        buffer = self._turn_event_buffers.get(turn_id)
        if not buffer:
            return

        events = list(buffer)
        now = time.time()
        rows = [
            (
                turn_id,
                int(payload["seq"]),
                payload.get("type", ""),
                payload.get("source", ""),
                payload.get("stage", ""),
                payload.get("content", "") or "",
                _json_dumps(payload.get("metadata", {})),
                float(payload.get("timestamp") or now),
                now,
            )
            for payload in events
        ]
        with self._connect() as conn, conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO turn_events (
                    turn_id, seq, type, source, stage, content, metadata_json, timestamp, created_at
                ) VALUES %s
                ON CONFLICT (turn_id, seq) DO UPDATE SET
                    type = EXCLUDED.type,
                    source = EXCLUDED.source,
                    stage = EXCLUDED.stage,
                    content = EXCLUDED.content,
                    metadata_json = EXCLUDED.metadata_json,
                    timestamp = EXCLUDED.timestamp,
                    created_at = EXCLUDED.created_at
                """,
                rows,
            )
            cur.execute("UPDATE turns SET updated_at = %s WHERE id = %s", (now, turn_id))
            conn.commit()

        del buffer[: len(events)]
        if not buffer:
            self._turn_event_buffers.pop(turn_id, None)

    async def append_turn_event(self, turn_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await self._run(self._append_turn_event_sync, turn_id, event)

    def _append_turn_events_sync(
        self,
        turn_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return [self._append_turn_event_sync(turn_id, event) for event in events]

    async def append_turn_events(
        self,
        turn_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return await self._run(self._append_turn_events_sync, turn_id, events)

    def _get_turn_events_sync(self, turn_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT turn_id, seq, type, source, stage, content, metadata_json, timestamp
                FROM turn_events
                WHERE turn_id = %s AND seq > %s
                ORDER BY seq ASC
                """,
                (turn_id, max(0, int(after_seq))),
            )
            rows = cur.fetchall()
            cur.execute("SELECT session_id FROM turns WHERE id = %s", (turn_id,))
            turn = cur.fetchone()
        session_id = turn["session_id"] if turn else ""
        persisted = [
            {
                "type": row["type"],
                "source": row["source"] or "",
                "stage": row["stage"] or "",
                "content": row["content"] or "",
                "metadata": _json_loads(row["metadata_json"], {}),
                "session_id": session_id,
                "turn_id": row["turn_id"],
                "seq": row["seq"],
                "timestamp": row["timestamp"],
            }
            for row in rows
        ]
        buffered = [
            dict(event)
            for event in self._turn_event_buffers.get(turn_id, [])
            if int(event.get("seq") or 0) > max(0, int(after_seq))
        ]
        by_seq = {int(event.get("seq") or 0): event for event in persisted}
        for event in buffered:
            by_seq[int(event.get("seq") or 0)] = event
        return [by_seq[seq] for seq in sorted(seq for seq in by_seq if seq > 0)]

    async def get_turn_events(self, turn_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        return await self._run(self._get_turn_events_sync, turn_id, after_seq)

    def _update_session_title_sync(self, session_id: str, title: str) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sessions
                SET title = %s, updated_at = %s
                WHERE id = %s
                """,
                ((title.strip() or "New conversation")[:100], time.time(), session_id),
            )
            updated = cur.rowcount > 0
            conn.commit()
        return updated

    async def update_session_title(self, session_id: str, title: str) -> bool:
        return await self._run(self._update_session_title_sync, session_id, title)

    def _delete_session_sync(self, session_id: str) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    async def delete_session(self, session_id: str) -> bool:
        return await self._run(self._delete_session_sync, session_id)

    def _add_message_sync(
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
        now = time.time()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM sessions WHERE id = %s", (session_id,))
            if cur.fetchone() is None:
                raise ValueError(f"Session not found: {session_id}")
            if isinstance(parent_message_id, _Unset):
                cur.execute(
                    "SELECT id FROM messages WHERE session_id = %s ORDER BY id DESC LIMIT 1",
                    (session_id,),
                )
                last_row = cur.fetchone()
                resolved_parent_id = int(last_row["id"]) if last_row is not None else None
            else:
                resolved_parent_id = (
                    int(parent_message_id) if parent_message_id is not None else None
                )

            cur.execute(
                """
                INSERT INTO messages (
                    session_id, role, content, capability, events_json,
                    attachments_json, metadata_json, created_at, parent_message_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    session_id,
                    role,
                    content or "",
                    capability or "",
                    _json_dumps(events or []),
                    _json_dumps(attachments or []),
                    _json_dumps(metadata or {}),
                    now,
                    resolved_parent_id,
                ),
            )
            message_id = int(cur.fetchone()["id"])
            cur.execute("UPDATE sessions SET updated_at = %s WHERE id = %s", (now, session_id))
            conn.commit()
        return message_id

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
        return await self._run(
            self._add_message_sync,
            session_id,
            role,
            content,
            capability,
            events,
            attachments,
            metadata,
            parent_message_id,
        )

    def _delete_message_sync(self, message_id: int | str) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE id = %s", (int(message_id),))
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    async def delete_message(self, message_id: int | str) -> bool:
        return await self._run(self._delete_message_sync, message_id)

    def _delete_turn_by_message_sync(self, session_id: str, message_id: int) -> dict[str, Any]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, session_id, role, attachments_json, created_at
                FROM messages
                WHERE id = %s
                """,
                (int(message_id),),
            )
            msg = cur.fetchone()
            if msg is None or msg["session_id"] != session_id:
                return {
                    "deleted": False,
                    "attachment_ids": [],
                    "turn_id": None,
                    "was_running": False,
                }

            role = msg["role"]
            paired_msg = None
            if role == "user":
                cur.execute(
                    """
                    SELECT id, session_id, role, attachments_json, created_at
                    FROM messages
                    WHERE session_id = %s AND role = 'assistant' AND id > %s
                    ORDER BY id ASC
                    LIMIT 1
                    """,
                    (session_id, int(message_id)),
                )
                paired_msg = cur.fetchone()
            elif role == "assistant":
                cur.execute(
                    """
                    SELECT id, session_id, role, attachments_json, created_at
                    FROM messages
                    WHERE session_id = %s AND role = 'user' AND id < %s
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (session_id, int(message_id)),
                )
                paired_msg = cur.fetchone()

            user_msg = msg if role == "user" else paired_msg
            turn_id = None
            was_running = False
            if user_msg is not None:
                cur.execute(
                    """
                    SELECT id, status
                    FROM turns
                    WHERE session_id = %s AND created_at >= %s
                    ORDER BY created_at ASC
                    LIMIT 1
                    """,
                    (session_id, user_msg["created_at"]),
                )
                turn_row = cur.fetchone()
                if turn_row is not None:
                    turn_id = turn_row["id"]
                    was_running = turn_row["status"] == "running"

            if was_running:
                return {
                    "deleted": False,
                    "attachment_ids": [],
                    "turn_id": turn_id,
                    "was_running": True,
                }

            attachment_ids: list[str] = []
            for item in (msg, paired_msg):
                if item is None:
                    continue
                for att in _json_loads(item["attachments_json"], []):
                    aid = att.get("id") or att.get("attachment_id")
                    if aid:
                        attachment_ids.append(aid)

            if turn_id is not None:
                cur.execute("DELETE FROM turn_events WHERE turn_id = %s", (turn_id,))
                cur.execute("DELETE FROM turns WHERE id = %s", (turn_id,))

            ids_to_delete = [int(message_id)]
            if paired_msg is not None:
                ids_to_delete.append(int(paired_msg["id"]))
            cur.execute("DELETE FROM messages WHERE id = ANY(%s)", (ids_to_delete,))

            cur.execute(
                "SELECT summary_up_to_msg_id FROM sessions WHERE id = %s",
                (session_id,),
            )
            session_row = cur.fetchone()
            if session_row is not None:
                summary_up_to = int(session_row["summary_up_to_msg_id"] or 0)
                if any(mid <= summary_up_to for mid in ids_to_delete):
                    cur.execute(
                        "UPDATE sessions SET summary_up_to_msg_id = 0 WHERE id = %s",
                        (session_id,),
                    )

            cur.execute("UPDATE sessions SET updated_at = %s WHERE id = %s", (time.time(), session_id))
            conn.commit()

        return {
            "deleted": True,
            "attachment_ids": attachment_ids,
            "turn_id": turn_id,
            "was_running": was_running,
        }

    async def delete_turn_by_message(self, session_id: str, message_id: int) -> dict[str, Any]:
        return await self._run(self._delete_turn_by_message_sync, session_id, message_id)

    def _serialize_message(self, row: Any) -> dict[str, Any]:
        payload = _row_to_dict(row)
        parent_id = payload.get("parent_message_id")
        return {
            "id": int(payload["id"]),
            "session_id": payload["session_id"],
            "role": payload["role"],
            "content": payload["content"],
            "capability": payload.get("capability") or "",
            "events": _json_loads(payload.get("events_json"), []),
            "attachments": _json_loads(payload.get("attachments_json"), []),
            "metadata": _json_loads(payload.get("metadata_json"), {}),
            "created_at": payload["created_at"],
            "parent_message_id": int(parent_id) if parent_id is not None else None,
        }

    def _get_last_message_sync(
        self, session_id: str, role: str | None = None
    ) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            if role is None:
                cur.execute(
                    """
                    SELECT id, session_id, role, content, capability, events_json,
                           attachments_json, metadata_json, created_at, parent_message_id
                    FROM messages
                    WHERE session_id = %s
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (session_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT id, session_id, role, content, capability, events_json,
                           attachments_json, metadata_json, created_at, parent_message_id
                    FROM messages
                    WHERE session_id = %s AND role = %s
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (session_id, role),
                )
            row = cur.fetchone()
        return self._serialize_message(row) if row is not None else None

    async def get_last_message(
        self, session_id: str, role: str | None = None
    ) -> dict[str, Any] | None:
        return await self._run(self._get_last_message_sync, session_id, role)

    def _get_messages_sync(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, session_id, role, content, capability, events_json,
                       attachments_json, metadata_json, created_at, parent_message_id
                FROM messages
                WHERE session_id = %s
                ORDER BY id ASC
                """,
                (session_id,),
            )
            rows = cur.fetchall()
        return [self._serialize_message(row) for row in rows]

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return await self._run(self._get_messages_sync, session_id)

    def _get_message_path_sync(self, session_id: str, leaf_message_id: int) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            chain: list[dict[str, Any]] = []
            current: int | None = int(leaf_message_id)
            safety = 10_000
            while current is not None and safety > 0:
                cur.execute(
                    """
                    SELECT id, session_id, role, content, capability, events_json,
                           attachments_json, metadata_json, created_at, parent_message_id
                    FROM messages
                    WHERE id = %s AND session_id = %s
                    """,
                    (current, session_id),
                )
                row = cur.fetchone()
                if row is None:
                    break
                chain.append(self._serialize_message(row))
                parent = row["parent_message_id"]
                current = int(parent) if parent is not None else None
                safety -= 1
        chain.reverse()
        return chain

    async def get_message_path(self, session_id: str, leaf_message_id: int) -> list[dict[str, Any]]:
        return await self._run(self._get_message_path_sync, session_id, int(leaf_message_id))

    def _get_messages_for_context_sync(
        self, session_id: str, leaf_message_id: int | None = None
    ) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            if leaf_message_id is None:
                cur.execute(
                    """
                    SELECT id, role, content
                    FROM messages
                    WHERE session_id = %s
                      AND role IN ('user', 'assistant', 'system')
                    ORDER BY id ASC
                    """,
                    (session_id,),
                )
                return [
                    {
                        "id": row["id"],
                        "role": row["role"],
                        "content": row["content"] or "",
                    }
                    for row in cur.fetchall()
                ]
            chain: list[dict[str, Any]] = []
            current: int | None = int(leaf_message_id)
            safety = 10_000
            while current is not None and safety > 0:
                cur.execute(
                    """
                    SELECT id, role, content, parent_message_id
                    FROM messages
                    WHERE id = %s AND session_id = %s
                      AND role IN ('user', 'assistant', 'system')
                    """,
                    (current, session_id),
                )
                row = cur.fetchone()
                if row is None:
                    break
                chain.append(
                    {
                        "id": row["id"],
                        "role": row["role"],
                        "content": row["content"] or "",
                    }
                )
                parent = row["parent_message_id"]
                current = int(parent) if parent is not None else None
                safety -= 1
        chain.reverse()
        return chain

    async def get_messages_for_context(
        self, session_id: str, leaf_message_id: int | None = None
    ) -> list[dict[str, Any]]:
        return await self._run(self._get_messages_for_context_sync, session_id, leaf_message_id)

    def _list_sessions_sync(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.title,
                    s.created_at,
                    s.updated_at,
                    s.compressed_summary,
                    s.summary_up_to_msg_id,
                    s.preferences_json,
                    COUNT(m.id) AS message_count,
                    COALESCE(
                        (
                            SELECT t.status
                            FROM turns t
                            WHERE t.session_id = s.id
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        'idle'
                    ) AS status,
                    COALESCE(
                        (
                            SELECT t.id
                            FROM turns t
                            WHERE t.session_id = s.id AND t.status = 'running'
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS active_turn_id,
                    COALESCE(
                        (
                            SELECT t.capability
                            FROM turns t
                            WHERE t.session_id = s.id
                            ORDER BY t.updated_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS capability,
                    COALESCE(
                        (
                            SELECT m2.content
                            FROM messages m2
                            WHERE m2.session_id = s.id
                              AND TRIM(COALESCE(m2.content, '')) != ''
                            ORDER BY m2.id DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS last_message
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            rows = cur.fetchall()
        sessions = []
        for row in rows:
            payload = _row_to_dict(row)
            payload["session_id"] = payload["id"]
            payload["preferences"] = _json_loads(payload.pop("preferences_json", ""), {})
            sessions.append(payload)
        return sessions

    async def list_sessions(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        return await self._run(self._list_sessions_sync, limit, offset)

    def _update_summary_sync(self, session_id: str, summary: str, up_to_msg_id: int) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sessions
                SET compressed_summary = %s, summary_up_to_msg_id = %s, updated_at = updated_at
                WHERE id = %s
                """,
                (summary, max(0, int(up_to_msg_id)), session_id),
            )
            updated = cur.rowcount > 0
            conn.commit()
        return updated

    async def update_summary(self, session_id: str, summary: str, up_to_msg_id: int) -> bool:
        return await self._run(self._update_summary_sync, session_id, summary, up_to_msg_id)

    def _update_session_preferences_sync(
        self, session_id: str, preferences: dict[str, Any]
    ) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT preferences_json FROM sessions WHERE id = %s",
                (session_id,),
            )
            current = cur.fetchone()
            if current is None:
                return False
            merged = {
                **_json_loads(current["preferences_json"], {}),
                **(preferences or {}),
            }
            cur.execute(
                """
                UPDATE sessions
                SET preferences_json = %s, updated_at = %s
                WHERE id = %s
                """,
                (_json_dumps(merged), time.time(), session_id),
            )
            updated = cur.rowcount > 0
            conn.commit()
        return updated

    async def update_session_preferences(
        self, session_id: str, preferences: dict[str, Any]
    ) -> bool:
        return await self._run(self._update_session_preferences_sync, session_id, preferences)

    async def get_session_with_messages(self, session_id: str) -> dict[str, Any] | None:
        session = await self.get_session(session_id)
        if session is None:
            return None
        session["messages"] = await self.get_messages(session_id)
        session["active_turns"] = await self.list_active_turns(session_id)
        return session

    def _upsert_notebook_entries_sync(self, session_id: str, items: list[dict[str, Any]]) -> int:
        if not items:
            return 0
        now = time.time()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM sessions WHERE id = %s", (session_id,))
            if cur.fetchone() is None:
                raise ValueError(f"Session not found: {session_id}")
            upserted = 0
            for item in items:
                question = (item.get("question") or "").strip()
                question_id = (item.get("question_id") or "").strip()
                if not question or not question_id:
                    continue
                turn_id = (item.get("turn_id") or "").strip()
                images_value = item.get("user_answer_images")
                images_json = (
                    _json_dumps(images_value)
                    if isinstance(images_value, list)
                    else None
                )
                cur.execute(
                    """
                    INSERT INTO notebook_entries (
                        session_id, turn_id, question_id, question,
                        question_type, options_json, correct_answer,
                        explanation, difficulty, user_answer,
                        user_answer_images_json, is_correct, bookmarked,
                        followup_session_id, ai_judgment, created_at, updated_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        COALESCE(%s, '[]'), %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (session_id, turn_id, question_id) DO UPDATE SET
                        question = EXCLUDED.question,
                        question_type = EXCLUDED.question_type,
                        options_json = EXCLUDED.options_json,
                        correct_answer = EXCLUDED.correct_answer,
                        explanation = EXCLUDED.explanation,
                        difficulty = EXCLUDED.difficulty,
                        user_answer = EXCLUDED.user_answer,
                        user_answer_images_json = COALESCE(%s, notebook_entries.user_answer_images_json),
                        is_correct = EXCLUDED.is_correct,
                        bookmarked = EXCLUDED.bookmarked,
                        followup_session_id = EXCLUDED.followup_session_id,
                        ai_judgment = EXCLUDED.ai_judgment,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        session_id,
                        turn_id,
                        question_id,
                        question,
                        item.get("question_type") or "",
                        _json_dumps(item.get("options") or {}),
                        item.get("correct_answer") or "",
                        item.get("explanation") or "",
                        item.get("difficulty") or "",
                        item.get("user_answer") or "",
                        images_json,
                        1 if item.get("is_correct") else 0,
                        1 if item.get("bookmarked") else 0,
                        item.get("followup_session_id") or "",
                        item.get("ai_judgment") or "",
                        now,
                        now,
                        images_json,
                    ),
                )
                upserted += 1
            conn.commit()
        return upserted

    async def upsert_notebook_entries(self, session_id: str, items: list[dict[str, Any]]) -> int:
        return await self._run(self._upsert_notebook_entries_sync, session_id, items)

    @staticmethod
    def _serialize_notebook_entry(row: Any) -> dict[str, Any]:
        payload = _row_to_dict(row)
        raw_images = _json_loads(payload.get("user_answer_images_json"), [])
        images = [r for r in raw_images if isinstance(r, dict)] if isinstance(raw_images, list) else []
        return {
            "id": int(payload["id"]),
            "session_id": payload["session_id"],
            "session_title": payload.get("session_title") or "",
            "turn_id": payload.get("turn_id") or "",
            "question_id": payload.get("question_id") or "",
            "question": payload["question"],
            "question_type": payload.get("question_type") or "",
            "options": _json_loads(payload.get("options_json"), {}),
            "correct_answer": payload.get("correct_answer") or "",
            "explanation": payload.get("explanation") or "",
            "difficulty": payload.get("difficulty") or "",
            "user_answer": payload.get("user_answer") or "",
            "user_answer_images": images,
            "is_correct": bool(payload.get("is_correct")),
            "bookmarked": bool(payload.get("bookmarked")),
            "followup_session_id": payload.get("followup_session_id") or "",
            "ai_judgment": payload.get("ai_judgment") or "",
            "created_at": float(payload["created_at"]),
            "updated_at": float(payload["updated_at"]),
        }

    def _list_notebook_entries_sync(
        self,
        category_id: int | None,
        bookmarked: bool | None,
        is_correct: bool | None,
        limit: int,
        offset: int,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        base = """
            SELECT
                n.id, n.session_id, COALESCE(s.title, '') AS session_title,
                n.turn_id, n.question_id, n.question, n.question_type, n.options_json,
                n.correct_answer, n.explanation, n.difficulty,
                n.user_answer, n.user_answer_images_json, n.is_correct, n.bookmarked,
                n.followup_session_id, n.ai_judgment, n.created_at, n.updated_at
            FROM notebook_entries n
            LEFT JOIN sessions s ON s.id = n.session_id
        """
        count_base = "SELECT COUNT(*) AS cnt FROM notebook_entries n"
        conditions: list[str] = []
        params: list[Any] = []
        if category_id is not None:
            join = " INNER JOIN notebook_entry_categories ec ON ec.entry_id = n.id"
            base += join
            count_base += join
            conditions.append("ec.category_id = %s")
            params.append(category_id)
        if bookmarked is not None:
            conditions.append("n.bookmarked = %s")
            params.append(1 if bookmarked else 0)
        if is_correct is not None:
            conditions.append("n.is_correct = %s")
            params.append(1 if is_correct else 0)
        if session_id is not None:
            conditions.append("n.session_id = %s")
            params.append(session_id)
        where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(count_base + where, tuple(params))
            total_row = cur.fetchone()
            total = int(total_row["cnt"]) if total_row else 0
            cur.execute(
                base + where + " ORDER BY n.created_at DESC LIMIT %s OFFSET %s",
                tuple(params) + (limit, offset),
            )
            rows = cur.fetchall()
        return {"items": [self._serialize_notebook_entry(r) for r in rows], "total": total}

    async def list_notebook_entries(
        self,
        category_id: int | None = None,
        bookmarked: bool | None = None,
        is_correct: bool | None = None,
        limit: int = 50,
        offset: int = 0,
        *,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._run(
            self._list_notebook_entries_sync,
            category_id,
            bookmarked,
            is_correct,
            limit,
            offset,
            session_id,
        )

    def _get_notebook_entry_sync(self, entry_id: int) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT n.*, COALESCE(s.title, '') AS session_title
                FROM notebook_entries n
                LEFT JOIN sessions s ON s.id = n.session_id
                WHERE n.id = %s
                """,
                (entry_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            entry = self._serialize_notebook_entry(row)
            cur.execute(
                """
                SELECT c.id, c.name
                FROM notebook_categories c
                INNER JOIN notebook_entry_categories ec ON ec.category_id = c.id
                WHERE ec.entry_id = %s
                ORDER BY c.name
                """,
                (entry_id,),
            )
            entry["categories"] = [{"id": c["id"], "name": c["name"]} for c in cur.fetchall()]
        return entry

    async def get_notebook_entry(self, entry_id: int) -> dict[str, Any] | None:
        return await self._run(self._get_notebook_entry_sync, entry_id)

    def _find_notebook_entry_sync(
        self,
        session_id: str,
        question_id: str,
        turn_id: str | None = None,
    ) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            if turn_id is not None:
                cur.execute(
                    """
                    SELECT n.*, COALESCE(s.title, '') AS session_title
                    FROM notebook_entries n
                    LEFT JOIN sessions s ON s.id = n.session_id
                    WHERE n.session_id = %s
                      AND n.turn_id = %s
                      AND n.question_id = %s
                    """,
                    (session_id, turn_id, question_id),
                )
            else:
                cur.execute(
                    """
                    SELECT n.*, COALESCE(s.title, '') AS session_title
                    FROM notebook_entries n
                    LEFT JOIN sessions s ON s.id = n.session_id
                    WHERE n.session_id = %s AND n.question_id = %s
                    ORDER BY n.updated_at DESC, n.id DESC
                    LIMIT 1
                    """,
                    (session_id, question_id),
                )
            row = cur.fetchone()
        return self._serialize_notebook_entry(row) if row is not None else None

    async def find_notebook_entry(
        self,
        session_id: str,
        question_id: str,
        turn_id: str | None = None,
    ) -> dict[str, Any] | None:
        return await self._run(self._find_notebook_entry_sync, session_id, question_id, turn_id)

    def _update_notebook_entry_sync(self, entry_id: int, updates: dict[str, Any]) -> bool:
        allowed = {
            "bookmarked",
            "followup_session_id",
            "user_answer",
            "is_correct",
            "ai_judgment",
        }
        fields = {k: v for k, v in updates.items() if k in allowed}
        if not fields:
            return False
        fields["updated_at"] = time.time()
        if "bookmarked" in fields:
            fields["bookmarked"] = 1 if fields["bookmarked"] else 0
        if "is_correct" in fields:
            fields["is_correct"] = 1 if fields["is_correct"] else 0
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        values = list(fields.values()) + [entry_id]
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE notebook_entries SET {set_clause} WHERE id = %s",  # nosec B608
                tuple(values),
            )
            updated = cur.rowcount > 0
            conn.commit()
        return updated

    async def update_notebook_entry(self, entry_id: int, updates: dict[str, Any]) -> bool:
        return await self._run(self._update_notebook_entry_sync, entry_id, updates)

    def _delete_notebook_entry_sync(self, entry_id: int) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM notebook_entries WHERE id = %s", (entry_id,))
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    async def delete_notebook_entry(self, entry_id: int) -> bool:
        return await self._run(self._delete_notebook_entry_sync, entry_id)

    def _create_category_sync(self, name: str) -> dict[str, Any]:
        now = time.time()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO notebook_categories (name, created_at) VALUES (%s, %s) RETURNING id",
                (name.strip(), now),
            )
            category_id = int(cur.fetchone()["id"])
            conn.commit()
        return {"id": category_id, "name": name.strip(), "created_at": now}

    async def create_category(self, name: str) -> dict[str, Any]:
        return await self._run(self._create_category_sync, name)

    def _list_categories_sync(self) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.name, c.created_at,
                       COUNT(ec.entry_id) AS entry_count
                FROM notebook_categories c
                LEFT JOIN notebook_entry_categories ec ON ec.category_id = c.id
                GROUP BY c.id
                ORDER BY c.name
                """
            )
            rows = cur.fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "created_at": float(r["created_at"]),
                "entry_count": int(r["entry_count"]),
            }
            for r in rows
        ]

    async def list_categories(self) -> list[dict[str, Any]]:
        return await self._run(self._list_categories_sync)

    def _rename_category_sync(self, category_id: int, name: str) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE notebook_categories SET name = %s WHERE id = %s",
                (name.strip(), category_id),
            )
            updated = cur.rowcount > 0
            conn.commit()
        return updated

    async def rename_category(self, category_id: int, name: str) -> bool:
        return await self._run(self._rename_category_sync, category_id, name)

    def _delete_category_sync(self, category_id: int) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM notebook_categories WHERE id = %s", (category_id,))
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    async def delete_category(self, category_id: int) -> bool:
        return await self._run(self._delete_category_sync, category_id)

    def _add_entry_to_category_sync(self, entry_id: int, category_id: int) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notebook_entry_categories (entry_id, category_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                (entry_id, category_id),
            )
            conn.commit()
        return True

    async def add_entry_to_category(self, entry_id: int, category_id: int) -> bool:
        return await self._run(self._add_entry_to_category_sync, entry_id, category_id)

    def _remove_entry_from_category_sync(self, entry_id: int, category_id: int) -> bool:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM notebook_entry_categories WHERE entry_id = %s AND category_id = %s",
                (entry_id, category_id),
            )
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    async def remove_entry_from_category(self, entry_id: int, category_id: int) -> bool:
        return await self._run(self._remove_entry_from_category_sync, entry_id, category_id)

    def _get_entry_categories_sync(self, entry_id: int) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.name FROM notebook_categories c
                INNER JOIN notebook_entry_categories ec ON ec.category_id = c.id
                WHERE ec.entry_id = %s
                ORDER BY c.name
                """,
                (entry_id,),
            )
            rows = cur.fetchall()
        return [{"id": r["id"], "name": r["name"]} for r in rows]

    async def get_entry_categories(self, entry_id: int) -> list[dict[str, Any]]:
        return await self._run(self._get_entry_categories_sync, entry_id)


_instances: dict[str, PostgresSessionStore] = {}


def get_postgres_session_store() -> PostgresSessionStore:
    database_url = get_postgres_database_url()
    if database_url not in _instances:
        _instances[database_url] = PostgresSessionStore(database_url=database_url)
    return _instances[database_url]
