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

# --- In-app guidance (Gemini Live function calling) ----------------------------
# The live tutor can drive the AIMTutor web app: navigate pages, spotlight a
# control, or click a whitelisted control. These enums MUST stay in sync with
# web/lib/gemini/tutor-guidance.ts (TUTOR_PAGES / TUTOR_TARGETS). The browser
# executes the calls and replies; nothing here touches the OS.
TUTOR_NAV_PAGES = [
    "chat",
    "history",
    "knowledge",
    "notebook",
    "question",
    "solver",
    "research",
    "co_writer",
    "settings",
]
TUTOR_UI_TARGETS = [
    "composer.input",
    "composer.send",
    "composer.attach",
    "composer.capabilities",
    "composer.knowledge",
    "composer.space",
    "composer.voice",
]

TUTOR_UI_FUNCTION_DECLARATIONS = [
    {
        "name": "navigate_to",
        "description": (
            "Open a page of the AIMTutor app on the student's screen so they can "
            "follow along while you explain. Use this when guiding the student to "
            "a feature."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "string",
                    "enum": TUTOR_NAV_PAGES,
                    "description": "Which app page to open.",
                }
            },
            "required": ["page"],
        },
    },
    {
        "name": "highlight_element",
        "description": (
            "Spotlight a control on the student's screen and point to it while you "
            "describe what it does. Prefer this over clicking so the student stays "
            "in control."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": TUTOR_UI_TARGETS,
                    "description": "Which control to spotlight.",
                },
                "note": {
                    "type": "string",
                    "description": "A short caption (≤6 words) shown beside the spotlight.",
                },
            },
            "required": ["target"],
        },
    },
    {
        "name": "click_element",
        "description": (
            "Click a control for the student (e.g. open a menu) when they ask you "
            "to do it for them. Use sparingly; highlighting is usually better."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": TUTOR_UI_TARGETS,
                    "description": "Which control to click.",
                }
            },
            "required": ["target"],
        },
    },
    {
        "name": "clear_guidance",
        "description": "Remove any on-screen spotlight or pointer you previously showed.",
        "parameters": {"type": "object", "properties": {}},
    },
]

# Declared only when ScreenPipe is enabled. Lets the tutor read the student's
# CURRENT screen on demand mid-conversation (ScreenPipe full-text search),
# which the start-of-session token snapshot cannot do.
LOOK_AT_SCREEN_DECLARATION = {
    "name": "look_at_screen",
    "description": (
        "Read what is on the student's screen right now using ScreenPipe (their "
        "local screen recorder). Call this when the student asks about what they "
        "are looking at, references something on their screen, or when you need "
        "fresh on-screen context during the conversation. Returns recent on-screen "
        "text; may be empty if ScreenPipe has nothing recent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Optional keywords to look for on screen (e.g. an error "
                    "message or heading). Omit for a general recent snapshot."
                ),
            }
        },
    },
}

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


def _screenpipe_settings() -> dict[str, Any]:
    """Read the ScreenPipe integration toggle + URL from runtime settings.

    Fully defensive: any failure resolves to a disabled default so the live
    voice flow is never affected by a settings read error.
    """
    try:
        from aimtutor.services.config.runtime_settings import load_integrations_settings

        integrations = load_integrations_settings()
        exclude = integrations.get("screenpipe_exclude") or []
        return {
            "enabled": bool(integrations.get("screenpipe_enabled", False)),
            "url": str(integrations.get("screenpipe_url") or "http://localhost:3030"),
            "api_key": str(integrations.get("screenpipe_api_key") or ""),
            "window_minutes": int(integrations.get("screenpipe_window_minutes") or 10),
            "include_audio": bool(integrations.get("screenpipe_include_audio", False)),
            "exclude": list(exclude) if isinstance(exclude, list) else [],
        }
    except Exception as exc:
        logger.debug("gemini_live: failed to read screenpipe settings (%s)", exc)
        return {
            "enabled": False,
            "url": "http://localhost:3030",
            "api_key": "",
            "window_minutes": 10,
            "include_audio": False,
            "exclude": [],
        }


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
    # ScreenPipe opt-in for this session. ``None`` means "follow the server
    # setting" (the integrations toggle is the master switch); ``False`` lets a
    # client explicitly opt out even when the server setting is enabled.
    screenpipe: bool | None = None


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
        "screenpipe_enabled": _screenpipe_settings()["enabled"],
    }


