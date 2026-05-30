"""
Clerk webhook handler — keeps AIMTutor in sync with Clerk user lifecycle.

Events handled:
  user.created   → create AIMTutor user + provision workspace
  user.updated   → sync role changes
  user.deleted   → delete user record (workspace preserved)
  session.created → no-op (Clerk sessions ≠ AIMTutor sessions)

Auth note: Clerk users authenticate via JWT (not AIMTutor password).
We store a random placeholder hash so save_user() accepts the record.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()

WEBHOOK_SECRET = os.environ.get("CLERK_WEBHOOK_SECRET", "")


def _verify_svix(payload: bytes, svix_id: str, svix_ts: str, svix_sig: str) -> dict:
    """Verify Clerk webhook signature using svix."""
    try:
        from svix.webhooks import Webhook, WebhookVerificationError
        wh = Webhook(WEBHOOK_SECRET)
        return wh.verify(payload, {
            "svix-id": svix_id or "",
            "svix-timestamp": svix_ts or "",
            "svix-signature": svix_sig or "",
        })
    except ImportError:
        logger.warning(
            "svix not installed — webhook signature NOT verified. "
            "Install with: pip install svix"
        )
        return json.loads(payload)
    except Exception as exc:
        raise HTTPException(400, f"Invalid webhook signature: {exc}") from exc


def _extract_username(data: dict) -> str:
    """Derive a stable username from Clerk user data."""
    clerk_id: str = data.get("id", "")
    # Prefer Clerk username, fall back to email prefix, fall back to id prefix
    username = data.get("username") or ""
    if not username:
        email = (data.get("email_addresses") or [{}])[0].get("email_address", "")
        username = email.split("@")[0] if email else ""
    if not username:
        username = f"user_{clerk_id[:8]}"
    return username.lower().strip()


def _clerk_placeholder_hash(clerk_id: str) -> str:
    """A deterministic but unusable password hash for Clerk-authed users."""
    # This hash can never be matched by bcrypt login attempts — Clerk users
    # authenticate via JWT, never via AIMTutor's password endpoint.
    return "CLERK:" + hashlib.sha256(clerk_id.encode()).hexdigest()


async def _provision_user(data: dict) -> None:
    """Create the AIMTutor user record and workspace for a new Clerk user."""
    try:
        from aimtutor.multi_user.identity import save_user
        from aimtutor.multi_user.paths import ensure_user_workspace

        clerk_id: str = data["id"]
        username = _extract_username(data)
        role: str = data.get("public_metadata", {}).get("role", "user")
        ph = _clerk_placeholder_hash(clerk_id)

        # save_user auto-promotes first user to admin; role param is the desired role
        record = save_user(username=username, hashed_password=ph, role=role)
        ensure_user_workspace(record.get("id", clerk_id))

        logger.info("clerk_webhook: provisioned user '%s' id=%s", username, record.get("id"))

        # If save_user auto-promoted to admin, sync back to Clerk
        if record.get("role") == "admin" and role != "admin":
            _clerk_set_role(clerk_id, "admin")

    except Exception as exc:
        logger.error("clerk_webhook: provision failed for %s: %s", data.get("id"), exc)


async def _update_user(data: dict) -> None:
    """Sync a role change from Clerk to AIMTutor."""
    try:
        from aimtutor.multi_user.identity import get_user, set_role

        username = _extract_username(data)
        new_role: str = data.get("public_metadata", {}).get("role", "user")
        existing = get_user(username)
        if existing and existing.get("role") != new_role:
            set_role(username, new_role)
            logger.info("clerk_webhook: updated role for '%s' → %s", username, new_role)
    except Exception as exc:
        logger.warning("clerk_webhook: update failed: %s", exc)


async def _delete_user(data: dict) -> None:
    """Remove a user record when deleted in Clerk."""
    try:
        from aimtutor.multi_user.identity import delete_user

        username = _extract_username(data)
        if username:
            deleted = delete_user(username)
            logger.info("clerk_webhook: deleted user '%s' (found=%s)", username, deleted)
    except Exception as exc:
        logger.warning("clerk_webhook: delete failed: %s", exc)


def _clerk_set_role(clerk_id: str, role: str) -> None:
    """Promote a user role via Clerk management API."""
    secret = os.environ.get("CLERK_SECRET_KEY", "")
    if not secret:
        return
    try:
        import httpx
        httpx.patch(
            f"https://api.clerk.com/v1/users/{clerk_id}/metadata",
            headers={"Authorization": f"Bearer {secret}"},
            json={"public_metadata": {"role": role}},
            timeout=5,
        )
    except Exception as exc:
        logger.warning("clerk_webhook: Clerk role sync failed: %s", exc)


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    svix_id: str = Header(None, alias="svix-id"),
    svix_timestamp: str = Header(None, alias="svix-timestamp"),
    svix_signature: str = Header(None, alias="svix-signature"),
) -> dict[str, str]:
    """Receive and process Clerk lifecycle events."""
    if not WEBHOOK_SECRET:
        raise HTTPException(503, "CLERK_WEBHOOK_SECRET is not configured")

    payload = await request.body()
    event = _verify_svix(
        payload, svix_id or "", svix_timestamp or "", svix_signature or ""
    )

    event_type: str = event.get("type", "")
    data: dict[str, Any] = event.get("data", {})

    if event_type == "user.created":
        await _provision_user(data)
    elif event_type == "user.updated":
        await _update_user(data)
    elif event_type == "user.deleted":
        await _delete_user(data)
    # session.created: no action needed

    logger.info("clerk_webhook: handled %s", event_type)
    return {"status": "ok", "event": event_type}
