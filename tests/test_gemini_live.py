"""Tests for the Gemini Live voice router."""
from __future__ import annotations

import json
import os
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def set_gemini_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")


@pytest.fixture()
def router():
    from aimtutor.api.routers import gemini_live
    return gemini_live


# ── _get_api_key ──────────────────────────────────────────────────────────

def test_get_api_key_from_env(router, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "my-key")
    assert router._get_api_key() == "my-key"


def test_get_api_key_fallback(router, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "goog-key")
    assert router._get_api_key() == "goog-key"


def test_get_api_key_missing(router, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert router._get_api_key() is None


# ── rate limiter ──────────────────────────────────────────────────────────

def test_rate_ok_allows_calls(router):
    key = f"test-{uuid.uuid4()}"
    for _ in range(5):
        assert router._rate_ok(key, max_calls=10, window=60.0) is True


def test_rate_ok_blocks_over_limit(router):
    key = f"test-{uuid.uuid4()}"
    for _ in range(10):
        router._rate_ok(key, max_calls=10, window=60.0)
    assert router._rate_ok(key, max_calls=10, window=60.0) is False


# ── token registry ────────────────────────────────────────────────────────

def test_clean_expired_tokens_removes_old(router):
    token = str(uuid.uuid4())
    router._token_registry[token] = {"user_id": "u1", "ts": time.time() - 400}
    router._clean_expired_tokens()
    assert token not in router._token_registry


def test_clean_expired_tokens_keeps_fresh(router):
    token = str(uuid.uuid4())
    router._token_registry[token] = {"user_id": "u1", "ts": time.time()}
    router._clean_expired_tokens()
    assert token in router._token_registry
    del router._token_registry[token]


# ── config endpoint ───────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_config_enabled(router):
    result = await router.get_config()
    assert result["enabled"] is True
    assert len(result["voices"]) > 0
    assert len(result["models"]) > 0


@pytest.mark.anyio
async def test_config_disabled(router, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    result = await router.get_config()
    assert result["enabled"] is False


# ── token endpoint ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_token_no_key(router, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    mock_payload = MagicMock()
    mock_payload.user_id = "u1"
    with pytest.raises(HTTPException) as exc_info:
        await router.create_token(router.TokenRequest(), mock_payload)
    assert exc_info.value.status_code == 503


@pytest.mark.anyio
async def test_create_token_rate_limited(router, monkeypatch):
    from fastapi import HTTPException
    mock_payload = MagicMock()
    mock_payload.user_id = f"rl-{uuid.uuid4()}"
    # Exhaust rate limit
    for _ in range(10):
        router._rate_ok(str(mock_payload.user_id))
    with pytest.raises(HTTPException) as exc_info:
        await router.create_token(router.TokenRequest(), mock_payload)
    assert exc_info.value.status_code == 429


@pytest.mark.anyio
async def test_create_token_success(router):
    mock_payload = MagicMock()
    mock_payload.user_id = f"user-{uuid.uuid4()}"
    result = await router.create_token(router.TokenRequest(), mock_payload)
    assert "token" in result
    assert "expires_at" in result
    assert result["model"] == "gemini-2.0-flash-live-001"
    # Token should be in registry
    assert result["token"] in router._token_registry
    # Cleanup
    del router._token_registry[result["token"]]


# ── tool dispatch ─────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_dispatch_unknown_tool(router):
    result = await router._dispatch_tool("nonexistent_tool", {}, None)
    assert "not available" in result


@pytest.mark.anyio
async def test_dispatch_web_search_success(router):
    mock_result = MagicMock()
    mock_result.results = [
        MagicMock(title="Test", url="http://example.com", snippet="A snippet")
    ]
    with patch("aimtutor.tools.web_search.web_search", return_value=mock_result):
        result = await router._dispatch_tool("web_search", {"query": "test"}, None)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.anyio
async def test_dispatch_kb_search_no_kb(router):
    # When kb_name is None, kb search should say not available
    result = await router._dispatch_tool("search_knowledge_base", {"query": "x"}, None)
    assert "not available" in result