class ScreenPipeSettingsUpdate(BaseModel):
    enabled: bool | None = None
    url: str | None = None
    # Write-only: blank string clears the saved key; ``None`` leaves it intact.
    api_key: str | None = None
    window_minutes: int | None = None
    include_audio: bool | None = None
    exclude: list[str] | None = None


def _public_screenpipe_settings() -> dict[str, Any]:
    """ScreenPipe settings with the API key redacted to a boolean flag."""
    s = _screenpipe_settings()
    return {
        "enabled": s["enabled"],
        "url": s["url"],
        "api_key_set": bool(s.get("api_key")),
        "window_minutes": s["window_minutes"],
        "include_audio": s["include_audio"],
        "exclude": s["exclude"],
    }


def _require_screenpipe_admin() -> None:
    """Integrations settings are global; only admins may change them.

    In single-user deployments ``is_admin`` is always true, so this is a no-op
    there and only meaningfully gates shared multi-user backends.
    """
    try:
        from aimtutor.multi_user.context import get_current_user

        if not get_current_user().is_admin:
            raise HTTPException(403, "ScreenPipe settings are managed by an administrator.")
    except HTTPException:
        raise
    except Exception:
        # No multi-user context (e.g. SDK/CLI) → treat as permitted.
        return


@router.get("/screenpipe/settings")
async def get_screenpipe_settings(payload=Depends(require_auth)) -> dict[str, Any]:
    """Return the current ScreenPipe settings (API key redacted)."""
    return _public_screenpipe_settings()


@router.put("/screenpipe/settings")
async def update_screenpipe_settings(
    body: ScreenPipeSettingsUpdate,
    payload=Depends(require_auth),
) -> dict[str, Any]:
    """Persist ScreenPipe settings to runtime settings (admin only)."""
    _require_screenpipe_admin()
    from aimtutor.services.config.runtime_settings import (
        get_runtime_settings_service,
    )

    service = get_runtime_settings_service()
    current = service.load_integrations()
    if body.enabled is not None:
        current["screenpipe_enabled"] = bool(body.enabled)
    if body.url is not None:
        current["screenpipe_url"] = body.url
    if body.api_key is not None:
        current["screenpipe_api_key"] = body.api_key
    if body.window_minutes is not None:
        current["screenpipe_window_minutes"] = body.window_minutes
    if body.include_audio is not None:
        current["screenpipe_include_audio"] = bool(body.include_audio)
    if body.exclude is not None:
        current["screenpipe_exclude"] = body.exclude
    service.save_integrations(current)
    return _public_screenpipe_settings()


class ScreenContextRequest(BaseModel):
    query: str | None = None


@router.post("/screenpipe/context")
async def screenpipe_context(
    body: ScreenContextRequest | None = None,
    payload=Depends(require_auth),
) -> dict[str, Any]:
    """Live, on-demand screen read for the tutor's ``look_at_screen`` function.

    Pulls a short, fresh ScreenPipe snapshot (focused window first). Always
    returns ``{"text": ...}``; empty when ScreenPipe is disabled/unreachable.
    """
    settings = _screenpipe_settings()
    if not settings["enabled"]:
        return {"text": ""}

    from aimtutor.services.screenpipe import fetch_recent_screen_context

    try:
        text = await fetch_recent_screen_context(
            base_url=settings["url"],
            api_key=settings.get("api_key") or None,
            # "Right now" → short window; cap to whatever the admin allows.
            window_minutes=min(int(settings.get("window_minutes") or 10), 5),
            include_audio=bool(settings.get("include_audio")),
            exclude=settings.get("exclude") or [],
            query=(body.query if body else None),
            focused=True,
        )
    except Exception as exc:
        logger.debug("gemini_live: look_at_screen failed (%s)", exc)
        text = ""
    return {"text": text}


