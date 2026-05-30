"""Persist Gemini Live voice turns as normal chat session messages."""

from __future__ import annotations

from aimtutor.services.session import get_sqlite_session_store

LIVE_GREET_SIGNAL = "__GREET_USER__"


async def persist_live_transcript_turns(
    session_id: str,
    turns: list[dict[str, str]],
) -> dict[str, object]:
    if not turns:
        return {"session_id": session_id, "count": 0, "message_ids": []}

    store = get_sqlite_session_store()
    if await store.get_session(session_id) is None:
        await store.create_session(title="Live voice chat", session_id=session_id)

    message_ids: list[int] = []
    for turn in turns:
        text = str(turn.get("text", "")).strip()
        if not text or text == LIVE_GREET_SIGNAL:
            continue
        role_raw = str(turn.get("role", "")).lower()
        role = "user" if role_raw in ("user", "student") else "assistant"
        message_id = await store.add_message(
            session_id=session_id,
            role=role,
            content=text,
            capability="live_voice",
            metadata={"source": "gemini_live"},
        )
        message_ids.append(message_id)

    return {
        "session_id": session_id,
        "count": len(message_ids),
        "message_ids": message_ids,
    }
