"""
Presence — lightweight online indicator.

GET /api/v1/presence/stream  — SSE stream (admin only) of online user IDs
POST /api/v1/presence/ping   — heartbeat from browser (any authed user)
GET /api/v1/presence/snapshot — point-in-time snapshot (admin only)
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from aimtutor.api.routers.auth import require_admin, require_auth

router = APIRouter()

_presence: dict[str, float] = {}   # user_id -> last_ping monotonic
TIMEOUT = 90.0                      # seconds until considered offline


@router.post("/ping")
async def ping(payload: Any = Depends(require_auth)) -> dict[str, str]:
    uid = str(getattr(payload, "user_id", None) or "anonymous")
    _presence[uid] = time.monotonic()
    return {"status": "ok"}


@router.get("/snapshot")
async def snapshot(_: Any = Depends(require_admin)) -> dict[str, Any]:
    now = time.monotonic()
    online = [uid for uid, ts in _presence.items() if now - ts < TIMEOUT]
    return {"online": online, "count": len(online)}


@router.get("/stream")
async def presence_stream(_: Any = Depends(require_admin)) -> StreamingResponse:
    async def generator():
        while True:
            now = time.monotonic()
            online = [uid for uid, ts in _presence.items() if now - ts < TIMEOUT]
            yield f"data: {json.dumps({'online': online, 'count': len(online)})}\n\n"
            await asyncio.sleep(10)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