@router.post("/screenpipe/test")
async def test_screenpipe(
    body: ScreenPipeSettingsUpdate | None = None,
    payload=Depends(require_auth),
) -> dict[str, Any]:
    """Probe a ScreenPipe instance for reachability (uses saved URL if none given)."""
    from aimtutor.services.screenpipe import check_screenpipe_health

    url = (body.url if body else None) or _screenpipe_settings()["url"]
    return await check_screenpipe_health(url)


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

    model = _pinned_live_model()
    system_instruction = await _build_system_instruction(
        body.session_id, user_id, screenpipe=body.screenpipe
    )
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


def _live_ui_guidance_enabled() -> bool:
    """Whether the live tutor may drive the app via function calls (default on).

    Set ``GEMINI_LIVE_UI_GUIDANCE=false`` to disable if a deployment's
    constrained-token config rejects function declarations.
    """
    _load_env()
    return os.environ.get("GEMINI_LIVE_UI_GUIDANCE", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
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
        tools: list[dict[str, Any]] = []
        if _live_google_search_enabled():
            tools.append({"google_search": {}})
        declarations: list[dict[str, Any]] = []
        if _live_ui_guidance_enabled():
            declarations.extend(TUTOR_UI_FUNCTION_DECLARATIONS)
        if _screenpipe_settings()["enabled"]:
            declarations.append(LOOK_AT_SCREEN_DECLARATION)
        if declarations:
            tools.append({"function_declarations": declarations})
        if tools:
            live_config["tools"] = tools

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
    *,
    screenpipe: bool | None = None,
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

    if _live_ui_guidance_enabled():
        lines += [
            "",
            "GUIDING THE APP (function calling):",
            "You can drive the AIMTutor web app for the student using these functions: "
            "navigate_to(page), highlight_element(target, note), click_element(target), "
            "and clear_guidance().",
            "Pages you can open: " + ", ".join(TUTOR_NAV_PAGES) + ".",
            "Controls you can spotlight or click: " + ", ".join(TUTOR_UI_TARGETS) + ".",
            "When you teach the student how to do something in the app, prefer "
            "highlight_element to point at the right control while you explain it, and "
            "navigate_to to take them to the right page. Use click_element only when the "
            "student explicitly asks you to do it for them. Keep narrating naturally — "
            "say what you are pointing at as you call the function. Call clear_guidance "
            "when you are done pointing. Only ever reference the exact page and target "
            "names listed above; never invent new ones.",
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

    screen_block = await _build_screenpipe_block(screenpipe)
    if screen_block:
        lines.append(screen_block)

    if screenpipe is not False and _screenpipe_settings()["enabled"]:
        lines += [
            "",
            "LIVE SCREEN (ScreenPipe):",
            "You can call look_at_screen(query) at any time to read what is on the "
            "student's screen right now. Use it when they ask about what they are "
            "seeing, mention something on their screen, or you need fresh context — "
            "do not guess. Pass keywords in query to find something specific.",
        ]

    return "\n".join(lines)


async def _build_screenpipe_block(screenpipe: bool | None) -> str:
    """Build the recent-screen-activity block from ScreenPipe, if enabled.

    The integrations toggle is the master switch. A client may additionally opt
    out by sending ``screenpipe=False``. Any failure (disabled, unreachable,
    timeout, empty) returns ``""`` and never breaks token creation.
    """
    if screenpipe is False:
        return ""

    settings = _screenpipe_settings()
    if not settings["enabled"]:
        return ""

    try:
        from aimtutor.services.screenpipe import fetch_recent_screen_context

        text = await fetch_recent_screen_context(
            base_url=settings["url"],
            api_key=settings.get("api_key") or None,
            window_minutes=int(settings.get("window_minutes") or 10),
            include_audio=bool(settings.get("include_audio")),
            exclude=settings.get("exclude") or [],
        )
    except Exception as exc:
        logger.debug("gemini_live: screenpipe context unavailable (%s)", exc)
        return ""

    if not text:
        return ""

    return (
        "\nRECENT SCREEN ACTIVITY (from ScreenPipe — background OCR of what the "
        "student was recently looking at across their apps; may be noisy or "
        "out of date, so use it only as soft context and rely on the live "
        "screen/camera frames for anything you need to read precisely):\n"
        + text
    )


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
