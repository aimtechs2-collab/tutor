"""Unit tests for the fail-safe ScreenPipe client.

These exercise the parsing/budget/privacy logic and, crucially, that *every*
failure path degrades to an empty string / unhealthy status rather than raising
into the Gemini Live token endpoint.
"""

from __future__ import annotations

from typing import Any

import pytest

from aimtutor.services.screenpipe import client as sp


# ---------------------------------------------------------------------------
# Stub httpx plumbing
# ---------------------------------------------------------------------------


class _StubResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Any:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _StubAsyncClient:
    """Mimics ``httpx.AsyncClient`` as an async context manager."""

    def __init__(self, *, response: Any = None, raise_on_get: Exception | None = None):
        self._response = response
        self._raise = raise_on_get
        self.last_headers: dict[str, str] | None = None
        self.last_params: dict[str, Any] | None = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params=None, headers=None):
        self.last_params = params
        self.last_headers = headers
        if self._raise is not None:
            raise self._raise
        return self._response


def _patch_client(monkeypatch, stub: _StubAsyncClient) -> _StubAsyncClient:
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: stub)
    return stub


def _ocr_row(text: str, app: str = "Chrome", window: str = "Docs") -> dict[str, Any]:
    return {
        "type": "OCR",
        "content": {"text": text, "app_name": app, "window_name": window},
    }


def _audio_row(transcription: str, speaker: str = "John") -> dict[str, Any]:
    return {
        "type": "Audio",
        "content": {"transcription": transcription, "speaker": {"name": speaker}},
    }


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_coerce_records_accepts_dict_and_list() -> None:
    assert sp._coerce_records({"data": [{"a": 1}, "skip", {"b": 2}]}) == [{"a": 1}, {"b": 2}]
    assert sp._coerce_records([{"a": 1}, 3]) == [{"a": 1}]
    assert sp._coerce_records("nope") == []


def test_is_excluded_is_case_insensitive_substring() -> None:
    assert sp._is_excluded("1Password", "Vault", ["password"]) is True
    assert sp._is_excluded("Chrome", "Bank of America", ["bank"]) is True
    assert sp._is_excluded("Chrome", "Docs", ["slack"]) is False
    assert sp._is_excluded("Chrome", "Docs", []) is False


def test_extract_entry_skips_input_and_empty() -> None:
    assert sp._extract_entry(_ocr_row(""), include_audio=False, exclude=[]) is None
    assert (
        sp._extract_entry({"type": "Input", "content": {"text": "secret"}},
                          include_audio=True, exclude=[])
        is None
    )


def test_extract_entry_audio_requires_flag() -> None:
    row = _audio_row("hello there")
    assert sp._extract_entry(row, include_audio=False, exclude=[]) is None
    label, text = sp._extract_entry(row, include_audio=True, exclude=[])
    assert text == "hello there"
    assert "John" in label


# ---------------------------------------------------------------------------
# fetch_recent_screen_context — happy path & filtering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_orders_chronologically_and_labels(monkeypatch) -> None:
    # ScreenPipe returns newest-first; output should read oldest-first.
    payload = {"data": [_ocr_row("newest"), _ocr_row("oldest")]}
    _patch_client(monkeypatch, _StubAsyncClient(response=_StubResponse(200, payload)))

    out = await sp.fetch_recent_screen_context(base_url="http://localhost:3030")
    assert out.index("oldest") < out.index("newest")
    assert "[Chrome · Docs]" in out


@pytest.mark.asyncio
async def test_fetch_dedupes_and_respects_budget(monkeypatch) -> None:
    payload = {"data": [_ocr_row("repeat"), _ocr_row("repeat"), _ocr_row("x" * 999)]}
    _patch_client(monkeypatch, _StubAsyncClient(response=_StubResponse(200, payload)))

    out = await sp.fetch_recent_screen_context(
        base_url="http://localhost:3030", char_budget=20
    )
    assert out.count("repeat") == 1
    assert len(out) <= 80  # budget + label/truncation overhead


