"""Dashboard API backed by the unified SQLite session store."""

from typing import Any

from fastapi import APIRouter, HTTPException

from aimtutor.services.session import get_session_store

router = APIRouter()


@router.get("/recent")
async def get_recent_activities(limit: int = 50, type: str | None = None):
    store = get_session_store()
    sessions = await store.list_sessions(limit=limit, offset=0)
    activities: list[dict[str, Any]] = []

    for session in sessions:
        capability = str(session.get("capability") or "chat")
        activity_type = capability.replace("deep_", "")
        if type is not None and activity_type != type:
            continue
        activities.append(
            {
                "id": session.get("session_id"),
                "type": activity_type,
                "capability": capability,
                "title": session.get("title", "Untitled"),
                "timestamp": session.get("updated_at", session.get("created_at", 0)),
                "summary": (session.get("last_message") or "")[:160],
                "session_ref": f"sessions/{session.get('session_id')}",
                "message_count": session.get("message_count", 0),
                "status": session.get("status", "idle"),
                "active_turn_id": session.get("active_turn_id"),
            }
        )

    return activities[:limit]


@router.get("/{entry_id}")
async def get_activity_entry(entry_id: str):
    store = get_session_store()
    session = await store.get_session_with_messages(entry_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    capability = str(session.get("capability") or "chat")
    return {
        "id": session.get("session_id"),
        "type": capability.replace("deep_", ""),
        "capability": capability,
        "title": session.get("title"),
        "timestamp": session.get("updated_at", session.get("created_at")),
        "content": {
            "messages": session.get("messages", []),
            "active_turns": session.get("active_turns", []),
            "status": session.get("status", "idle"),
            "summary": session.get("compressed_summary", ""),
        },
    }


# ── Extended dashboard endpoints ──────────────────────────────────────────

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from aimtutor.api.routers.auth import require_auth
from aimtutor.services.memory.paths import memory_root


@router.get("/stats")
async def get_dashboard_stats(_payload=Depends(require_auth)):
    """Aggregate stats for the current user's dashboard."""
    store = get_session_store()
    sessions = await store.list_sessions(limit=500, offset=0)

    total_sessions = len(sessions)
    quiz_sessions = [s for s in sessions if s.get("capability") in ("question", "quiz")]
    voice_sessions = []

    # Read voice sessions from L1 memory traces
    try:
        trace_dir = memory_root() / "trace" / "chat"
        if trace_dir.exists():
            for f in sorted(trace_dir.glob("*.jsonl"))[-30:]:
                with open(f) as fh:
                    for line in fh:
                        try:
                            rec = json.loads(line)
                            if rec.get("type") == "voice_session":
                                voice_sessions.append(rec)
                        except Exception:
                            continue
    except Exception:
        pass

    voice_minutes = sum(v.get("duration_seconds", 0) for v in voice_sessions) / 60

    # Streak calculation from session timestamps
    today = datetime.now(timezone.utc).date()
    active_dates = sorted({
        datetime.fromtimestamp(s.get("updated_at", 0), tz=timezone.utc).date()
        for s in sessions
        if s.get("updated_at", 0) > 0
    }, reverse=True)

    streak = 0
    for i, d in enumerate(active_dates):
        if (today - d).days == i:
            streak += 1
        else:
            break

    # 7-day activity breakdown
    seven_days: dict[str, dict[str, int]] = {}
    for i in range(7):
        from datetime import timedelta
        day = (today - timedelta(days=6 - i)).isoformat()
        seven_days[day] = {"chat": 0, "quiz": 0, "voice": 0, "research": 0, "other": 0}

    for s in sessions:
        day = datetime.fromtimestamp(s.get("updated_at", 0), tz=timezone.utc).date().isoformat()
        if day in seven_days:
            cap = s.get("capability", "chat") or "chat"
            if cap in ("question", "quiz"):
                seven_days[day]["quiz"] += 1
            elif cap == "research":
                seven_days[day]["research"] += 1
            elif cap in ("chat", "solve"):
                seven_days[day]["chat"] += 1
            else:
                seven_days[day]["other"] += 1

    for v in voice_sessions:
        ts = v.get("started_at") or v.get("ended_at") or ""
        if ts:
            try:
                day = datetime.fromisoformat(ts).date().isoformat()
                if day in seven_days:
                    seven_days[day]["voice"] += 1
            except Exception:
                pass

    # Last active time
    last_active_ts = max((s.get("updated_at", 0) for s in sessions), default=0)
    last_active = (
        datetime.fromtimestamp(last_active_ts, tz=timezone.utc).isoformat()
        if last_active_ts else None
    )

    return {
        "total_sessions": total_sessions,
        "quiz_sessions": len(quiz_sessions),
        "voice_minutes": round(voice_minutes, 1),
        "streak_days": streak,
        "last_active": last_active,
        "seven_day_activity": seven_days,
    }


@router.get("/memory-snapshot")
async def get_memory_snapshot(_payload=Depends(require_auth)):
    """Return L2 memory summaries for the current user."""
    snapshot: dict[str, str] = {}
    try:
        l2_dir = memory_root() / "L2"
        if l2_dir.exists():
            for md_file in l2_dir.glob("*.md"):
                content = md_file.read_text(encoding="utf-8")
                snapshot[md_file.stem] = content[:2000]
    except Exception:
        pass
    return snapshot


# fastapi Depends import
from fastapi import Depends  # noqa: E402 — appended to existing module
