from __future__ import annotations

import pytest

from aimtutor.services.config.llm_model_sync import sync_llm_models


def _catalog() -> dict:
    return {
        "version": 1,
        "services": {
            "llm": {
                "active_profile_id": None,
                "active_model_id": None,
                "profiles": [
                    {
                        "id": "openai-profile",
                        "name": "OpenAI",
                        "binding": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "api_key": "sk-test",
                        "models": [{"id": "existing", "name": "Old", "model": "gpt-4o-mini"}],
                    },
                    {
                        "id": "gemini-profile",
                        "name": "Gemini",
                        "binding": "gemini",
                        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                        "api_key": "gemini-test",
                        "models": [],
                    },
                ],
            }
        },
    }


@pytest.mark.asyncio
async def test_sync_filters_non_chat_models_and_selects_best_default(monkeypatch) -> None:
    async def fake_fetch(profile: dict) -> list[str]:
        if profile["binding"] == "openai":
            return [
                "text-embedding-3-large",
                "gpt-realtime",
                "gpt-5.3-chat-latest",
                "gpt-4o-mini",
            ]
        return [
            "models/gemini-2.5-flash",
            "models/gemini-3.1-flash-live-preview",
            "models/gemini-2.5-computer-use-preview-10-2025",
            "models/gemini-2.5-pro",
        ]

    monkeypatch.setattr(
        "aimtutor.services.config.llm_model_sync._fetch_openai_compatible_models",
        fake_fetch,
    )

    result = await sync_llm_models(_catalog())
    profiles = result.catalog["services"]["llm"]["profiles"]
    openai_models = [model["model"] for model in profiles[0]["models"]]
    gemini_models = [model["model"] for model in profiles[1]["models"]]

    assert openai_models == ["gpt-5.3-chat-latest", "gpt-4o-mini"]
    assert gemini_models == ["gemini-2.5-pro", "gemini-2.5-flash"]
    assert result.synced_profiles == 2
    assert result.synced_models == 4
    assert result.active_profile_id == "openai-profile"
    assert result.active_model_id == profiles[0]["models"][0]["id"]


@pytest.mark.asyncio
async def test_sync_does_not_mutate_source_catalog(monkeypatch) -> None:
    async def fake_fetch(profile: dict) -> list[str]:
        return ["gpt-5.3-chat-latest"] if profile["binding"] == "openai" else ["gemini-2.5-pro"]

    monkeypatch.setattr(
        "aimtutor.services.config.llm_model_sync._fetch_openai_compatible_models",
        fake_fetch,
    )
    catalog = _catalog()

    await sync_llm_models(catalog)

    assert catalog["services"]["llm"]["active_model_id"] is None
    assert catalog["services"]["llm"]["profiles"][0]["models"] == [
        {"id": "existing", "name": "Old", "model": "gpt-4o-mini"}
    ]
