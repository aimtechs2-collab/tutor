"""Persist admin flags on user conversations."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from aimtutor.services.db import connect


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "session_id": str(row["session_id"]),
        "user_id": str(row["user_id"]),
        "flag_type": str(row["flag_type"]),
        "reason": str(row.get("reason") or ""),
        "flagged_by": str(row["flagged_by"]),
        "resolved": bool(row.get("resolved", False)),
        "created_at": _iso_timestamp(row.get("created_at")),
    }


def _create_flag_sync(
    *,
    session_id: str,
    user_id: str,
    flag_type: str,
    reason: str,
    flagged_by: str,
) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flagged_conversations (
                id, session_id, user_id, flag_type, reason, flagged_by, resolved, created_at
            )
            VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, FALSE, now())
            RETURNING id, session_id, user_id, flag_type, reason, flagged_by, resolved, created_at
            """,
            (session_id, user_id, flag_type, reason, flagged_by),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _row_to_dict(row)


def _list_flags_for_session_sync(session_id: str) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, user_id, flag_type, reason, flagged_by, resolved, created_at
            FROM flagged_conversations
            WHERE session_id = %s
            ORDER BY created_at DESC
            """,
            (session_id,),
        )
        rows = cur.fetchall()
    return [_row_to_dict(dict(row)) for row in rows]


def _list_unresolved_flags_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, session_id, user_id, flag_type, reason, flagged_by, resolved, created_at
            FROM flagged_conversations
            WHERE resolved = FALSE
            ORDER BY created_at DESC
            """
        )
        rows = cur.fetchall()
    return [_row_to_dict(dict(row)) for row in rows]


async def create_flag(
    *,
    session_id: str,
    user_id: str,
    flag_type: str,
    reason: str,
    flagged_by: str,
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _create_flag_sync,
        session_id=session_id,
        user_id=user_id,
        flag_type=flag_type,
        reason=reason,
        flagged_by=flagged_by,
    )


async def list_flags_for_session(session_id: str) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_flags_for_session_sync, session_id)


async def list_unresolved_flags() -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_unresolved_flags_sync)
