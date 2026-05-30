"""
Tests for Gemini Live router — pure unit tests.

All heavy app dependencies (psycopg2, pydantic_settings, etc.) are mocked
at sys.modules level before any aimtutor import so tests run without a
database or the full environment.
"""
from __future__ import annotations

import asyncio
import sys
import time
import types
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Mock the entire aimtutor dependency tree before any import ────────────

def _make_module(name: str) -> types.ModuleType:
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


# Stub out everything that pulls in psycopg2 / pydantic_settings / etc.
for _mod in [
    "aimtutor.api.routers.auth",
    "aimtutor.services.session",
    "aimtutor.services.memory",
    "aimtutor.services.memory.paths",
    "aimtutor.config",
    "aimtutor.config.settings",
    "psycopg2",
    "pydantic_settings",
    "loguru",
]:
    _make_module(_mod)

# auth stubs
_auth = sys.modules["aimtutor.api.routers.auth"]
_auth.require_auth = lambda: None
_auth.require_admin = lambda: None
_auth.ws_require_auth = None
_auth.ws_auth_failed = None

# session stub
_sess = sys.modules["aimtutor.services.session"]
_sess.get_session_store = MagicMock()

# memory paths stub
_mem = sys.modules["aimtutor.services.memory.paths"]
_mem.memory_root = MagicMock(return_value=MagicMock())

# loguru stub
_log = sys.modules["loguru"]
_log.logger = MagicMock()

# ── Now safe to import the module under test ──────────────────────────────

from aimtutor.api.routers import gemini_live as gl  # noqa: E402


# ── fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")


# ── _get_api_key ──────────────────────────────────────────────────────────

def test_api_key_from_gemini_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gkey")
    assert gl._get_api_key() == "gkey"


def test_api_key_fallback_google_env(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "goog")
    assert gl._get_api_key() == "goog"


def test_api_key_missing(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert gl._get_api_key() is None


# ── rate limiter ──────────────────────────────────────────────────────────

def test_rate_ok_allows_within_limit():
    key = f"test-{uuid.uuid4()}"
    for _ in range(5):
        assert gl._rate_check(key, max_calls=10, window=60.0) is True


def test_rate_ok_blocks_over_limit():
    key = f"test-{uuid.uuid4()}"
    for _ in range(10):
        gl._rate_check(key, max_calls=10, window=60.0)
    assert gl._rate_check(key, max_calls=10, window=60.0) is False


def test_rate_ok_resets_after_window():
    key = f"test-{uuid.uuid4()}"
    # Fill the bucket with old timestamps
    gl._rate_buckets[key] = [time.monotonic() - 120] * 10
    assert gl._rate_check(key, max_calls=10, window=60.0) is True


# ── token registry cleanup ────────────────────────────────────────────────

def test_clean_removes_expired():
    token = str(uuid.uuid4())
    gl._token_registry[token] = {"user_id": "u1", "ts": time.time() - 400}
    gl._clean_expired_tokens()
    assert token not in gl._token_registry


def test_clean_keeps_fresh():
    token = str(uuid.uuid4())
    gl._token_registry[token] = {"user_id": "u1", "ts": time.time()}
    gl._clean_expired_tokens()
    assert token in gl._token_registry
    del gl._token_registry[token]


# ── config endpoint ───────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_config_enabled():
    result = await gl.get_config()
    assert result["enabled"] is True
    assert len(result["voices"]) > 0
    assert len(result["models"]) >= 1


@pytest.mark.anyio
async def test_config_disabled(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    result = await gl.get_config()
    assert result["enabled"] is False


# ── token endpoint ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_token_no_key_returns_503(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = MagicMock(); payload.user_id = "u1"
    with pytest.raises(HTTPException) as exc:
        await gl.create_token(gl.TokenRequest(), payload)
    assert exc.value.status_code == 503


@pytest.mark.anyio
async def test_create_token_rate_limited_returns_429():
    from fastapi import HTTPException
    uid = f"rl-{uuid.uuid4()}"
    payload = MagicMock(); payload.user_id = uid
    # Exhaust the bucket
    gl._rate_buckets[uid] = [time.monotonic()] * 10
    with pytest.raises(HTTPException) as exc:
        await gl.create_token(gl.TokenRequest(), payload)
    assert exc.value.status_code == 429


@pytest.mark.anyio
@pytest.mark.anyio
async def test_create_token_success():
    uid = f"user-{uuid.uuid4()}"
    payload = MagicMock(); payload.user_id = uid
    mock_models = [{"id": "gemini-2.5-flash-native-audio-latest", "display_name": "Test", "affective_dialog": False}]
    with patch("aimtutor.api.routers.gemini_live._live_models", AsyncMock(return_value=mock_models)):
        result = await gl.create_token(
            gl.TokenRequest(model="gemini-2.5-flash-native-audio-latest"), payload
        )
    import hashlib
    assert "token" in result
    assert "expires_at" in result
    token_hash = hashlib.sha256(result["token"].encode()).hexdigest()
    assert token_hash in gl._token_registry
    del gl._token_registry[token_hash]


@pytest.mark.anyio
async def test_create_token_invalid_model_rejected():
    """Codex version raises 400 for invalid models (no longer silently defaults)."""
    uid = f"user-{uuid.uuid4()}"
    payload = MagicMock(); payload.user_id = uid
    from fastapi import HTTPException
    mock_models = [{"id": "gemini-2.5-flash-native-audio-latest", "display_name": "T", "affective_dialog": False}]
    with patch("aimtutor.api.routers.gemini_live._live_models", AsyncMock(return_value=mock_models)):
        with pytest.raises(HTTPException) as exc:
            await gl.create_token(gl.TokenRequest(model="invalid-xyz"), payload)
        assert exc.value.status_code == 400


# ── tool declarations ─────────────────────────────────────────────────────

def test_tool_declarations_with_kb():
    tools = gl._build_tool_declarations(kb_name="my-kb")
    decl_names = [d["name"] for t in tools for d in t.get("function_declarations", [])]
    assert "search_knowledge_base" in decl_names
    assert "web_search" in decl_names


def test_tool_declarations_without_kb():
    tools = gl._build_tool_declarations(kb_name=None)
    decl_names = [d["name"] for t in tools for d in t.get("function_declarations", [])]
    assert "search_knowledge_base" not in decl_names
    assert "web_search" in decl_names


# ── tool dispatch ─────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_dispatch_unknown_tool():
    result = await gl._dispatch_tool("nonexistent", {}, None)
    assert "not available" in result


@pytest.mark.anyio
async def test_dispatch_kb_without_kb_name():
    result = await gl._dispatch_tool("search_knowledge_base", {"query": "x"}, None)
    assert "not available" in result


@pytest.mark.anyio
async def test_dispatch_web_search_success():
    mock_result = MagicMock()
    mock_result.results = [
        MagicMock(title="Result", url="http://x.com", snippet="snippet")
    ]
    # Patch asyncio.to_thread so the sync web_search never actually imports
    with patch("asyncio.to_thread", AsyncMock(return_value=mock_result)):
        result = await gl._dispatch_tool("web_search", {"query": "python"}, None)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.anyio
async def test_dispatch_web_search_exception():
    with patch("asyncio.to_thread", AsyncMock(side_effect=Exception("network error"))):
        result = await gl._dispatch_tool("web_search", {"query": "python"}, None)
    assert "failed" in result.lower()
