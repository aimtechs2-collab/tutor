from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from aimtutor.core.agentic.labeled_step import run_labeled_step
from aimtutor.core.stream_bus import StreamBus


async def _async_stream(chunks: list[SimpleNamespace]):
    for chunk in chunks:
        yield chunk


class _RecordingClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

        class _Completions:
            def __init__(self, parent: _RecordingClient) -> None:
                self.parent = parent

            async def create(self, **kwargs: Any):
                self.parent.calls.append(kwargs)
                return _async_stream(
                    [
                        SimpleNamespace(
                            choices=[
                                SimpleNamespace(
                                    delta=SimpleNamespace(content="``FINISH`` done", tool_calls=None)
                                )
                            ],
                            usage=None,
                        )
                    ]
                )

        class _Chat:
            def __init__(self, parent: _RecordingClient) -> None:
                self.completions = _Completions(parent)

        self.chat = _Chat(self)


@pytest.mark.asyncio
async def test_labeled_step_omits_temperature_for_gpt5_models() -> None:
    client = _RecordingClient()
    bus = StreamBus()

    result = await run_labeled_step(
        client=client,
        model="gpt-5.3-chat-latest",
        messages=[{"role": "user", "content": "hi"}],
        completion_kwargs={"temperature": 0.2, "max_completion_tokens": 64},
        tool_schemas=None,
        allowed_labels=("FINISH", "THINK"),
        final_labels=frozenset({"FINISH"}),
        tool_label=None,
        stream=bus,
        source="test",
        stage="test",
        iter_meta={"trace_id": "t1", "label": "Reasoning"},
        binding="openai",
    )

    await bus.close()

    assert result.label == "FINISH"
    assert client.calls
    assert "temperature" not in client.calls[0]
    assert client.calls[0]["max_completion_tokens"] == 64
