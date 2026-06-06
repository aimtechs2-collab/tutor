"""Dashboard API — recent activity + stats for the current user."""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from aimtutor.api.routers.auth import require_auth
from aimtutor.services.memory.paths import memory_root
from aimtutor.services.session import get_session_store

router = APIRouter(dependencies=[Depends(require_auth)])

# Voice trace scan is filesystem-heavy; cache briefly so /stats and /overview
# do not re-walk JSONL on every dashboard visit.
_voice_sessions_cache: tuple[float, list[dict[str, Any]]] = (0.0, [])
_VOICE_CACHE_TTL_SEC = 45.0

# One session list powers stats + recent; 200 covers typical accounts without
# the old 500-row query cost (multiple subqueries per row).
_DASHBOARD_SESSION_LIMIT = 200


# ── helpers ───────────────────────────────────────────────────────────────

def _read_voice_sessions(limit_files: int = 30) -> list[dict[str, Any]]:
    """Read voice session records from L1 JSONL traces (short-lived cache)."""
    global _voice_sessions_cache
    now = time.monotonic()
    cached_at, cached = _voice_sessions_cache
    if cached and (now - cached_at) < _VOICE_CACHE_TTL_SEC:
        return cached

    voice: list[dict[str, Any]] = []
    try:
        trace_dir = memory_root() / "trace" / "chat"
        if not trace_dir.exists():
            _voice_sessions_cache = (now, voice)
            return voice
        for f in sorted(trace_dir.glob("*.jsonl"))[-limit_files:]:
            with open(f, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        rec = json.loads(line)
                        if rec.get("type") == "voice_session":
                            voice.append(rec)
                    except Exception:
                        continue
    except Exception:
        pass
    _voice_sessions_cache = (now, voice)
    return voice


def _memory_snapshot() -> dict[str, str]:
    snapshot: dict[str, str] = {}
    try:
        l2_dir = memory_root() / "L2"
        if l2_dir.exists():
            for md_file in l2_dir.glob("*.md"):
                snapshot[md_file.stem] = md_file.read_text(encoding="utf-8")[:2000]
    except Exception:
        pass
    return snapshot


def _stats_from_sessions(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    quiz_sessions = [
        s for s in sessions if s.get("capability") in ("question", "quiz")
    ]
    voice_sessions = _read_voice_sessions()
    voice_minutes = sum(v.get("duration_seconds", 0) for v in voice_sessions) / 60

    today = datetime.now(timezone.utc).date()
    active_dates = sorted(
        {
            datetime.fromtimestamp(s.get("updated_at", 0), tz=timezone.utc).date()
            for s in sessions
            if s.get("updated_at", 0) > 0
        },
        reverse=True,
    )
    streak = 0
    for i, d in enumerate(active_dates):
        if (today - d).days == i:
            streak += 1
        else:
            break

    seven_days: dict[str, dict[str, int]] = {
        (today - timedelta(days=6 - i)).isoformat(): {
            "chat": 0, "quiz": 0, "voice": 0, "research": 0, "other": 0,
        }
        for i in range(7)
    }

    for s in sessions:
        day = datetime.fromtimestamp(
            s.get("updated_at", 0), tz=timezone.utc
        ).date().isoformat()
        if day not in seven_days:
            continue
        cap = s.get("capability") or "chat"
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
        try:
            day = datetime.fromisoformat(ts).date().isoformat()
            if day in seven_days:
                seven_days[day]["voice"] += 1
        except Exception:
            pass

    last_active_ts = max((s.get("updated_at", 0) for s in sessions), default=0)

    return {
        "total_sessions": len(sessions),
        "quiz_sessions": len(quiz_sessions),
        "voice_minutes": round(voice_minutes, 1),
        "streak_days": streak,
        "last_active": (
            datetime.fromtimestamp(last_active_ts, tz=timezone.utc).isoformat()
            if last_active_ts
            else None
        ),
        "seven_day_activity": seven_days,
    }


def _activities_from_sessions(
    sessions: list[dict[str, Any]],
    *,
    limit: int,
    activity_type: str | None = None,
) -> list[dict[str, Any]]:
    activities: list[dict[str, Any]] = []
    for session in sessions:
        capability = str(session.get("capability") or "chat")
        row_type = capability.replace("deep_", "")
        if activity_type is not None and row_type != activity_type:
            continue
        activities.append(
            {
                "id": session.get("session_id"),
                "type": row_type,
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
        if len(activities) >= limit:
            break
    return activities


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/overview")
async def get_dashboard_overview(
    activity_limit: int = 40,
) -> dict[str, Any]:
    """Single round-trip payload for the dashboard (stats + recent + memory)."""
    store = get_session_store()
    sessions = await store.list_sessions(
        limit=_DASHBOARD_SESSION_LIMIT, offset=0
    )
    return {
        "stats": _stats_from_sessions(sessions),
        "activities": _activities_from_sessions(
            sessions, limit=min(activity_limit, 50)
        ),
        "memory": _memory_snapshot(),
    }


@router.get("/stats")
async def get_dashboard_stats() -> dict[str, Any]:
    """Aggregate stats for the current user's dashboard."""
    store = get_session_store()
    sessions = await store.list_sessions(
        limit=_DASHBOARD_SESSION_LIMIT, offset=0
    )
    return _stats_from_sessions(sessions)


@router.get("/memory-snapshot")
async def get_memory_snapshot() -> dict[str, str]:
    """Return L2 memory summaries for the current user."""
    return _memory_snapshot()


@router.get("/recent")
async def get_recent_activities(
    limit: int = 50,
    type: str | None = None,
) -> list[dict[str, Any]]:
    """Recent sessions — public within the app (auth handled by dependency at router level)."""
    store = get_session_store()
    sessions = await store.list_sessions(limit=limit, offset=0)
    return _activities_from_sessions(sessions, limit=limit, activity_type=type)


@router.get("/{entry_id}")
async def get_activity_entry(entry_id: str) -> dict[str, Any]:
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
