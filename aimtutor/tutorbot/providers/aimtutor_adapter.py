"""LLM provider adapter that reuses AIMTutor's LLM configuration.

When TutorBot runs in-process inside the AIMTutor server, this provider
reads api_key / model / base_url from AIMTutor's unified config and
delegates to the appropriate provider (OpenAICompat or Anthropic).
"""

from __future__ import annotations

from typing import cast

from aimtutor.services.llm.config import LLMConfig
from aimtutor.tutorbot.providers.base import LLMProvider


def create_aimtutor_provider(config: LLMConfig | None = None) -> LLMProvider:
    """Build a provider pre-configured from AIMTutor's LLMConfig."""
    from aimtutor.services.llm.provider_factory import get_runtime_provider

    return cast(LLMProvider, get_runtime_provider(config))
