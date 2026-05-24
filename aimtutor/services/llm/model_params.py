"""Shared model-parameter compatibility helpers.

OpenAI-compatible providers do not all accept the same request parameters.
Keep these rules centralized so agent pipelines, legacy providers, and
TutorBot do not drift.
"""

from __future__ import annotations

from typing import Any

_NO_TEMPERATURE_MODEL_MARKERS = ("gpt-5", "o1", "o3", "o4")


def supports_temperature(model: str | None, reasoning_effort: str | None = None) -> bool:
    """Return whether a request should include a non-default temperature."""
    if reasoning_effort and reasoning_effort.lower() != "none":
        return False
    model_lower = (model or "").lower()
    return not any(marker in model_lower for marker in _NO_TEMPERATURE_MODEL_MARKERS)


def drop_unsupported_temperature(
    kwargs: dict[str, Any],
    *,
    model: str | None,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    """Return a copy with ``temperature`` removed when the model rejects it."""
    if supports_temperature(model, reasoning_effort):
        return dict(kwargs)
    cleaned = dict(kwargs)
    cleaned.pop("temperature", None)
    return cleaned


def is_unsupported_temperature_error(error: BaseException | str) -> bool:
    """Detect provider errors caused by an unsupported temperature parameter."""
    if isinstance(error, BaseException):
        response = getattr(error, "response", None)
        body = (
            getattr(error, "body", None)
            or getattr(error, "doc", None)
            or getattr(response, "text", None)
            or getattr(error, "message", None)
            or str(error)
        )
    else:
        body = error
    text = str(body or "").lower()
    return "temperature" in text and (
        "unsupported" in text
        or "only the default" in text
        or "does not support" in text
    )


__all__ = [
    "drop_unsupported_temperature",
    "is_unsupported_temperature_error",
    "supports_temperature",
]
