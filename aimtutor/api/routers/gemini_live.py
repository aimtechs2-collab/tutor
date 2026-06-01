"""
Gemini Live Voice (MyTutor /teacher parity)
===========================================

  GET  /config  — feature flag + pinned model
  POST /token   — Google ephemeral token (system prompt locked server-side)
  WS   /session — deprecated (browser connects directly to Google)

The browser opens:
  wss://...BidiGenerateContentConstrained?access_token=<ephemeral_token>
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from pydantic import BaseModel, Field

from aimtutor.api.routers.auth import require_auth
from aimtutor.services.session import get_session_store

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview"
LIVE_VOICES = ["Aoede", "Puck", "Charon", "Kore", "Fenrir"]
LIVE_SESSION_MINUTES = 10

_rate_buckets: dict[str, list[float]] = {}


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_env() -> None:
    root = _project_root()
    load_dotenv(root / ".env", override=False)
    mytutor_env = root.parent / "mytutor" / ".env"
    if mytutor_env.is_file():
        load_dotenv(mytutor_env, override=False)


def _get_api_key() -> str | None:
    _load_env()
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _pinned_live_model() -> str:
    return (os.environ.get("GEMINI_LIVE_MODEL") or DEFAULT_LIVE_MODEL).strip()


def _display_name(model_id: str) -> str:
    return model_id.replace("-", " ").replace("_", " ").title()


def _live_model_catalog() -> list[dict[str, Any]]:
    mid = _pinned_live_model()
    return [{"id": mid, "display_name": _display_name(mid), "affective_dialog": False}]


def _rate_check(key: str, max_calls: int = 10, window: float = 60.0) -> bool:
    now = time.monotonic()
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window]
    if len(bucket) >= max_calls:
        _rate_buckets[key] = bucket
        return False
    bucket.append(now)
    _rate_buckets[key] = bucket
    return True


class TokenRequest(BaseModel):
    voice: str = "Aoede"
    session_id: str | None = None
    recent_context: str | None = None


class LiveTranscriptTurn(BaseModel):
    role: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class LiveTranscriptRequest(BaseModel):
    turns: list[LiveTranscriptTurn] = Field(default_factory=list)


@router.post("/transcript/{session_id}")
async def save_live_transcript(session_id: str, payload: LiveTranscriptRequest):
    """Save Live voice turns (alias for sessions live-transcript)."""
    from aimtutor.services.session.live_transcript import persist_live_transcript_turns

    return await persist_live_transcript_turns(
        session_id,
        [{"role": t.role, "text": t.text} for t in payload.turns],
    )


@router.get("/config")
async def get_config() -> dict[str, Any]:
    api_key = _get_api_key()
    pinned = _pinned_live_model()
    return {
        "enabled": bool(api_key),
        "requires_https": True,
        "direct_connect": True,
        "models": _live_model_catalog(),
        "default_model": pinned,
        "voices": LIVE_VOICES,
    }


@router.post("/token")
async def create_token(
    body: TokenRequest,
    payload=Depends(require_auth),
) -> dict[str, Any]:
    """Mint a Google ephemeral Live token (same flow as MyTutor POST /api/gemini/token)."""
    api_key = _get_api_key()
    if not api_key:
        raise HTTPException(503, "Gemini Live is not configured. Set GEMINI_API_KEY.")

    user_id = getattr(payload, "user_id", None) or "anonymous"
    if not _rate_check(user_id):
        raise HTTPException(429, "Too many token requests. Please wait a moment.")

    from aimtutor.multi_user.context import get_current_user
    from aimtutor.services.quota_guard import enforce_quota

    user = get_current_user()
    if not user.is_admin:
        await enforce_quota(user_id, "voice_minutes", 1.0)

    model = _pinned_live_model()
    system_instruction = await _build_system_instruction(body.session_id, user_id)
    recent = (body.recent_context or "").strip()
    if recent:
        system_instruction += (
            "\n\n--- RECENT LIVE CONVERSATION (resume naturally) ---\n"
            f"{recent[:12_000]}\n--- END ---"
        )

    try:
        token_name = await _mint_ephemeral_token(
            api_key=api_key,
            model=model,
            voice=body.voice,
            system_instruction=system_instruction,
        )
    except Exception as exc:
        logger.exception("gemini_live token mint failed: %s", exc)
        raise HTTPException(500, f"Token generation failed: {exc}") from exc

    expire_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        minutes=LIVE_SESSION_MINUTES
    )
    return {
        "token": token_name,
        "model": model,
        "expires_at": expire_at.isoformat(),
        "direct_connect": True,
    }


@router.websocket("/session")
async def voice_session_deprecated(ws: WebSocket) -> None:
    """Legacy proxy removed — client must use direct Google WebSocket."""
    await ws.accept()
    await ws.send_json({
        "type": "error",
        "message": "Live proxy is disabled. Please refresh the page.",
    })
    await ws.close(code=4000, reason="Use direct Gemini Live connection")


def _live_google_search_enabled() -> bool:
    _load_env()
    return os.environ.get("GEMINI_LIVE_GOOGLE_SEARCH", "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )


async def _mint_ephemeral_token(
    *,
    api_key: str,
    model: str,
    voice: str,
    system_instruction: str,
) -> str:
    def _create() -> str:
        from google import genai

        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1alpha"},
        )
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expire_time = now + datetime.timedelta(minutes=LIVE_SESSION_MINUTES)
        new_session_expire = now + datetime.timedelta(minutes=1)

        live_config: dict[str, Any] = {
            "session_resumption": {},
            "temperature": 0.8,
            "response_modalities": ["AUDIO"],
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": voice},
                }
            },
            "realtime_input_config": {
                "automatic_activity_detection": {"disabled": False},
                "activity_handling": "START_OF_ACTIVITY_INTERRUPTS",
            },
            "input_audio_transcription": {},
            "output_audio_transcription": {},
        }
        if _live_google_search_enabled():
            live_config["tools"] = [{"google_search": {}}]

        token = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": expire_time.isoformat(),
                "new_session_expire_time": new_session_expire.isoformat(),
                "http_options": {"api_version": "v1alpha"},
                "live_connect_constraints": {
                    "model": model,
                    "config": live_config,
                },
            }
        )
        if not token.name:
            raise RuntimeError("Token generation returned no name")
        return token.name

    return await asyncio.to_thread(_create)


async def _build_system_instruction(
    session_id: str | None,
    user_id: str,
) -> str:
    lines = [
        "You are an expert AI live voice tutor. Speak naturally, like a real teacher on a call.",
        "Never expose internal reasoning, planning, or markdown headings in your speech.",
        "Keep answers focused and conversational. You are in a live voice session.",
        "When the user sends the hidden signal \"__GREET_USER__\", treat it as a session-start cue.",
        "Do NOT say \"__GREET_USER__\" out loud. Greet the student warmly in one short sentence",
        "and ask what they would like to work on, then wait for their reply.",
        "",
        "SCREEN / CAMERA:",
        "When the student shares their screen or turns on their camera, you receive "
        "their live image frames. Look at the most recent frames and help with what you "
        "actually see — read the text, code, diagrams, apps, or objects that are visible.",
        "Base everything you say only on what is genuinely visible in the frames. If the "
        "frames look blank or unreadable, or you are not receiving any video right now, "
        "say so honestly and ask them to share their screen or turn on the camera. Never "
        "guess or invent what is on their screen when you are not actually receiving it.",
    ]

    if session_id:
        try:
            store = get_session_store()
            session = await store.get_session_with_messages(session_id)
            if session:
                messages = session.get("messages", [])

                context_lines = []
                for m in messages[-10:]:
                    role = m.get("role", "")
                    content = str(m.get("content", ""))[:200]
                    if role and content:
                        context_lines.append(f"{role.title()}: {content}")
                if context_lines:
                    lines.append(
                        "\nCONTEXT (recent chat history):\n" + "\n".join(context_lines)
                    )

                doc_block = _build_attached_documents_block(messages)
                if doc_block:
                    lines.append(doc_block)
        except Exception as exc:
            logger.warning("gemini_live: failed to load session context: %s", exc)

    return "\n".join(lines)


# Keep the live system prompt within a sane size: Gemini Live caps the
# constrained-token config, and very large prompts slow the first reply.
_LIVE_DOC_CHARS_PER_FILE = 6_000
_LIVE_DOC_CHARS_TOTAL = 20_000


def _build_attached_documents_block(messages: list[dict[str, Any]]) -> str:
    """Surface text extracted from uploaded documents into the live prompt.

    Chat persists each upload's extracted text on the message's ``attachments``
    (``extracted_text``), not in ``content``. Without this, the voice tutor has
    no idea what the student uploaded. We include the most recent documents
    first, within a small character budget so the prompt stays responsive.
    """
    collected: list[str] = []
    total = 0
    seen: set[str] = set()

    for m in reversed(messages):
        attachments = m.get("attachments") or []
        if not isinstance(attachments, list):
            continue
        for att in attachments:
            if not isinstance(att, dict):
                continue
            text = str(att.get("extracted_text") or "").strip()
            if not text:
                continue
            name = str(att.get("filename") or "document").strip() or "document"
            key = f"{name}:{len(text)}"
            if key in seen:
                continue
            seen.add(key)

            if total >= _LIVE_DOC_CHARS_TOTAL:
                break
            budget = min(_LIVE_DOC_CHARS_PER_FILE, _LIVE_DOC_CHARS_TOTAL - total)
            snippet = text[:budget]
            if len(text) > budget:
                snippet += " …(truncated)"
            total += len(snippet)
            collected.append(f"--- {name} ---\n{snippet}")
        if total >= _LIVE_DOC_CHARS_TOTAL:
            break

    if not collected:
        return ""

    # Re-reverse so documents read oldest→newest, matching upload order.
    collected.reverse()
    return (
        "\nATTACHED DOCUMENTS (uploaded by the student in this chat — "
        "answer questions about them from this text; do not say you cannot see files):\n"
        + "\n\n".join(collected)
    )
