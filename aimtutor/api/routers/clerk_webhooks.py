"""
Clerk webhook handler — keeps AIMTutor in sync with Clerk user lifecycle.

Events handled:
  user.created  → provision workspace, auto-promote first user to admin
  user.updated  → sync profile changes
  user.deleted  → soft-delete (workspace preserved)
  session.created → update last_active timestamp
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()

WEBHOOK_SECRET = os.environ.get("CLERK_WEBHOOK_SECRET", "")


def _verify_svix(payload: bytes, svix_id: str, svix_ts: str, svix_sig: str) -> dict:
    """Verify Clerk webhook signature using svix."""
    try:
        from svix.webhooks import Webhook, WebhookVerificationError
    except ImportError:
        # svix not installed — skip verification in dev (warn loudly)
        logger.warning("svix not installed — webhook signature NOT verified. Install with: pip install svix")
        return json.loads(payload)

    try:
        wh = Webhook(WEBHOOK_SECRET)
        return wh.verify(payload, {
            "svix-id": svix_id or "",
            "svix-timestamp": svix_ts or "",
            "svix-signature": svix_sig or "",
        })
    except Exception as exc:
        raise HTTPException(400, f"Invalid webhook signature: {exc}") from exc


async def _provision_workspace(data: dict) -> None:
    """Create workspace dirs and user profile for a new Clerk user."""
    try:
        from aimtutor.multi_user.identity import add_user, list_user_info
        from aimtutor.multi_user.paths import ensure_user_workspace

        uid: str = data["id"]
        email: str = (data.get("email_addresses") or [{}])[0].get("email_address", "")
        first: str = data.get("first_name") or ""
        last: str = data.get("last_name") or ""
        username: str = (
            data.get("username")
            or email.split("@")[0]
            or f"user_{uid[:8]}"
        )
        role: str = data.get("public_metadata", {}).get("role", "user")

        # First-ever user becomes admin
        existing = list_user_info()
        if not existing:
            role = "admin"
            logger.info("clerk_webhook: first user %s promoted to admin", username)
            # Promote via Clerk API if key available
            _clerk_set_role(uid, "admin")

        ensure_user_workspace(uid)
        add_user(uid, username, role=role, email=email,
                 display_name=f"{first} {last}".strip() or username)
        logger.info("clerk_webhook: provisioned workspace for %s (%s)", username, uid)
    except Exception as exc:
        logger.error("clerk_webhook: provision failed for %s: %s", data.get("id"), exc)


async def _update_profile(data: dict) -> None:
    try:
        from aimtutor.multi_user.identity import update_user

        uid: str = data["id"]
        email: str = (data.get("email_addresses") or [{}])[0].get("email_address", "")
        role: str = data.get("public_metadata", {}).get("role", "user")
        update_user(uid, role=role, email=email)
    except Exception as exc:
        logger.warning("clerk_webhook: profile update failed: %s", exc)


async def _soft_delete(uid: str) -> None:
    try:
        from aimtutor.multi_user.identity import disable_user
        disable_user(uid)
        logger.info("clerk_webhook: soft-deleted %s", uid)
    except Exception as exc:
        logger.warning("clerk_webhook: soft-delete failed: %s", exc)


async def _touch_last_active(data: dict) -> None:
    try:
        from aimtutor.multi_user.identity import touch_last_active
        touch_last_active(data.get("user_id") or data.get("id", ""))
    except Exception as exc:
        logger.debug("clerk_webhook: touch_last_active failed: %s", exc)


def _clerk_set_role(uid: str, role: str) -> None:
    """Promote a Clerk user role via the Clerk management API."""
    secret = os.environ.get("CLERK_SECRET_KEY", "")
    if not secret:
        return
    try:
        import httpx
        httpx.patch(
            f"https://api.clerk.com/v1/users/{uid}/metadata",
            headers={"Authorization": f"Bearer {secret}"},
            json={"public_metadata": {"role": role}},
            timeout=5,
        )
    except Exception as exc:
        logger.warning("clerk_webhook: Clerk role update failed: %s", exc)


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    svix_id: str = Header(None, alias="svix-id"),
    svix_timestamp: str = Header(None, alias="svix-timestamp"),
    svix_signature: str = Header(None, alias="svix-signature"),
) -> dict[str, str]:
    if not WEBHOOK_SECRET:
        raise HTTPException(503, "CLERK_WEBHOOK_SECRET is not configured")

    payload = await request.body()
    event = _verify_svix(payload, svix_id or "", svix_timestamp or "", svix_signature or "")
    event_type: str = event.get("type", "")
    data: dict[str, Any] = event.get("data", {})

    if event_type == "user.created":
        await _provision_workspace(data)
    elif event_type == "user.updated":
        await _update_profile(data)
    elif event_type == "user.deleted":
        await _soft_delete(data.get("id", ""))
    elif event_type == "session.created":
        await _touch_last_active(data)

    logger.info("clerk_webhook: handled %s", event_type)
    return {"status": "ok", "event": event_type}
