"""Admin helpers for cross-user conversation review."""

from __future__ import annotations

from typing import Any

from aimtutor.multi_user.flagged_conversations import list_unresolved_flags
from aimtutor.multi_user.identity import list_user_info
from aimtutor.multi_user.models import CurrentUser
from aimtutor.multi_user.paths import scope_for_user, user_context
from aimtutor.services.path_service import get_path_service
from aimtutor.services.quota import get_user_plan_limits
from aimtutor.services.session.sqlite_store import SQLiteSessionStore


def _capability_matches(session_capability: str, requested: str) -> bool:
    capability = (session_capability or "chat").lower()
    needle = requested.lower()
    if needle == "chat":
        return capability in {"chat", ""} or capability.startswith("chat")
    if needle == "quiz":
        return "question" in capability or "quiz" in capability
    if needle == "research":
        return "research" in capability
    if needle == "voice":
        return "voice" in capability or "live" in capability or "gemini" in capability
    return capability == needle


def _user_from_record(record: dict[str, Any]) -> CurrentUser:
    user_id = str(record.get("id") or "")
    username = str(record.get("username") or "")
    role = str(record.get("role") or "user")
    is_admin = role == "admin"
    return CurrentUser(
        id=user_id,
        username=username,
        role="admin" if is_admin else "user",  # type: ignore[arg-type]
        scope=scope_for_user(user_id, is_admin=is_admin),
    )


async def list_admin_conversations(
    *,
    user_id: str | None = None,
    capability: str | None = None,
    search: str | None = None,
    flag_filter: str = "all",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    users = [
        user
        for user in list_user_info()
        if not bool(user.get("disabled", False))
        and (not user_id or str(user.get("id") or "") == user_id)
    ]

    unresolved = await list_unresolved_flags()
    flagged_sessions = {item["session_id"] for item in unresolved}
    flags_by_session: dict[str, list[dict[str, Any]]] = {}
    for item in unresolved:
        flags_by_session.setdefault(item["session_id"], []).append(item)

    search_text = (search or "").strip().lower()
    conversations: list[dict[str, Any]] = []

    for record in users:
        ctx_user = _user_from_record(record)
        with user_context(ctx_user):
            db_path = get_path_service().get_chat_history_db()
            if not db_path.exists():
                continue
            store = SQLiteSessionStore(db_path=db_path)
            sessions = await store.list_sessions(limit=10, offset=0)
            for session in sessions:
                session_capability = str(session.get("capability") or "chat")
                if capability and capability.lower() != "all":
                    if not _capability_matches(session_capability, capability):
                        continue
                title = str(session.get("title") or "Untitled")
                if search_text and search_text not in title.lower():
                    continue
                session_id = str(session.get("session_id") or session.get("id") or "")
                is_flagged = session_id in flagged_sessions
                if flag_filter == "flagged" and not is_flagged:
                    continue
                if flag_filter == "unflagged" and is_flagged:
                    continue
                conversations.append(
                    {
                        "session_id": session_id,
                        "title": title,
                        "capability": session_capability,
                        "created_at": session.get("created_at"),
                        "updated_at": session.get("updated_at"),
                        "message_count": int(session.get("message_count") or 0),
                        "status": session.get("status", "idle"),
                        "last_message": session.get("last_message", ""),
                        "user_id": ctx_user.id,
                        "username": ctx_user.username,
                        "flagged": is_flagged,
                        "flags": flags_by_session.get(session_id, []),
                    }
                )

    conversations.sort(
        key=lambda item: float(item.get("updated_at") or item.get("created_at") or 0),
        reverse=True,
    )
    return conversations[offset : offset + limit]


async def get_admin_conversation(session_id: str, user_id: str) -> dict[str, Any] | None:
    users = list_user_info()
    record = next((user for user in users if str(user.get("id") or "") == user_id), None)
    if record is None:
        return None

    ctx_user = _user_from_record(record)
    with user_context(ctx_user):
        db_path = get_path_service().get_chat_history_db()
        if not db_path.exists():
            return None
        store = SQLiteSessionStore(db_path=db_path)
        session = await store.get_session_with_messages(session_id)
        if session is None:
            return None

    from aimtutor.multi_user.flagged_conversations import list_flags_for_session

    flags = await list_flags_for_session(session_id)
    unresolved = [flag for flag in flags if not flag.get("resolved")]
    plan_limits = await get_user_plan_limits(user_id)

    return {
        "session": session,
        "user_id": user_id,
        "username": ctx_user.username,
        "plan_name": plan_limits.get("plan_name", "free"),
        "plan_display": plan_limits.get("plan_display", "Free"),
        "flag_info": {
            "flagged": bool(unresolved),
            "flags": flags,
            "unresolved": unresolved,
        },
    }
