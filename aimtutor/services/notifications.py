"""In-app notifications and email delivery."""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from uuid import uuid4

import httpx
from psycopg2.extras import Json

from aimtutor.services.db import connect

logger = logging.getLogger(__name__)


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _notification_row(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata")
    if isinstance(metadata, str):
        import json

        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": str(row["title"]),
        "body": str(row.get("body") or ""),
        "type": str(row.get("type") or "info"),
        "category": str(row.get("category") or "general"),
        "read": bool(row.get("read", False)),
        "read_at": _iso_timestamp(row["read_at"]) if row.get("read_at") else None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "created_at": _iso_timestamp(row.get("created_at")),
    }


def _template_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "key": str(row["key"]),
        "name": str(row["name"]),
        "subject": str(row["subject"]),
        "html_body": str(row.get("html_body") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }


def create_notification_sync(
    user_id: str,
    *,
    title: str,
    body: str = "",
    type: str = "info",
    category: str = "general",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    notification_id = f"notif_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (
                id, user_id, title, body, type, category, read, metadata, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, false, %s, now())
            RETURNING *
            """,
            (
                notification_id,
                user_id,
                title.strip(),
                body.strip(),
                type.strip() or "info",
                category.strip() or "general",
                Json(metadata or {}),
            ),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _notification_row(row)


async def create_notification(
    user_id: str,
    *,
    title: str,
    body: str = "",
    type: str = "info",
    category: str = "general",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import asyncio

    return await asyncio.to_thread(
        create_notification_sync,
        user_id,
        title=title,
        body=body,
        type=type,
        category=category,
        metadata=metadata,
    )


def list_notifications_sync(
    user_id: str,
    *,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    clauses = ["user_id = %s"]
    params: list[Any] = [user_id]
    if unread_only:
        clauses.append("read = false")
    params.extend([limit, offset])
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT *
            FROM notifications
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [_notification_row(dict(row)) for row in rows]


def unread_count_sync(user_id: str) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM notifications
            WHERE user_id = %s AND read = false
            """,
            (user_id,),
        )
        return int(cur.fetchone()["count"])


def mark_read_sync(user_id: str, notification_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE notifications
            SET read = true, read_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING *
            """,
            (notification_id, user_id),
        )
        row = cur.fetchone()
        conn.commit()
    return _notification_row(dict(row)) if row else None


def mark_all_read_sync(user_id: str) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE notifications
            SET read = true, read_at = now()
            WHERE user_id = %s AND read = false
            """,
            (user_id,),
        )
        count = cur.rowcount
        conn.commit()
    return count


def _resolve_segment_user_ids(segment: str, user_ids: list[str] | None = None) -> list[str]:
    if segment == "user_ids" and user_ids:
        return [uid for uid in user_ids if uid.strip()]
    with connect() as conn, conn.cursor() as cur:
        if segment == "all":
            cur.execute(
                """
                SELECT id FROM auth_users
                WHERE COALESCE(disabled, false) = false
                  AND COALESCE(banned, false) = false
                """
            )
        elif segment.startswith("plan:"):
            plan_name = segment.split(":", 1)[1].strip()
            cur.execute(
                """
                SELECT DISTINCT up.user_id
                FROM user_plans up
                JOIN plans p ON p.id = up.plan_id
                WHERE p.name = %s AND up.status = 'active'
                """,
                (plan_name,),
            )
        else:
            return []
        rows = cur.fetchall()
    return [str(row["user_id"] if "user_id" in row else row["id"]) for row in rows]


async def broadcast_notification(
    *,
    segment: str,
    title: str,
    body: str = "",
    type: str = "info",
    category: str = "general",
    user_ids: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    import asyncio

    targets = await asyncio.to_thread(_resolve_segment_user_ids, segment, user_ids)
    created = 0
    for user_id in targets:
        await create_notification(
            user_id,
            title=title,
            body=body,
            type=type,
            category=category,
            metadata=metadata,
        )
        created += 1
    return created


async def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    text: str | None = None,
) -> dict[str, Any]:
    recipients = [to] if isinstance(to, str) else list(to)
    recipients = [r.strip() for r in recipients if r and r.strip()]
    if not recipients:
        raise ValueError("At least one recipient is required")

    from_addr = os.getenv("EMAIL_FROM", "noreply@aimtechnologies.in")
    resend_key = os.getenv("RESEND_API_KEY", "").strip()

    if resend_key:
        payload = {
            "from": from_addr,
            "to": recipients,
            "subject": subject,
            "html": html,
        }
        if text:
            payload["text"] = text
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {resend_key}"},
                json=payload,
            )
        if response.status_code >= 400:
            raise RuntimeError(f"Resend error: {response.text}")
        return {"provider": "resend", "result": response.json()}

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    if not user or not password:
        raise RuntimeError("Email not configured: set RESEND_API_KEY or SMTP credentials")

    import asyncio

    def _send_smtp() -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = ", ".join(recipients)
        if text:
            msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(from_addr, recipients, msg.as_string())

    await asyncio.to_thread(_send_smtp)
    return {"provider": "smtp", "recipients": recipients}


def list_email_templates_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM email_templates ORDER BY name ASC")
        rows = cur.fetchall()
    return [_template_row(dict(row)) for row in rows]


def get_email_template_sync(template_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM email_templates WHERE id = %s", (template_id,))
        row = cur.fetchone()
    return _template_row(dict(row)) if row else None


def create_email_template_sync(
    *,
    key: str,
    name: str,
    subject: str,
    html_body: str,
) -> dict[str, Any]:
    template_id = f"etpl_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO email_templates (id, key, name, subject, html_body, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, now(), now())
            RETURNING *
            """,
            (template_id, key.strip(), name.strip(), subject.strip(), html_body),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _template_row(row)


def update_email_template_sync(
    template_id: str,
    *,
    key: str | None = None,
    name: str | None = None,
    subject: str | None = None,
    html_body: str | None = None,
) -> dict[str, Any]:
    fields: list[str] = []
    values: list[Any] = []
    if key is not None:
        fields.append("key = %s")
        values.append(key.strip())
    if name is not None:
        fields.append("name = %s")
        values.append(name.strip())
    if subject is not None:
        fields.append("subject = %s")
        values.append(subject.strip())
    if html_body is not None:
        fields.append("html_body = %s")
        values.append(html_body)
    if not fields:
        existing = get_email_template_sync(template_id)
        if existing is None:
            raise ValueError("Template not found")
        return existing
    fields.append("updated_at = now()")
    values.append(template_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE email_templates SET {', '.join(fields)} WHERE id = %s RETURNING *",
            tuple(values),
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        raise ValueError("Template not found")
    return _template_row(dict(row))
