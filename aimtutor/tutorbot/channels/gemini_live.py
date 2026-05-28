"""
Gemini Live channel for TutorBot.

Auto-discovered by the channel registry (pkgutil scan).
Provides browser-based real-time voice sessions powered by Gemini Live.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from aimtutor.tutorbot.bus.events import OutboundMessage
from aimtutor.tutorbot.bus.queue import MessageBus
from aimtutor.tutorbot.channels.base import BaseChannel


class GeminiLiveChannel(BaseChannel):
    """
    Browser-based real-time voice channel.

    Unlike Telegram / Discord channels (which manage long-running connections
    to third-party platforms), the GeminiLive channel is session-oriented:
    each browser voice session opens its own WebSocket to /api/v1/gemini-live/session.
    The channel's role here is to expose configuration and status to the TutorBot
    manager so it can be listed, started, and stopped consistently.

    The actual audio bridging is handled by the gemini_live API router.
    """

    name: str = "gemini_live"
    display_name: str = "Gemini Live Voice"

    def __init__(self, config: Any, bus: MessageBus) -> None:
        super().__init__(config, bus)
        self._voice: str = getattr(config, "voice", "Aoede")
        self._model: str = getattr(config, "model", "gemini-2.0-flash-live")
        self._language: str = getattr(config, "language", "en-US")
        self._enable_affective_dialog: bool = getattr(config, "enable_affective_dialog", False)

    async def start(self) -> None:
        import os
        if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            logger.warning(
                "GeminiLiveChannel: GEMINI_API_KEY not set. "
                "Voice sessions will return 503."
            )
            return
        self._running = True
        logger.info(
            "GeminiLiveChannel started — model={} voice={} language={}",
            self._model, self._voice, self._language,
        )

    async def stop(self) -> None:
        self._running = False
        logger.info("GeminiLiveChannel stopped")

    async def send(self, msg: OutboundMessage) -> None:
        # Voice responses are streamed directly via the API WebSocket;
        # outbound messages from the TutorBot agent are not applicable here.
        logger.debug("GeminiLiveChannel.send: outbound messages not supported in voice mode")

    @classmethod
    def default_config(cls) -> dict[str, Any]:
        return {
            "enabled": False,
            "voice": "Aoede",
            "model": "gemini-2.0-flash-live",
            "language": "en-US",
            "enable_affective_dialog": False,
            "allow_from": ["*"],
        }
