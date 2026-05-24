from __future__ import annotations

from aimtutor.core.agentic.client import build_completion_kwargs
from aimtutor.services.llm.model_params import (
    drop_unsupported_temperature,
    is_unsupported_temperature_error,
    supports_temperature,
)


def test_temperature_is_omitted_for_new_openai_reasoning_families() -> None:
    assert supports_temperature("gpt-5.3-chat-latest") is False
    assert supports_temperature("o3") is False
    assert supports_temperature("o4-mini") is False


def test_temperature_is_allowed_for_standard_chat_models() -> None:
    assert supports_temperature("gpt-4.1") is True
    assert supports_temperature("gpt-4o-mini") is True
    assert supports_temperature("gemini-2.5-flash") is True


def test_reasoning_effort_omits_temperature_for_any_model() -> None:
    assert supports_temperature("gpt-4.1", "high") is False
    assert supports_temperature("gemini-2.5-pro", "minimal") is False
    assert supports_temperature("gemini-2.5-pro", "none") is True


def test_drop_unsupported_temperature_returns_copy() -> None:
    original = {"temperature": 0.2, "stream": True}
    cleaned = drop_unsupported_temperature(original, model="gpt-5.3-chat-latest")

    assert cleaned == {"stream": True}
    assert original == {"temperature": 0.2, "stream": True}


def test_unsupported_temperature_error_detection() -> None:
    assert is_unsupported_temperature_error(
        "Unsupported value: 'temperature' does not support 0.2. Only the default is supported."
    )
    assert not is_unsupported_temperature_error("Unsupported response_format")


def test_agentic_completion_kwargs_are_model_compatible() -> None:
    kwargs = build_completion_kwargs(
        temperature=0.2,
        model="gpt-5.3-chat-latest",
        max_tokens=123,
        binding="openai",
    )

    assert "temperature" not in kwargs
    assert kwargs["max_completion_tokens"] == 123


def test_agentic_completion_kwargs_keep_temperature_when_supported() -> None:
    kwargs = build_completion_kwargs(
        temperature=0.2,
        model="gemini-2.5-flash",
        max_tokens=123,
        binding="gemini",
    )

    assert kwargs["temperature"] == 0.2
    assert kwargs["max_tokens"] == 123
