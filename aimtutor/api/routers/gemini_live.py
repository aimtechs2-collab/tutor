"""
Gemini Live Voice Tutoring Router
==================================

Endpoints:
  GET  /api/v1/gemini-live/config   — feature flag + model/voice list
  POST /api/v1/gemini-live/token    — generate a server-side session token
  WS   /api/v1/gemini-live/session  — bidirectional audio bridge

How auth works:
  1. Browser calls POST /token → gets a short-lived UUID token
  2. Browser opens WS /session?token=<uuid>
  3. Server validates token, then opens its own WS to Gemini Live
     with the real API key embedded server-side (never sent to browser)

Audio spec:
  Browser → server : 16-bit PCM, 16 kHz, mono  (base64-encoded JSON)
  Server  → browser: 16-bit PCM, 24 kHz, mono  (base64-encoded JSON)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from contextlib import suppress
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from aimtutor.api.routers.auth import require_auth
from aimtutor.services.session import get_session_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ── constants ─────────────────────────────────────────────────────────────

LIVE_MODELS = [
    {
        "id": "gemini-2.0-flash-live-001",
        "display_name": "Gemini 2.0 Flash Live",
        "affective_dialog": False,
    },
    {
        "id": "gemini-2.5-flash-preview-native-audio-dialog",
        "display_name": "Gemini 2.5 Flash Live (Preview)",
        "affective_dialog": True,
    },
]
LIVE_VOICES = ["Aoede", "Puck", "Charon", "Kore", "Fenrir"]

GEMINI_LIVE_WSS = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta."
    "GenerativeService.BidiGenerateContent"
)

TOKEN_TTL_SECONDS = 300
IDLE_TIMEOUT_SECONDS = 120
MAX_SESSION_SECONDS = 600
MAX_CONCURRENT_PER_USER = 3

# ── in-memory state ───────────────────────────────────────────────────────

# { token_uuid: {"user_id": str, "ts": float, "model": str, "voice": str, ...} }
_token_registry: dict[str, dict[str, Any]] = {}
# { user_id: active_session_count }
_active_sessions: dict[str, int] = {}
# simple per-key call tracker for rate limiting
_rate_buckets: dict[str, list[float]] = {}


def _get_api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _clean_expired_tokens() -> None:
    now = time.time()
    expired = [k for k, v in _token_registry.items() if now - v["ts"] > TOKEN_TTL_SECONDS]
    for k in expired:
        del _token_registry[k]


def _rate_ok(key: str, max_calls: int = 10, window: float = 60.0) -> bool:
    now = time.monotonic()
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window]
    if len(bucket) >= max_calls:
        _rate_buckets[key] = bucket
        return False
    bucket.append(now)
    _rate_buckets[key] = bucket
    return True


# ── models ────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    model: str = "gemini-2.0-flash-live-001"
    voice: str = "Aoede"
    enable_affective_dialog: bool = False


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/config")
async def get_config() -> dict[str, Any]:
    """Public feature-flag endpoint — safe to call without auth."""
    return {
        "enabled": bool(_get_api_key()),
        "requires_https": True,
        "models": LIVE_MODELS,
        "voices": LIVE_VOICES,
    }


@router.post("/token")
async def create_token(
    body: TokenRequest,
    payload: Any = Depends(require_auth),
) -> dict[str, Any]:
    """
    Issue a short-lived server-side session token.
    The Gemini API key never leaves the server — the browser only
    receives this opaque UUID token, which it passes to /session.
    """
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(503, "GEMINI_API_KEY is not configured on the server.")

    valid_model_ids = {m["id"] for m in LIVE_MODELS}
    if body.model not in valid_model_ids:
        # Fall back to default rather than hard-reject
        body.model = "gemini-2.0-flash-live-001"

    user_id: str = str(getattr(payload, "user_id", None) or "anonymous")
    if not _rate_ok(user_id):
        raise HTTPException(429, "Too many requests. Please wait a moment.")

    _clean_expired_tokens()

    token = str(uuid.uuid4())
    import datetime
    expires_at = datetime.datetime.fromtimestamp(
        time.time() + TOKEN_TTL_SECONDS, tz=datetime.timezone.utc
    ).isoformat()

    _token_registry[token] = {
        "user_id": user_id,
        "ts": time.time(),
        "model": body.model,
        "voice": body.voice,
        "affective": body.enable_affective_dialog,
    }

    return {"token": token, "expires_at": expires_at, "model": body.model}


@router.websocket("/session")
async def voice_session(
    ws: WebSocket,
    token: str = Query(...),
    session_id: str | None = Query(default=None),
    kb: str | None = Query(default=None),
    enable_video: bool = Query(default=False),
    proactive_prompt: str | None = Query(default=None),
) -> None:
    """Bidirectional audio proxy: browser ↔ AIMTutor server ↔ Gemini Live."""
    # Validate token
    _clean_expired_tokens()
    token_info = _token_registry.get(token)
    if not token_info:
        await ws.close(code=4001, reason="Invalid or expired token")
        return

    user_id: str = token_info["user_id"]
    model: str = token_info["model"]
    voice: str = token_info["voice"]
    affective: bool = token_info["affective"]
    # Single-use
    del _token_registry[token]

    # Concurrent session limit
    if _active_sessions.get(user_id, 0) >= MAX_CONCURRENT_PER_USER:
        await ws.close(code=4029, reason="Max concurrent sessions reached")
        return

    await ws.accept()
    _active_sessions[user_id] = _active_sessions.get(user_id, 0) + 1
    logger.info("gemini_live session_start user=%s model=%s kb=%s", user_id, model, kb)

    transcript_turns: list[dict[str, str]] = []
    session_start = time.monotonic()

    try:
        await asyncio.wait_for(
            _proxy_session(
                ws=ws,
                model=model,
                voice=voice,
                affective=affective,
                kb_name=kb,
                session_id=session_id,
                user_id=user_id,
                proactive_prompt=proactive_prompt,
                transcript_turns=transcript_turns,
                enable_video=enable_video,
            ),
            timeout=MAX_SESSION_SECONDS,
        )
    except asyncio.TimeoutError:
        with suppress(Exception):
            await ws.send_json({
                "type": "info",
                "message": "Session reached the 10-minute limit. Start a new session to continue.",
            })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("gemini_live session_error user=%s: %s", user_id, exc)
        with suppress(Exception):
            await ws.send_json({"type": "error", "message": str(exc)})
    finally:
        _active_sessions[user_id] = max(0, _active_sessions.get(user_id, 1) - 1)
        duration = time.monotonic() - session_start
        logger.info(
            "gemini_live session_end user=%s duration=%.1fs turns=%d",
            user_id, duration, len(transcript_turns),
        )
        if transcript_turns:
            with suppress(Exception):
                await _flush_to_memory(
                    user_id=user_id,
                    session_id=session_id,
                    turns=transcript_turns,
                    duration=duration,
                )


# ── proxy session ─────────────────────────────────────────────────────────

async def _proxy_session(
    *,
    ws: WebSocket,
    model: str,
    voice: str,
    affective: bool,
    kb_name: str | None,
    session_id: str | None,
    user_id: str,
    proactive_prompt: str | None,
    transcript_turns: list[dict[str, str]],
    enable_video: bool,
) -> None:
    try:
        import websockets as _ws  # type: ignore
    except ImportError:
        await ws.send_json({
            "type": "error",
            "message": "Server missing 'websockets' package. Run: pip install websockets",
        })
        return

    api_key = _get_api_key()
    gemini_url = f"{GEMINI_LIVE_WSS}?key={api_key}"

    system_instruction = await _build_system_instruction(session_id)
    tools = _build_tool_declarations(kb_name)

    setup_payload: dict[str, Any] = {
        "setup": {
            "model": f"models/{model}",
            "generation_config": {
                "response_modalities": ["AUDIO", "TEXT"],
                "speech_config": {
                    "voice_config": {
                        "prebuilt_voice_config": {"voice_name": voice}
                    }
                },
            },
            "system_instruction": {"parts": [{"text": system_instruction}]},
        }
    }
    if tools:
        setup_payload["setup"]["tools"] = tools
    if affective and "2.5" in model:
        setup_payload["setup"]["generation_config"]["enable_affective_dialog"] = True

    last_activity: list[float] = [time.monotonic()]

    async with _ws.connect(gemini_url) as gemini_ws:
        # Send setup
        await gemini_ws.send(json.dumps(setup_payload))

        # Wait for setupComplete
        try:
            raw = await asyncio.wait_for(gemini_ws.recv(), timeout=10)
            resp = json.loads(raw)
            if "setupComplete" not in json.dumps(resp):
                logger.warning("gemini_live: unexpected setup response: %s", str(resp)[:200])
        except asyncio.TimeoutError:
            await ws.send_json({"type": "error", "message": "Gemini Live setup timed out."})
            return

        # Proactive greeting
        if proactive_prompt:
            await gemini_ws.send(json.dumps({
                "client_content": {
                    "turns": [{"role": "user", "parts": [{"text": proactive_prompt}]}],
                    "turn_complete": True,
                }
            }))

        # Idle watchdog
        async def watchdog() -> None:
            while True:
                await asyncio.sleep(30)
                if time.monotonic() - last_activity[0] > IDLE_TIMEOUT_SECONDS:
                    with suppress(Exception):
                        await ws.send_json({"type": "info", "message": "Session ended due to inactivity."})
                    await ws.close(code=1000)
                    return

        # Keepalive ping to browser
        async def ping_browser() -> None:
            while True:
                await asyncio.sleep(25)
                with suppress(Exception):
                    await ws.send_json({"type": "ping"})

        # Browser → Gemini
        async def browser_to_gemini() -> None:
            async for raw_msg in ws.iter_text():
                last_activity[0] = time.monotonic()
                try:
                    msg = json.loads(raw_msg)
                except json.JSONDecodeError:
                    continue
                t = msg.get("type", "")
                if t == "audio_chunk":
                    await gemini_ws.send(json.dumps({
                        "realtime_input": {
                            "media_chunks": [{
                                "mime_type": "audio/pcm;rate=16000",
                                "data": msg["data"],
                            }]
                        }
                    }))
                elif t == "text":
                    await gemini_ws.send(json.dumps({
                        "client_content": {
                            "turns": [{"role": "user", "parts": [{"text": msg.get("content", "")}]}],
                            "turn_complete": True,
                        }
                    }))
                elif t == "interrupt":
                    with suppress(Exception):
                        await gemini_ws.send(json.dumps({
                            "client_content": {"turn_complete": False}
                        }))
                elif t == "end_turn":
                    return
                elif t == "video_frame" and enable_video:
                    await gemini_ws.send(json.dumps({
                        "realtime_input": {
                            "media_chunks": [{
                                "mime_type": "image/jpeg",
                                "data": msg["data"],
                            }]
                        }
                    }))
                # pong: no-op

        # Gemini → browser
        async def gemini_to_browser() -> None:
            async for raw_resp in gemini_ws:
                try:
                    resp = json.loads(raw_resp)
                except Exception:
                    continue

                server_content = resp.get("serverContent", {})
                model_turn = server_content.get("modelTurn", {})

                for part in model_turn.get("parts", []):
                    inline = part.get("inlineData", {})
                    if inline.get("data"):
                        await ws.send_json({"type": "audio_chunk", "data": inline["data"]})
                    elif part.get("text"):
                        text = part["text"]
                        transcript_turns.append({"role": "model", "text": text})
                        await ws.send_json({"type": "transcript", "role": "model", "text": text})

                if server_content.get("turnComplete"):
                    await ws.send_json({"type": "turn_complete"})

                input_trans = server_content.get("inputTranscription", {}).get("text", "")
                if input_trans:
                    transcript_turns.append({"role": "user", "text": input_trans})
                    await ws.send_json({"type": "transcript", "role": "user", "text": input_trans})

                # Tool calls
                for fn_call in resp.get("toolCall", {}).get("functionCalls", []):
                    fn_name = fn_call.get("name", "")
                    fn_args = dict(fn_call.get("args", {}))
                    call_id = fn_call.get("id", "")
                    await ws.send_json({"type": "tool_start", "tool": fn_name})
                    result = await _dispatch_tool(fn_name, fn_args, kb_name)
                    await ws.send_json({"type": "tool_done", "tool": fn_name})
                    await gemini_ws.send(json.dumps({
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": fn_name,
                                "response": {"output": result},
                            }]
                        }
                    }))

        wdog_task = asyncio.create_task(watchdog())
        ping_task = asyncio.create_task(ping_browser())
        try:
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(browser_to_gemini()),
                    asyncio.create_task(gemini_to_browser()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        finally:
            wdog_task.cancel()
            ping_task.cancel()
            with suppress(asyncio.CancelledError):
                await wdog_task
            with suppress(asyncio.CancelledError):
                await ping_task


# ── helpers ───────────────────────────────────────────────────────────────

async def _build_system_instruction(session_id: str | None) -> str:
    lines = [
        "You are an expert AI tutor in a live voice session. "
        "Speak naturally and conversationally. Keep answers focused "
        "and clear. Adapt your explanations to the student's level.",
    ]
    if session_id:
        try:
            store = get_session_store()
            session = await store.get_session_with_messages(session_id)
            if session:
                messages = (session.get("messages") or [])[-10:]
                context = []
                for m in messages:
                    role = m.get("role", "")
                    content = str(m.get("content", ""))[:200].replace("\n", " ")
                    if role and content:
                        context.append(f"{role.title()}: {content}")
                if context:
                    lines.append("\nRecent conversation context:\n" + "\n".join(context))
        except Exception as exc:
            logger.debug("gemini_live: could not load session context: %s", exc)
    return "\n".join(lines)


def _build_tool_declarations(kb_name: str | None) -> list[dict[str, Any]]:
    decls: list[dict[str, Any]] = []
    if kb_name:
        decls.append({
            "name": "search_knowledge_base",
            "description": "Search the student's uploaded course materials and documents.",
            "parameters": {
                "type": "OBJECT",
                "properties": {"query": {"type": "STRING", "description": "What to look up"}},
                "required": ["query"],
            },
        })
    decls.append({
        "name": "web_search",
        "description": "Search the web for current information on a topic.",
        "parameters": {
            "type": "OBJECT",
            "properties": {"query": {"type": "STRING", "description": "Search query"}},
            "required": ["query"],
        },
    })
    return [{"function_declarations": decls}] if decls else []


async def _dispatch_tool(
    name: str, args: dict[str, Any], kb_name: str | None
) -> str:
    try:
        if name == "search_knowledge_base" and kb_name:
            from aimtutor.tools.rag_tool import rag_search
            result = await rag_search(query=args.get("query", ""), kb_name=kb_name)
            sources = result.get("sources") or result.get("results") or []
            if not sources:
                return "No relevant information found in the knowledge base."
            return "\n\n".join(
                f"[{s.get('source', 'Source')}]\n{str(s.get('content') or s.get('text', ''))[:400]}"
                for s in sources[:3]
            )
        elif name == "web_search":
            from aimtutor.tools.web_search import web_search
            # web_search is synchronous — run in thread pool
            result = await asyncio.to_thread(web_search, args.get("query", ""))
            if not result:
                return "No search results found."
            # WebSearchResponse or dict — extract readable text
            if hasattr(result, "results"):
                items = result.results[:3]
                return "\n".join(
                    f"- {getattr(r, 'title', '')} ({getattr(r, 'url', '')}): {getattr(r, 'snippet', '')}"
                    for r in items
                )
            return str(result)[:600]
        else:
            return f"Tool '{name}' is not available."
    except Exception as exc:
        logger.warning("gemini_live tool '%s' failed: %s", name, exc)
        return f"Tool execution failed: {exc}"


async def _flush_to_memory(
    *,
    user_id: str,
    session_id: str | None,
    turns: list[dict[str, str]],
    duration: float,
) -> None:
    """Append voice session transcript to the L1 memory trace."""
    import datetime
    try:
        from aimtutor.services.memory.paths import memory_root
        trace_dir = memory_root() / "trace" / "chat"
        trace_dir.mkdir(parents=True, exist_ok=True)
        date_str = datetime.date.today().isoformat()
        record = {
            "type": "voice_session",
            "session_id": session_id or f"voice-{int(time.time())}",
            "user_id": user_id,
            "surface": "chat",
            "started_at": datetime.datetime.fromtimestamp(
                time.time() - duration, tz=datetime.timezone.utc
            ).isoformat(),
            "ended_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "duration_seconds": round(duration, 1),
            "turn_count": len(turns),
            "turns": turns,
        }
        with open(trace_dir / f"{date_str}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        logger.debug("gemini_live: flushed %d turns to memory", len(turns))
    except Exception as exc:
        logger.warning("gemini_live: memory flush failed: %s", exc)
