"""Tests for the presence router."""
from __future__ import annotations

import sys
import time
import types
from unittest.mock import MagicMock

import pytest


# ── mock heavy deps ───────────────────────────────────────────────────────

def _mod(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m

for _n in [
    "aimtutor.api.routers.auth",
    "aimtutor.config", "aimtutor.config.settings",
    "psycopg2", "pydantic_settings", "loguru",
]:
    if _n not in sys.modules:
        _mod(_n)

sys.modules["aimtutor.api.routers.auth"].require_auth = lambda: None
sys.modules["aimtutor.api.routers.auth"].require_admin = lambda: None
sys.modules["loguru"].logger = MagicMock()

from aimtutor.api.routers import presence as p  # noqa: E402


# ── tests ─────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_ping_updates_presence():
    uid = "u-test-123"
    before = time.monotonic()
    p._presence[uid] = before - 1
    payload = MagicMock(); payload.user_id = uid
    await p.ping(payload)
    assert p._presence[uid] > before


@pytest.mark.anyio
async def test_snapshot_includes_online_user():
    uid = "u-online-456"
    p._presence[uid] = time.monotonic()
    result = await p.snapshot(MagicMock())
    assert uid in result["online"]


@pytest.mark.anyio
async def test_snapshot_excludes_stale_user():
    uid = "u-stale-789"
    p._presence[uid] = time.monotonic() - 200
    result = await p.snapshot(MagicMock())
    assert uid not in result["online"]


def test_presence_timeout_constant():
    assert p.TIMEOUT == 90.0
