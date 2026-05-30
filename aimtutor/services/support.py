"""Support ticket and message persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from aimtutor.services.db import connect

VALID_STATUSES = {"open", "in_progress", "resolved", "closed"}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _message_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "ticket_id": str(row["ticket_id"]),
        "author_id": str(row["author_id"]),
        "author_role": str(row.get("author_role") or "user"),
        "body": str(row.get("body") or ""),
        "is_internal": bool(row.get("is_internal", False)),
        "created_at": _iso_timestamp(row.get("created_at")),
    }


def _ticket_row(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "subject": str(row["subject"]),
        "status": str(row.get("status") or "open"),
        "priority": str(row.get("priority") or "medium"),
        "category": str(row.get("category") or "general"),
        "assigned_to": row.get("assigned_to"),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    payload.update(extra)
    return payload


def _ticket_messages_sync(ticket_id: str, *, include_internal: bool) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        if include_internal:
            cur.execute(
                """
                SELECT * FROM ticket_messages
                WHERE ticket_id = %s
                ORDER BY created_at ASC
                """,
                (ticket_id,),
            )
        else:
            cur.execute(
                """
                SELECT * FROM ticket_messages
                WHERE ticket_id = %s AND is_internal = false
                ORDER BY created_at ASC
                """,
                (ticket_id,),
            )
        rows = cur.fetchall()
    return [_message_row(dict(row)) for row in rows]


def create_ticket_sync(
    user_id: str,
    *,
    subject: str,
    body: str,
    category: str = "general",
    priority: str = "medium",
) -> dict[str, Any]:
    subject = subject.strip()
    body = body.strip()
    if not subject or not body:
        raise ValueError("Subject and message are required")
    if priority not in VALID_PRIORITIES:
        priority = "medium"

    ticket_id = f"ticket_{uuid4().hex}"
    message_id = f"tmsg_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO support_tickets (
                id, user_id, subject, status, priority, category, created_at, updated_at
            ) VALUES (%s, %s, %s, 'open', %s, %s, now(), now())
            RETURNING *
            """,
            (ticket_id, user_id, subject, priority, category.strip() or "general"),
        )
        ticket = dict(cur.fetchone())
        cur.execute(
            """
            INSERT INTO ticket_messages (
                id, ticket_id, author_id, author_role, body, is_internal, created_at
            ) VALUES (%s, %s, %s, 'user', %s, false, now())
            """,
            (message_id, ticket_id, user_id, body),
        )
        conn.commit()
    result = _ticket_row(ticket)
    result["messages"] = _ticket_messages_sync(ticket_id, include_internal=False)
    return result


def list_user_tickets_sync(user_id: str) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.*,
                   (
                       SELECT body FROM ticket_messages m
                       WHERE m.ticket_id = t.id AND m.is_internal = false
                       ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message
            FROM support_tickets t
            WHERE t.user_id = %s
            ORDER BY t.updated_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    return [_ticket_row(dict(row), last_message=row.get("last_message")) for row in rows]


def get_user_ticket_sync(user_id: str, ticket_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM support_tickets WHERE id = %s AND user_id = %s",
            (ticket_id, user_id),
        )
        row = cur.fetchone()
    if row is None:
        return None
    ticket = _ticket_row(dict(row))
    ticket["messages"] = _ticket_messages_sync(ticket_id, include_internal=False)
    return ticket


def reply_user_ticket_sync(user_id: str, ticket_id: str, body: str) -> dict[str, Any]:
    body = body.strip()
    if not body:
        raise ValueError("Message body is required")
    ticket = get_user_ticket_sync(user_id, ticket_id)
    if ticket is None:
        raise ValueError("Ticket not found")
    if ticket["status"] in {"closed", "resolved"}:
        raise ValueError("Ticket is closed")

    message_id = f"tmsg_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ticket_messages (
                id, ticket_id, author_id, author_role, body, is_internal, created_at
            ) VALUES (%s, %s, %s, 'user', %s, false, now())
            """,
            (message_id, ticket_id, user_id, body),
        )
        cur.execute(
            """
            UPDATE support_tickets
            SET status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
                updated_at = now()
            WHERE id = %s
            """,
            (ticket_id,),
        )
        conn.commit()
    updated = get_user_ticket_sync(user_id, ticket_id)
    assert updated is not None
    return updated


def list_admin_tickets_sync(
    *,
    status: str | None = None,
    priority: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if status:
        clauses.append("status = %s")
        params.append(status)
    if priority:
        clauses.append("priority = %s")
        params.append(priority)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT t.*,
                   (
                       SELECT body FROM ticket_messages m
                       WHERE m.ticket_id = t.id
                       ORDER BY m.created_at DESC LIMIT 1
                   ) AS last_message
            FROM support_tickets t
            WHERE {' AND '.join(clauses)}
            ORDER BY
                CASE t.priority
                    WHEN 'urgent' THEN 0
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    ELSE 3
                END,
                t.updated_at DESC
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [_ticket_row(dict(row), last_message=row.get("last_message")) for row in rows]


def get_admin_ticket_sync(ticket_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM support_tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
    if row is None:
        return None
    ticket = _ticket_row(dict(row))
    ticket["messages"] = _ticket_messages_sync(ticket_id, include_internal=True)
    return ticket


def admin_reply_sync(
    ticket_id: str,
    author_id: str,
    *,
    body: str,
    is_internal: bool = False,
) -> dict[str, Any]:
    body = body.strip()
    if not body:
        raise ValueError("Message body is required")
    ticket = get_admin_ticket_sync(ticket_id)
    if ticket is None:
        raise ValueError("Ticket not found")

    message_id = f"tmsg_{uuid4().hex}"
    role = "agent" if not is_internal else "agent"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ticket_messages (
                id, ticket_id, author_id, author_role, body, is_internal, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, now())
            """,
            (message_id, ticket_id, author_id, role, body, is_internal),
        )
        if not is_internal and ticket["status"] == "open":
            cur.execute(
                "UPDATE support_tickets SET status = 'in_progress', updated_at = now() WHERE id = %s",
                (ticket_id,),
            )
        else:
            cur.execute(
                "UPDATE support_tickets SET updated_at = now() WHERE id = %s",
                (ticket_id,),
            )
        conn.commit()
    updated = get_admin_ticket_sync(ticket_id)
    assert updated is not None
    return updated


def update_ticket_status_sync(ticket_id: str, status: str) -> dict[str, Any]:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE support_tickets
            SET status = %s, updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (status, ticket_id),
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        raise ValueError("Ticket not found")
    return _ticket_row(dict(row))


def assign_ticket_sync(ticket_id: str, assigned_to: str | None) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE support_tickets
            SET assigned_to = %s, updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (assigned_to or None, ticket_id),
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        raise ValueError("Ticket not found")
    return _ticket_row(dict(row))


def update_ticket_priority_sync(ticket_id: str, priority: str) -> dict[str, Any]:
    if priority not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority: {priority}")
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE support_tickets
            SET priority = %s, updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (priority, ticket_id),
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        raise ValueError("Ticket not found")
    return _ticket_row(dict(row))
