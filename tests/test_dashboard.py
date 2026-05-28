"""Tests for the dashboard router."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture()
def mock_sessions():
    return [
        {"session_id": "s1", "capability": "chat", "title": "Test chat",
         "updated_at": 1700000000, "message_count": 5, "status": "idle"},
        {"session_id": "s2", "capability": "question", "title": "Quiz",
         "updated_at": 1700086400, "message_count": 10, "status": "idle"},
    ]


@pytest.mark.anyio
async def test_get_recent_activities(mock_sessions):
    from aimtutor.api.routers.dashboard import get_recent_activities
    mock_store = MagicMock()
    mock_store.list_sessions = AsyncMock(return_value=mock_sessions)
    with patch("aimtutor.api.routers.dashboard.get_session_store", return_value=mock_store):
        result = await get_recent_activities(limit=10)
    assert len(result) == 2
    assert result[0]["type"] == "chat"
    assert result[1]["type"] == "question"


@pytest.mark.anyio
async def test_get_memory_snapshot_empty(tmp_path):
    from aimtutor.api.routers.dashboard import get_memory_snapshot
    with patch("aimtutor.api.routers.dashboard.memory_root", return_value=tmp_path):
        result = await get_memory_snapshot()
    assert result == {}


@pytest.mark.anyio
async def test_get_memory_snapshot_with_files(tmp_path):
    from aimtutor.api.routers.dashboard import get_memory_snapshot
    l2 = tmp_path / "L2"
    l2.mkdir()
    (l2 / "chat.md").write_text("You prefer visual explanations.")
    with patch("aimtutor.api.routers.dashboard.memory_root", return_value=tmp_path):
        result = await get_memory_snapshot()
    assert "chat" in result
    assert "visual" in result["chat"]
