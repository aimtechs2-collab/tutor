"""User notifications and admin email template management."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from aimtutor.api.routers.auth import require_admin, require_auth
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.notifications import (
    broadcast_notification,
    create_email_template_sync,
    create_notification_sync,
    list_email_templates_sync,
    list_notifications_sync,
    mark_all_read_sync,
    mark_read_sync,
    send_email,
    unread_count_sync,
    update_email_template_sync,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class EmailTemplateRequest(BaseModel):
    key: str
    name: str
    subject: str
    html_body: str


class EmailTemplateUpdateRequest(BaseModel):
    key: str | None = None
    name: str | None = None
    subject: str | None = None
    html_body: str | None = None


class AdminSendNotificationRequest(BaseModel):
    segment: str = "all"
    user_ids: list[str] = Field(default_factory=list)
    title: str
    body: str = ""
    type: str = "info"
    category: str = "general"
    send_email: bool = False
    email_subject: str | None = None
    email_html: str | None = None


@router.get("/notifications")
async def get_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    notifications = await asyncio.to_thread(
        list_notifications_sync,
        user.id,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return {"notifications": notifications}


@router.get("/notifications/unread-count")
async def get_unread_count(_: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    count = await asyncio.to_thread(unread_count_sync, user.id)
    return {"count": count}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    notification = await asyncio.to_thread(mark_read_sync, user.id, notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {"notification": notification}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(_: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    count = await asyncio.to_thread(mark_all_read_sync, user.id)
    return {"updated": count}


@router.get("/admin/notifications/templates")
async def admin_list_templates(_: Any = Depends(require_admin)) -> dict[str, Any]:
    templates = await asyncio.to_thread(list_email_templates_sync)
    return {"templates": templates}


@router.post("/admin/notifications/templates")
async def admin_create_template(
    body: EmailTemplateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    template = await asyncio.to_thread(
        create_email_template_sync,
        key=body.key,
        name=body.name,
        subject=body.subject,
        html_body=body.html_body,
    )
    log_admin_action("notification.template_create", summary={"template_id": template["id"]})
    return {"template": template}


@router.put("/admin/notifications/templates/{template_id}")
async def admin_update_template(
    template_id: str,
    body: EmailTemplateUpdateRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    try:
        template = await asyncio.to_thread(
            update_email_template_sync,
            template_id,
            key=body.key,
            name=body.name,
            subject=body.subject,
            html_body=body.html_body,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log_admin_action("notification.template_update", summary={"template_id": template_id})
    return {"template": template}


@router.post("/admin/notifications/send")
async def admin_send_notification(
    body: AdminSendNotificationRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    if not body.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")

    created = await broadcast_notification(
        segment=body.segment,
        title=body.title,
        body=body.body,
        type=body.type,
        category=body.category,
        user_ids=body.user_ids or None,
    )

    emails_sent = 0
    if body.send_email and body.email_subject and body.email_html:
        from aimtutor.services.notifications import _resolve_segment_user_ids

        user_ids = await asyncio.to_thread(_resolve_segment_user_ids, body.segment, body.user_ids)
        for user_id in user_ids:
            try:
                from aimtutor.multi_user.identity import get_user_by_id

                found = get_user_by_id(user_id)
                if not found:
                    continue
                _username, user = found
                email = user.get("email") or _username
                if email and "@" in str(email):
                    await send_email(
                        to=str(email),
                        subject=body.email_subject,
                        html=body.email_html.replace("{{user_id}}", user_id),
                    )
                    emails_sent += 1
            except Exception:
                logger.exception("Failed to send email to user %s", user_id)

    log_admin_action(
        "notification.broadcast",
        summary={"segment": body.segment, "created": created, "emails_sent": emails_sent},
    )
    return {"created": created, "emails_sent": emails_sent}
