"""
Tests for dashboard router — pure unit tests.
All heavy app dependencies mocked before import.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── mock heavy deps ───────────────────────────────────────────────────────

def _mod(name: str) -> types.ModuleType:
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


for _n in [
    "aimtutor.api.routers.auth",
    "aimtutor.services.session",
    "aimtutor.services.memory",
    "aimtutor.services.memory.paths",
    "aimtutor.config", "aimtutor.config.settings",
    "psycopg2", "pydantic_settings", "loguru",
]:
    if _n not in sys.modules:
        _mod(_n)

sys.modules["aimtutor.api.routers.auth"].require_auth = lambda: None
sys.modules["aimtutor.api.routers.auth"].require_admin = lambda: None
sys.modules["loguru"].logger = MagicMock()
_mock_memory_root = MagicMock()
sys.modules["aimtutor.services.memory.paths"].memory_root = _mock_memory_root

# ── import module under test ──────────────────────────────────────────────

from aimtutor.api.routers.dashboard import (  # noqa: E402
    get_memory_snapshot,
    get_recent_activities,
    get_dashboard_stats,
)


# ── get_recent_activities ─────────────────────────────────────────────────

@pytest.mark.anyio
async def test_recent_returns_list():
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=[
        {"session_id": "s1", "capability": "chat", "title": "Chat 1",
         "updated_at": 1700000000, "message_count": 3, "status": "idle"},
        {"session_id": "s2", "capability": "question", "title": "Quiz 1",
         "updated_at": 1700086400, "message_count": 8, "status": "idle"},
    ])
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_recent_activities(limit=10)
    assert len(result) == 2
    types_found = {r["type"] for r in result}
    assert "chat" in types_found
    assert "question" in types_found


@pytest.mark.anyio
async def test_recent_empty():
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=[])
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_recent_activities(limit=10)
    assert result == []


@pytest.mark.anyio
async def test_recent_type_filter():
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=[
        {"session_id": "s1", "capability": "chat", "title": "Chat",
         "updated_at": 1700000000, "message_count": 2, "status": "idle"},
        {"session_id": "s2", "capability": "research", "title": "Research",
         "updated_at": 1700000001, "message_count": 5, "status": "idle"},
    ])
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_recent_activities(limit=10, type="chat")
    assert all(r["type"] == "chat" for r in result)


# ── get_memory_snapshot ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_memory_snapshot_no_l2_dir(tmp_path):
    _mock_memory_root.return_value = tmp_path
    result = await get_memory_snapshot()
    assert result == {}


@pytest.mark.anyio
async def test_memory_snapshot_reads_files(tmp_path):
    _mock_memory_root.return_value = tmp_path
    l2 = tmp_path / "L2"
    l2.mkdir()
    (l2 / "chat.md").write_text("User prefers short answers.")
    (l2 / "research.md").write_text("User is studying ML.")
    result = await get_memory_snapshot()
    assert "chat" in result
    assert "research" in result
    assert "short answers" in result["chat"]
    assert "ML" in result["research"]


@pytest.mark.anyio
async def test_memory_snapshot_truncates_long(tmp_path):
    _mock_memory_root.return_value = tmp_path
    l2 = tmp_path / "L2"
    l2.mkdir()
    (l2 / "chat.md").write_text("x" * 5000)
    result = await get_memory_snapshot()
    assert len(result["chat"]) <= 2000


# ── get_dashboard_stats ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_dashboard_stats_empty(tmp_path):
    _mock_memory_root.return_value = tmp_path
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=[])
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_dashboard_stats()
    assert result["total_sessions"] == 0
    assert result["streak_days"] == 0
    assert result["voice_minutes"] == 0.0
    assert len(result["seven_day_activity"]) == 7


@pytest.mark.anyio
async def test_dashboard_stats_counts_correctly(tmp_path):
    _mock_memory_root.return_value = tmp_path
    import time
    now = time.time()
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=[
        {"session_id": "s1", "capability": "chat",     "updated_at": int(now), "message_count": 2},
        {"session_id": "s2", "capability": "question", "updated_at": int(now), "message_count": 5},
        {"session_id": "s3", "capability": "research", "updated_at": int(now), "message_count": 3},
    ])
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_dashboard_stats()
    assert result["total_sessions"] == 3
    assert result["quiz_sessions"] == 1
    assert result["streak_days"] >= 1