@pytest.mark.asyncio
async def test_fetch_excludes_sensitive_apps(monkeypatch) -> None:
    payload = {
        "data": [
            _ocr_row("vault contents", app="1Password", window="Vault"),
            _ocr_row("homework notes", app="Chrome", window="Docs"),
        ]
    }
    _patch_client(monkeypatch, _StubAsyncClient(response=_StubResponse(200, payload)))

    out = await sp.fetch_recent_screen_context(
        base_url="http://localhost:3030", exclude=["1Password"]
    )
    assert "vault contents" not in out
    assert "homework notes" in out


@pytest.mark.asyncio
async def test_fetch_sends_bearer_key_and_audio_content_type(monkeypatch) -> None:
    stub = _patch_client(
        monkeypatch, _StubAsyncClient(response=_StubResponse(200, {"data": []}))
    )
    await sp.fetch_recent_screen_context(
        base_url="http://localhost:3030", api_key="secret", include_audio=True
    )
    assert stub.last_headers == {"Authorization": "Bearer secret"}
    assert stub.last_params["content_type"] == "all"


@pytest.mark.asyncio
async def test_fetch_accessibility_when_audio_disabled(monkeypatch) -> None:
    stub = _patch_client(
        monkeypatch, _StubAsyncClient(response=_StubResponse(200, {"data": []}))
    )
    await sp.fetch_recent_screen_context(base_url="http://localhost:3030")
    assert stub.last_params["content_type"] == "accessibility"
    assert stub.last_headers == {}


@pytest.mark.asyncio
async def test_fetch_passes_query_and_focused(monkeypatch) -> None:
    stub = _patch_client(
        monkeypatch, _StubAsyncClient(response=_StubResponse(200, {"data": []}))
    )
    await sp.fetch_recent_screen_context(
        base_url="http://localhost:3030", query="  TypeError  ", focused=True
    )
    assert stub.last_params["q"] == "TypeError"
    assert stub.last_params["focused"] == "true"


@pytest.mark.asyncio
async def test_fetch_omits_query_when_blank(monkeypatch) -> None:
    stub = _patch_client(
        monkeypatch, _StubAsyncClient(response=_StubResponse(200, {"data": []}))
    )
    await sp.fetch_recent_screen_context(base_url="http://localhost:3030", query="   ")
    assert "q" not in stub.last_params
    assert "focused" not in stub.last_params


# ---------------------------------------------------------------------------
# Fail-safe contract — never raise
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_non_200_returns_empty(monkeypatch) -> None:
    _patch_client(monkeypatch, _StubAsyncClient(response=_StubResponse(403, {})))
    assert await sp.fetch_recent_screen_context(base_url="http://localhost:3030") == ""


@pytest.mark.asyncio
async def test_fetch_connection_error_returns_empty(monkeypatch) -> None:
    _patch_client(
        monkeypatch, _StubAsyncClient(raise_on_get=RuntimeError("connection refused"))
    )
    assert await sp.fetch_recent_screen_context(base_url="http://localhost:3030") == ""


@pytest.mark.asyncio
async def test_fetch_bad_json_returns_empty(monkeypatch) -> None:
    _patch_client(
        monkeypatch,
        _StubAsyncClient(response=_StubResponse(200, ValueError("bad json"))),
    )
    assert await sp.fetch_recent_screen_context(base_url="http://localhost:3030") == ""


@pytest.mark.asyncio
async def test_health_ok_and_failure(monkeypatch) -> None:
    _patch_client(
        monkeypatch,
        _StubAsyncClient(response=_StubResponse(200, {"status": "healthy"})),
    )
    ok = await sp.check_screenpipe_health("http://localhost:3030")
    assert ok["reachable"] is True
    assert ok["status"] == "healthy"

    _patch_client(monkeypatch, _StubAsyncClient(raise_on_get=RuntimeError("down")))
    bad = await sp.check_screenpipe_health("http://localhost:3030")
    assert bad["reachable"] is False
    assert bad["status"] == "unreachable"
