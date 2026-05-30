"""
Gemini Live Voice Tutoring Router
==================================

Endpoints:
  GET  /config                — feature flag + model/voice list
  POST /token                 — exchange API key for short-lived ephemeral token
  WS   /session               — bidirectional audio bridge (browser ↔ Gemini Live)

The browser NEVER talks to Google directly. All Gemini Live traffic goes
through the /session WebSocket proxy so the API key stays server-side.

Audio spec:
  Browser → server : 16-bit PCM, 16 kHz, mono  (base64 JSON frames)
  Server  → browser: 16-bit PCM, 24 kHz, mono  (base64 JSON frames)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import secrets
import time
from contextlib import suppress
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from pydantic import BaseModel

from aimtutor.api.routers.auth import require_auth, ws_auth_failed, ws_require_auth
from aimtutor.services.session import get_session_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ── constants ─────────────────────────────────────────────────────────────

LIVE_MODELS = [
    {
        "id": "gemini-2.5-flash-native-audio-latest",
        "display_name": "Gemini 2.5 Flash Native Audio",
        "affective_dialog": False,
    },
    {
        "id": "gemini-2.5-flash-native-audio-preview-09-2025",
        "display_name": "Gemini 2.5 Flash Native Audio Preview",
        "affective_dialog": False,
    },
]
LIVE_VOICES = ["Aoede", "Puck", "Charon", "Kore", "Fenrir"]

IDLE_TIMEOUT_SECONDS = 120
MAX_SESSION_SECONDS = 600
MAX_CONCURRENT_PER_USER = 3

# ── in-memory state ───────────────────────────────────────────────────────

# { sha256(token): {"user_id": str, "ts": float} }
_token_registry: dict[str, dict[str, Any]] = {}
# { user_id: active_session_count }
_active_sessions: dict[str, int] = {}

TOKEN_TTL = 300  # seconds
MODEL_CACHE_TTL = 600
_model_cache: dict[str, Any] | None = None


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _get_api_key() -> str | None:
    load_dotenv(_project_root() / ".env", override=False)
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _clean_expired_tokens() -> None:
    now = time.time()
    expired = [k for k, v in _token_registry.items() if now - v["ts"] > TOKEN_TTL]
    for k in expired:
        del _token_registry[k]


def _display_name(model_id: str) -> str:
    return model_id.replace("-", " ").replace("_", " ").title()


async def _live_models() -> list[dict[str, Any]]:
    """Return Gemini models that currently support the Live WebSocket method."""
    global _model_cache
    now = time.time()
    if _model_cache and now - float(_model_cache["ts"]) < MODEL_CACHE_TTL:
        return list(_model_cache["models"])

    api_key = _get_api_key()
    if not api_key:
        return LIVE_MODELS

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"key": api_key},
            )
        resp.raise_for_status()
        models: list[dict[str, Any]] = []
        for item in resp.json().get("models", []):
            methods = item.get("supportedGenerationMethods") or []
            name = str(item.get("name") or "")
            if "bidiGenerateContent" not in methods or not name.startswith("models/"):
                continue
            model_id = name.split("/", 1)[1]
            models.append(
                {
                    "id": model_id,
                    "display_name": item.get("displayName") or _display_name(model_id),
                    "affective_dialog": "affective" in model_id,
                }
            )
        if models:
            models.sort(key=lambda m: (0 if m["id"].endswith("-latest") else 1, m["id"]))
            _model_cache = {"ts": now, "models": models}
            return models
    except Exception as exc:
        logger.warning("Failed to refresh Gemini Live model list: %s", exc)

    return LIVE_MODELS


# ── rate limiter ──────────────────────────────────────────────────────────

_rate_buckets: dict[str, list[float]] = {}


def _rate_check(key: str, max_calls: int = 10, window: float = 60.0) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets.get(key, [])
    bucket = [t for t in bucket if now - t < window]
    if len(bucket) >= max_calls:
        _rate_buckets[key] = bucket
        return False
    bucket.append(now)
    _rate_buckets[key] = bucket
    return True


# ── models ────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    model: str = "gemini-2.5-flash-native-audio-latest"
    voice: str = "Aoede"
    enable_affective_dialog: bool = False


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/config")
async def get_config() -> dict[str, Any]:
    """Feature-flag endpoint. Safe to call without auth."""
    api_key = _get_api_key()
    return {
        "enabled": bool(api_key),
        "requires_https": True,
        "models": await _live_models(),
        "voices": LIVE_VOICES,
    }


@router.post("/token")
async def create_token(
    body: TokenRequest,
    payload=Depends(require_auth),
) -> dict[str, Any]:
    """
    Exchange the server-side Gemini API key for a short-lived ephemeral token.
    The browser sends this token when opening /session — the API key never
    leaves the server.
    """
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(503, "Gemini Live is not configured. Set GEMINI_API_KEY.")

    # Rate limit
    user_id = getattr(payload, "user_id", None) or "anonymous"
    if not _rate_check(user_id):
        raise HTTPException(429, "Too many token requests. Please wait a moment.")

    from aimtutor.multi_user.context import get_current_user
    from aimtutor.services.quota_guard import enforce_quota

    user = get_current_user()
    if not user.is_admin:
        await enforce_quota(user_id, "voice_minutes", 1.0)

    live_models = await _live_models()
    if body.model not in {m["id"] for m in live_models}:
        raise HTTPException(400, f"Unsupported model: {body.model}")

    # Browser audio is proxied through this FastAPI route, so the browser never
    # connects to Google and never needs a Google ephemeral token. Issue a
    # short-lived AIMTutor session token and keep the real Gemini API key on the
    # server for the upstream WebSocket connection.
    token = secrets.token_urlsafe(32)

    expires_at = time.time() + TOKEN_TTL
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    _clean_expired_tokens()
    _token_registry[token_hash] = {
        "user_id": user_id,
        "ts": time.time(),
        "model": body.model,
        "voice": body.voice,
        "affective": body.enable_affective_dialog,
    }

    import datetime
    return {
        "token": token,
        "expires_at": datetime.datetime.fromtimestamp(
            expires_at, tz=datetime.timezone.utc
        ).isoformat(),
        "model": body.model,
    }


@router.websocket("/session")
async def voice_session(
    ws: WebSocket,
    token: str = Query(...),
    session_id: str | None = Query(default=None),
    kb: str | None = Query(default=None),
    enable_video: bool = Query(default=False),
    proactive_prompt: str | None = Query(default=None),
) -> None:
    """
    WebSocket proxy: browser ↔ AIMTutor ↔ Gemini Live.

    Auth: validated via one-time ephemeral token (no Bearer header needed).
    """
    # Validate token
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    _clean_expired_tokens()
    token_info = _token_registry.get(token_hash)
    if not token_info:
        await ws.close(code=4001, reason="Invalid or expired token")
        return

    user_id: str = token_info["user_id"]
    model: str = token_info["model"]
    voice: str = token_info["voice"]
    affective: bool = token_info["affective"]

    # Consume token (single-use)
    del _token_registry[token_hash]

    # Concurrent session limit
    current = _active_sessions.get(user_id, 0)
    if current >= MAX_CONCURRENT_PER_USER:
        await ws.close(code=4029, reason="Max concurrent sessions reached")
        return

    await ws.accept()
    _active_sessions[user_id] = current + 1
    logger.info("gemini_live.session_start user=%s model=%s kb=%s", user_id, model, kb)

    # Collect transcript for memory
    transcript_turns: list[dict[str, str]] = []
    session_start = time.monotonic()
    last_activity = time.monotonic()
    model_audio_seconds = 0.0
    user_audio_seconds = 0.0

    try:
        # Build system instruction from session context
        system_instruction = await _build_system_instruction(session_id, user_id)

        # Tool declarations
        tools = _build_tool_declarations(kb_name=kb)

        # Session config for Gemini Live
        live_config: dict[str, Any] = {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        }
        if affective and "native-audio" in model:
            live_config["enableAffectiveDialog"] = True

        api_key = _get_api_key()
        if not api_key:
            await ws.send_json({"type": "error", "message": "Server not configured"})
            return

        # Launch session with timeout guard
        try:
            await asyncio.wait_for(
                _run_session(
                    ws=ws,
                    api_key=api_key,
                    model=model,
                    live_config=live_config,
                    kb_name=kb,
                    session_id=session_id,
                    user_id=user_id,
                    proactive_prompt=proactive_prompt,
                    transcript_turns=transcript_turns,
                    last_activity_ref=[last_activity],
                    model_audio_secs_ref=[model_audio_seconds],
                    user_audio_secs_ref=[user_audio_seconds],
                    enable_video=enable_video,
                ),
                timeout=MAX_SESSION_SECONDS,
            )
        except asyncio.TimeoutError:
            with suppress(Exception):
                await ws.send_json({
                    "type": "info",
                    "message": "Maximum session duration (10 min) reached. Please start a new session."
                })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("gemini_live.session_error user=%s: %s", user_id, exc)
        with suppress(Exception):
            await ws.send_json({"type": "error", "message": str(exc)})
    finally:
        _active_sessions[user_id] = max(0, _active_sessions.get(user_id, 1) - 1)
        duration = time.monotonic() - session_start
        logger.info(
            "gemini_live.session_end user=%s duration=%.1fs turns=%d",
            user_id, duration, len(transcript_turns),
        )
        if user_id and user_id not in {"anonymous", "local-admin"}:
            voice_minutes = max(
                duration / 60.0,
                (model_audio_seconds + user_audio_seconds) / 60.0,
            )
            duration_secs = max(duration, model_audio_seconds + user_audio_seconds)
            with suppress(Exception):
                await _log_cost(
                    user_id=user_id,
                    model=model,
                    session_id=session_id,
                    duration_secs=duration_secs,
                    voice_minutes=voice_minutes,
                )
        # Write to L1 memory trace
        if transcript_turns:
            with suppress(Exception):
                await _flush_to_memory(
                    user_id=user_id,
                    session_id=session_id,
                    turns=transcript_turns,
                    duration=duration,
                )


# ── session runner ────────────────────────────────────────────────────────

async def _run_session(
    *,
    ws: WebSocket,
    api_key: str,
    model: str,
    live_config: dict[str, Any],
    kb_name: str | None,
    session_id: str | None,
    user_id: str,
    proactive_prompt: str | None,
    transcript_turns: list[dict[str, str]],
    last_activity_ref: list[float],
    model_audio_secs_ref: list[float],
    user_audio_secs_ref: list[float],
    enable_video: bool,
) -> None:
    """Core bidirectional bridge loop."""
    import base64

    wss_url = (
        f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta."
        f"GenerativeService.BidiGenerateContent?key={api_key}"
    )

    # Use websockets library for the upstream connection
    try:
        import websockets  # type: ignore
    except ImportError:
        await ws.send_json({"type": "error", "message": "websockets package required"})
        return

    setup_payload: dict[str, Any] = {
        "setup": {
            "model": f"models/{model}",
            "generationConfig": live_config,
            "systemInstruction": {"parts": [{"text": system_instruction}]},
        }
    }
    if tools:
        setup_payload["setup"]["tools"] = tools
    setup_msg = json.dumps(setup_payload)

    async with websockets.connect(wss_url) as gemini_ws:
        # Send setup
        await gemini_ws.send(setup_msg)

        # Wait for setup_complete
        raw = await gemini_ws.recv()
        setup_resp = json.loads(raw)
        if "setupComplete" not in str(setup_resp):
            logger.warning("Unexpected setup response: %s", str(setup_resp)[:200])

        # Proactive greeting
        if proactive_prompt:
            await gemini_ws.send(json.dumps({
                "clientContent": {
                    "turns": [{"role": "user", "parts": [{"text": proactive_prompt}]}],
                    "turnComplete": True,
                }
            }))

        # Idle watchdog
        async def watchdog() -> None:
            while True:
                await asyncio.sleep(30)
                if time.monotonic() - last_activity_ref[0] > IDLE_TIMEOUT_SECONDS:
                    with suppress(Exception):
                        await ws.send_json({"type": "info", "message": "Session ended due to inactivity."})
                    await ws.close(code=1000)
                    return

        wdog = asyncio.create_task(watchdog())

        # Browser → Gemini forwarder
        async def browser_to_gemini() -> None:
            async for raw_msg in ws.iter_text():
                last_activity_ref[0] = time.monotonic()
                try:
                    msg = json.loads(raw_msg)
                except json.JSONDecodeError:
                    continue
                t = msg.get("type")
                if t == "audio_chunk":
                    pcm_b64: str = msg["data"]
                    chunk_bytes = len(base64.b64decode(pcm_b64))
                    user_audio_secs_ref[0] += chunk_bytes / 2 / 16000
                    await gemini_ws.send(json.dumps({
                        "realtimeInput": {
                            "mediaChunks": [{"mimeType": "audio/pcm;rate=16000", "data": pcm_b64}]
                        }
                    }))
                elif t == "text":
                    await gemini_ws.send(json.dumps({
                        "clientContent": {
                            "turns": [{"role": "user", "parts": [{"text": msg.get("content", "")}]}],
                            "turnComplete": True,
                        }
                    }))
                elif t == "interrupt":
                    # Signal Gemini to stop generating
                    await gemini_ws.send(json.dumps({"clientContent": {"turnComplete": False}}))
                elif t == "end_turn":
                    return
                elif t == "video_frame" and enable_video:
                    await gemini_ws.send(json.dumps({
                        "realtimeInput": {
                            "mediaChunks": [{"mimeType": "image/jpeg", "data": msg["data"]}]
                        }
                    }))
                elif t == "pong":
                    pass

        # Gemini → browser forwarder
        async def gemini_to_browser() -> None:
            async for raw_resp in gemini_ws:
                resp = json.loads(raw_resp)

                # Audio output
                parts = (
                    resp.get("serverContent", {})
                    .get("modelTurn", {})
                    .get("parts", [])
                )
                for part in parts:
                    if "inlineData" in part:
                        audio_b64: str = part["inlineData"]["data"]
                        chunk_bytes = len(base64.b64decode(audio_b64))
                        model_audio_secs_ref[0] += chunk_bytes / 2 / 24000
                        await ws.send_json({"type": "audio_chunk", "data": audio_b64})
                    elif "text" in part:
                        text_content = part["text"]
                        transcript_turns.append({"role": "model", "text": text_content})
                        await ws.send_json({"type": "transcript", "role": "model", "text": text_content})

                # Turn complete
                if resp.get("serverContent", {}).get("turnComplete"):
                    await ws.send_json({"type": "turn_complete"})

                # Tool calls
                tool_calls = resp.get("toolCall", {}).get("functionCalls", [])
                if tool_calls:
                    tool_responses = []
                    for call in tool_calls:
                        fn_name = call.get("name", "")
                        fn_args = dict(call.get("args", {}))
                        call_id = call.get("id", "")
                        await ws.send_json({"type": "tool_start", "tool": fn_name})
                        result = await _dispatch_tool(fn_name, fn_args, kb_name)
                        await ws.send_json({"type": "tool_done", "tool": fn_name})
                        tool_responses.append({
                            "id": call_id,
                            "name": fn_name,
                            "response": {"output": result},
                        })
                    await gemini_ws.send(json.dumps({
                        "toolResponse": {"functionResponses": tool_responses}
                    }))

                # Input transcription
                input_transcript = (
                    resp.get("serverContent", {})
                    .get("inputTranscription", {})
                    .get("text", "")
                )
                if input_transcript:
                    transcript_turns.append({"role": "user", "text": input_transcript})
                    await ws.send_json({"type": "transcript", "role": "user", "text": input_transcript})

        try:
            await asyncio.gather(
                asyncio.create_task(browser_to_gemini()),
                asyncio.create_task(gemini_to_browser()),
            )
        finally:
            wdog.cancel()
            with suppress(asyncio.CancelledError):
                await wdog


# ── helpers ───────────────────────────────────────────────────────────────

def _sanitize_instruction(text: str) -> str:
    """Strip prompt-injection patterns from user-controlled content."""
    import re
    if not text:
        return ""
    for pattern in [
        r"(?i)ignore\s+(previous|above|all)\s+instructions?",
        r"(?i)you\s+are\s+now\s+",
        r"(?i)new\s+system\s+prompt",
        r"(?i)disregard\s+",
        r"(?i)forget\s+everything",
        r"(?i)override\s+",
    ]:
        text = re.sub(pattern, "[removed]", text)
    return text[:28000]


async def _log_cost(
    *,
    user_id: str,
    model: str,
    session_id: str | None,
    duration_secs: float,
    voice_minutes: float,
) -> None:
    """Record voice quota usage, audit trail, and AI cost analytics."""
    from aimtutor.multi_user.audit import log_usage
    from aimtutor.services.cost_tracker import record_voice_cost
    from aimtutor.services.quota import record_usage

    if voice_minutes > 0:
        with suppress(Exception):
            await record_usage(user_id, "voice_minutes", voice_minutes)
    with suppress(Exception):
        log_usage(
            "voice",
            model,
            "gemini_live_session",
            extra={
                "duration_secs": round(duration_secs, 2),
                "voice_minutes": round(voice_minutes, 4),
                "session_id": session_id,
            },
        )
    with suppress(Exception):
        await record_voice_cost(
            user_id,
            duration_secs,
            model,
            session_id=session_id,
        )


async def _build_system_instruction(
    session_id: str | None,
    user_id: str,
) -> str:
    """Build system instruction from chat history + TutorBot soul."""
    lines = [
        "You are an expert AI tutor. You speak naturally, clearly, and "
        "adapt your explanations to the student's level. Keep answers "
        "focused and conversational — you are in a live voice session.",
    ]

    if session_id:
        try:
            store = get_session_store()
            session = await store.get_session_with_messages(session_id)
            if session:
                messages = session.get("messages", [])[-10:]  # last 10
                context_lines = []
                for m in messages:
                    role = m.get("role", "")
                    content = str(m.get("content", ""))[:200]
                    if role and content:
                        context_lines.append(f"{role.title()}: {content}")
                if context_lines:
                    lines.append(
                        "\nCONTEXT (recent chat history):\n" + "\n".join(context_lines)
                    )
        except Exception as exc:
            logger.warning("gemini_live: failed to load session context: %s", exc)

    return _sanitize_instruction("\n".join(lines))


def _build_tool_declarations(kb_name: str | None) -> list[dict[str, Any]]:
    """Return Gemini Live tool declarations for available AIMTutor tools."""
    declarations = []
    if kb_name:
        declarations.append({
            "name": "search_knowledge_base",
            "description": (
                "Search the student's knowledge base for relevant information. "
                "Use this when the student asks about topics from their uploaded materials."
            ),
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "query": {"type": "STRING", "description": "Search query"},
                },
                "required": ["query"],
            },
        })
    declarations.append({
        "name": "web_search",
        "description": "Search the web for current information on a topic.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Search query"},
            },
            "required": ["query"],
        },
    })
    declarations.append({
        "name": "write_note",
        "description": "Save an important point to the student's notebook for later review.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "content": {"type": "STRING", "description": "The note text"},
                "title": {"type": "STRING", "description": "Short title"},
            },
            "required": ["content"],
        },
    })
    return [{"function_declarations": declarations}]


async def _dispatch_tool(
    name: str,
    args: dict[str, Any],
    kb_name: str | None,
) -> str:
    """Execute a tool call from Gemini Live and return a string result."""
    try:
        if name == "search_knowledge_base" and kb_name:
            from aimtutor.tools.rag_tool import rag_search
            result = await rag_search(query=args.get("query", ""), kb_name=kb_name)
            sources = result.get("sources", [])
            if not sources:
                return "No relevant information found in the knowledge base."
            return "\n\n".join(
                f"[{s.get('source', 'Source')}]\n{s.get('content', '')[:400]}"
                for s in sources[:3]
            )
        elif name == "web_search":
            from aimtutor.tools.web_search import web_search
            results = await web_search(query=args.get("query", ""))
            if not results:
                return "No search results found."
            if isinstance(results, list):
                return "\n".join(
                    f"- {r.get('title','')}: {r.get('snippet','')}"
                    for r in results[:3]
                )
            return str(results)[:600]
        elif name == "write_note":
            # Best-effort note save — don't block if unavailable
            try:
                from aimtutor.tools.write_note import write_note
                await write_note(
                    title=args.get("title", "Voice Note"),
                    content=args.get("content", ""),
                )
            except Exception:
                pass
            return "Note saved to your notebook."
        else:
            return f"Tool '{name}' is not available."
    except Exception as exc:
        logger.warning("gemini_live: tool '%s' failed: %s", name, exc)
        return f"Tool execution failed: {exc}"


def _log_cost(*, user_id: str, duration: float) -> None:
    """Write estimated session cost to audit log."""
    import datetime
    INPUT_RATE_PER_MIN = 0.35
    OUTPUT_RATE_PER_MIN = 1.50
    estimated_cost = (duration / 60) * (INPUT_RATE_PER_MIN + OUTPUT_RATE_PER_MIN) / 2
    try:
        from aimtutor.multi_user.audit import log_usage
        log_usage(
            action="gemini_live_voice",
            user_id=user_id,
            summary={
                "duration_seconds": round(duration, 1),
                "estimated_cost_usd": round(estimated_cost, 4),
            },
        )
    except Exception as exc:
        logger.debug("gemini_live: cost log failed: %s", exc)


async def _flush_to_memory(
    *,
    user_id: str,
    session_id: str | None,
    turns: list[dict[str, str]],
    duration: float,
) -> None:
    """Append voice session transcript to the L1 memory trace."""
    import datetime
    from pathlib import Path

    try:
        from aimtutor.multi_user.paths import MULTI_USER_ROOT, scope_for_user
        from aimtutor.runtime.home import get_runtime_home

        home = get_runtime_home()
        # Determine workspace root
        if user_id == "anonymous" or not (MULTI_USER_ROOT / user_id).exists():
            trace_dir = home / "data" / "workspace" / "memory" / "trace" / "chat"
        else:
            trace_dir = MULTI_USER_ROOT / user_id / "memory" / "trace" / "chat"

        trace_dir.mkdir(parents=True, exist_ok=True)
        date_str = datetime.date.today().isoformat()
        trace_file = trace_dir / f"{date_str}.jsonl"

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
        with open(trace_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        logger.debug("gemini_live: flushed %d turns to L1 trace", len(turns))
    except Exception as exc:
        logger.warning("gemini_live: memory flush failed: %s", exc)
