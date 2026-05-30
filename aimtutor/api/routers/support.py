"""User support tickets and admin helpdesk management."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from aimtutor.api.routers.auth import require_auth, require_support_agent
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.support import (
    admin_reply_sync,
    assign_ticket_sync,
    create_ticket_sync,
    get_admin_ticket_sync,
    get_user_ticket_sync,
    list_admin_tickets_sync,
    list_user_tickets_sync,
    reply_user_ticket_sync,
    update_ticket_priority_sync,
    update_ticket_status_sync,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateTicketRequest(BaseModel):
    subject: str
    body: str
    category: str = "general"
    priority: str = "medium"


class ReplyRequest(BaseModel):
    body: str


class AdminReplyRequest(BaseModel):
    body: str
    is_internal: bool = False


class StatusUpdateRequest(BaseModel):
    status: str


class AssignRequest(BaseModel):
    assigned_to: str | None = None


class PriorityUpdateRequest(BaseModel):
    priority: str


class AiSuggestRequest(BaseModel):
    context: str = ""


@router.post("/support/tickets")
async def create_ticket(
    body: CreateTicketRequest,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    try:
        ticket = await asyncio.to_thread(
            create_ticket_sync,
            user.id,
            subject=body.subject,
            body=body.body,
            category=body.category,
            priority=body.priority,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"ticket": ticket}


@router.get("/support/tickets")
async def list_my_tickets(_: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    tickets = await asyncio.to_thread(list_user_tickets_sync, user.id)
    return {"tickets": tickets}


@router.get("/support/tickets/{ticket_id}")
async def get_my_ticket(
    ticket_id: str,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    ticket = await asyncio.to_thread(get_user_ticket_sync, user.id, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return {"ticket": ticket}


@router.post("/support/tickets/{ticket_id}/reply")
async def reply_to_ticket(
    ticket_id: str,
    body: ReplyRequest,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    try:
        ticket = await asyncio.to_thread(reply_user_ticket_sync, user.id, ticket_id, body.body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"ticket": ticket}


@router.get("/admin/support/tickets")
async def admin_list_tickets(
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    tickets = await asyncio.to_thread(
        list_admin_tickets_sync,
        status=status,
        priority=priority,
    )
    return {"tickets": tickets}


@router.get("/admin/support/tickets/{ticket_id}")
async def admin_get_ticket(
    ticket_id: str,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    ticket = await asyncio.to_thread(get_admin_ticket_sync, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return {"ticket": ticket}


@router.post("/admin/support/tickets/{ticket_id}/reply")
async def admin_reply(
    ticket_id: str,
    body: AdminReplyRequest,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    actor = get_current_user()
    try:
        ticket = await asyncio.to_thread(
            admin_reply_sync,
            ticket_id,
            actor.id,
            body=body.body,
            is_internal=body.is_internal,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    log_admin_action(
        "support.reply",
        summary={"ticket_id": ticket_id, "internal": body.is_internal},
    )
    return {"ticket": ticket}


@router.put("/admin/support/tickets/{ticket_id}/status")
async def admin_update_status(
    ticket_id: str,
    body: StatusUpdateRequest,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    try:
        ticket = await asyncio.to_thread(update_ticket_status_sync, ticket_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    log_admin_action("support.status", summary={"ticket_id": ticket_id, "status": body.status})
    return {"ticket": ticket}


@router.put("/admin/support/tickets/{ticket_id}/assign")
async def admin_assign(
    ticket_id: str,
    body: AssignRequest,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    try:
        ticket = await asyncio.to_thread(assign_ticket_sync, ticket_id, body.assigned_to)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log_admin_action(
        "support.assign",
        summary={"ticket_id": ticket_id, "assigned_to": body.assigned_to},
    )
    return {"ticket": ticket}


@router.put("/admin/support/tickets/{ticket_id}/priority")
async def admin_priority(
    ticket_id: str,
    body: PriorityUpdateRequest,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    try:
        ticket = await asyncio.to_thread(update_ticket_priority_sync, ticket_id, body.priority)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    log_admin_action(
        "support.priority",
        summary={"ticket_id": ticket_id, "priority": body.priority},
    )
    return {"ticket": ticket}


@router.post("/admin/support/tickets/{ticket_id}/ai-suggest")
async def admin_ai_suggest(
    ticket_id: str,
    body: AiSuggestRequest,
    _: Any = Depends(require_support_agent),
) -> dict[str, Any]:
    ticket = await asyncio.to_thread(get_admin_ticket_sync, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")

    thread = "\n".join(
        f"[{msg['author_role']}] {msg['body']}"
        for msg in ticket.get("messages", [])
        if not msg.get("is_internal")
    )
    prompt = (
        f"You are a helpful customer support agent for AIMTutor.\n"
        f"Ticket subject: {ticket['subject']}\n"
        f"Thread:\n{thread}\n\n"
        f"Additional context: {body.context.strip()}\n\n"
        "Draft a concise, empathetic reply to the user. Do not include internal notes."
    )
    try:
        from aimtutor.services.llm import complete

        suggestion = str(await complete(prompt, system_prompt="You write professional support replies."))
    except Exception as exc:
        logger.exception("AI suggest failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI suggestion failed: {exc}",
        ) from exc
    return {"suggestion": suggestion}
