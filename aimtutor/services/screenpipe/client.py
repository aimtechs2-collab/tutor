"""Fail-safe HTTP client for a locally running ScreenPipe instance.

Design contract (do not weaken):

* **Never raise into the caller.** Any error — disabled, bad URL, connection
  refused, timeout, non-200 (incl. 403 when an API key is required), malformed
  JSON — resolves to an empty string (for context) or an ``unhealthy`` status
  dict (for health). The Gemini Live token endpoint depends on this so a
  missing/slow ScreenPipe can never break or noticeably stall a voice session.
* **Short timeouts.** ScreenPipe runs on localhost; if it is not answering
  quickly we would rather ship the token without screen context than wait.
* **Bounded output.** Text is concatenated newest-first and truncated to a
  character budget consistent with the live-prompt document budget so the
  constrained ephemeral-token config stays small and the first reply stays fast.

API notes (https://docs.screenpi.pe):
* ``GET /search`` returns ``{"data": [{"type": <OCR|Audio|UI|...>,
  "content": {...}}], "pagination": {...}}``.
* Screen text is primarily captured via the accessibility tree
  (``content_type=accessibility``); ``ocr`` is a fallback for apps without it.
  Audio rows expose ``content.transcription`` and ``content.speaker.name``.
* Newer builds require ``Authorization: Bearer <SCREENPIPE_LOCAL_API_KEY>`` on
  ``/search`` (403 otherwise). ``/health`` never needs auth.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Defaults mirror the live-prompt document budgets in gemini_live.py so the
# combined system instruction stays within Gemini Live's constrained-token cap.
DEFAULT_WINDOW_MINUTES = 10
DEFAULT_LIMIT = 50
DEFAULT_CHAR_BUDGET = 6_000
DEFAULT_TIMEOUT = 1.5

# Screen-text result types we surface. ScreenPipe labels accessibility-tree text
# as "OCR" in some builds, so we accept the obvious screen variants.
_SCREEN_TYPES = {"ocr", "ui", "accessibility"}
_AUDIO_TYPES = {"audio"}


def _normalize_base_url(base_url: str | None) -> str:
    url = (base_url or "").strip().rstrip("/")
    return url or "http://localhost:3030"


def _auth_headers(api_key: str | None) -> dict[str, str]:
    key = (api_key or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _coerce_records(payload: Any) -> list[dict[str, Any]]:
    """Pull the result rows out of a ScreenPipe ``/search`` response.

    The shape has shifted across ScreenPipe versions (usually ``{"data": [...]}``,
    occasionally a bare list). We accept either and ignore anything else.
    """
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        return []
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def _is_excluded(app_name: str, window_name: str, exclude: list[str]) -> bool:
    """Case-insensitive substring match of an exclusion term against app/window."""
    if not exclude:
        return False
    haystack = f"{app_name}\n{window_name}".lower()
    return any(term and term.lower() in haystack for term in exclude)


def _extract_entry(
    row: dict[str, Any],
    *,
    include_audio: bool,
    exclude: list[str],
) -> tuple[str, str] | None:
    """Return ``(label, text)`` for one row, or ``None`` to skip it.

    Skips: non-screen/non-audio rows (e.g. ``input`` keystrokes/clipboard),
    empty text, and anything matching the exclusion list.
    """
    row_type = str(row.get("type") or "").strip().lower()
    content = row.get("content")
    container = content if isinstance(content, dict) else row

    app_name = str(container.get("app_name") or "").strip()
    window_name = str(container.get("window_name") or "").strip()

    if row_type in _SCREEN_TYPES:
        text = str(container.get("text") or "").strip()
        if not text:
            return None
        if _is_excluded(app_name, window_name, exclude):
            return None
        parts = [p for p in (app_name, window_name) if p]
        label = " · ".join(parts) if parts else "screen"
        return label, text

    if include_audio and row_type in _AUDIO_TYPES:
        text = str(container.get("transcription") or container.get("text") or "").strip()
        if not text:
            return None
        speaker_obj = container.get("speaker")
        speaker = ""
        if isinstance(speaker_obj, dict):
            speaker = str(speaker_obj.get("name") or "").strip()
        label = f"audio · {speaker}" if speaker else "audio"
        return label, text

    # input / memory / unknown → skip (keystrokes & clipboard are sensitive).
    return None


async def fetch_recent_screen_context(
    *,
    base_url: str | None,
    api_key: str | None = None,
    window_minutes: int = DEFAULT_WINDOW_MINUTES,
    limit: int = DEFAULT_LIMIT,
    char_budget: int = DEFAULT_CHAR_BUDGET,
    timeout: float = DEFAULT_TIMEOUT,
    include_audio: bool = False,
    exclude: list[str] | None = None,
    query: str | None = None,
    focused: bool = False,
) -> str:
    """Fetch recent on-screen text (and optionally audio) from ScreenPipe.

    Returns an empty string on any failure or when there is nothing recent.
    The result is ordered oldest→newest (so it reads chronologically) and
    truncated to ``char_budget`` characters. Rows whose app/window match an
    entry in ``exclude`` are dropped for privacy, as are keyboard/clipboard
    (``input``) rows.

    ``query`` maps to ScreenPipe's full-text ``q`` filter (use for on-demand
    "what's on my screen" lookups). ``focused`` restricts results to the
    currently focused window — useful for a live, point-in-time snapshot.
    """
    url = _normalize_base_url(base_url)
    exclude = [e for e in (exclude or []) if str(e).strip()]

    try:
        import httpx
    except Exception:  # pragma: no cover - httpx is a core dependency
        logger.debug("screenpipe: httpx unavailable; skipping screen context")
        return ""

    now = datetime.datetime.now(tz=datetime.timezone.utc)
    start = now - datetime.timedelta(minutes=max(1, window_minutes))
    # When audio is requested we need "all" (screen + audio); otherwise the
    # accessibility tree is the richest source of screen text.
    content_type = "all" if include_audio else "accessibility"
    params: dict[str, Any] = {
        "content_type": content_type,
        "limit": max(1, min(limit, 100)),
        "start_time": start.isoformat(),
        "end_time": now.isoformat(),
    }
    if query and str(query).strip():
        params["q"] = str(query).strip()
    if focused:
        params["focused"] = "true"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{url}/search", params=params, headers=_auth_headers(api_key)
            )
        if resp.status_code != 200:
            logger.debug("screenpipe: /search returned %s", resp.status_code)
            return ""
        payload = resp.json()
    except Exception as exc:
        logger.debug("screenpipe: context fetch failed (%s)", exc)
        return ""

    rows = _coerce_records(payload)
    if not rows:
        return ""

    # ScreenPipe returns newest-first; collect within budget, then reverse so
    # the prompt reads chronologically (older context first).
    collected: list[str] = []
    seen: set[str] = set()
    total = 0
    for row in rows:
        entry = _extract_entry(row, include_audio=include_audio, exclude=exclude)
        if not entry:
            continue
        label, text = entry
        dedup_key = f"{label}:{text[:120]}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        if total >= char_budget:
            break
        budget = char_budget - total
        snippet = text[:budget]
        if len(text) > budget:
            snippet += " …(truncated)"
        total += len(snippet)
        collected.append(f"[{label}] {snippet}")

    if not collected:
        return ""

    collected.reverse()
    return "\n".join(collected)


async def check_screenpipe_health(
    base_url: str | None,
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Probe ScreenPipe's ``/health`` endpoint (no auth required).

    Returns ``{"reachable": bool, "status": str, "url": str}``. Never raises.
    """
    url = _normalize_base_url(base_url)
    result: dict[str, Any] = {"reachable": False, "status": "unreachable", "url": url}

    try:
        import httpx
    except Exception:  # pragma: no cover - httpx is a core dependency
        result["status"] = "httpx unavailable"
        return result

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/health")
        if resp.status_code == 200:
            result["reachable"] = True
            try:
                body = resp.json()
                if isinstance(body, dict):
                    result["status"] = str(body.get("status") or "ok")
                else:
                    result["status"] = "ok"
            except Exception:
                result["status"] = "ok"
        else:
            result["status"] = f"http {resp.status_code}"
    except Exception as exc:
        logger.debug("screenpipe: health check failed (%s)", exc)
        result["status"] = "unreachable"

    return result
