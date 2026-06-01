"""ScreenPipe integration (optional).

ScreenPipe (https://github.com/mediar-ai/screenpipe) is a local, always-on
screen/audio recorder that exposes an HTTP API (default http://localhost:3030)
for searching recently captured OCR text and audio transcriptions.

This package provides a small, fully fail-safe client used by the Gemini Live
voice tutor to bake *recent screen activity* into the ephemeral-token system
instruction at token-creation time. ScreenPipe is strictly optional: when it is
disabled, not installed, unreachable, or slow, every helper degrades to a no-op
(returns empty context / unhealthy status) and never raises into the caller.
"""

from aimtutor.services.screenpipe.client import (
    check_screenpipe_health,
    fetch_recent_screen_context,
)

__all__ = [
    "check_screenpipe_health",
    "fetch_recent_screen_context",
]
