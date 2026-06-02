"""Tests for visualize attachment routing helpers."""

from __future__ import annotations

from aimtutor.agents.visualize.utils import (
    extract_primary_html_attachment,
    is_valid_chartjs_config,
    resolve_visualize_render_mode,
    should_render_attached_html_directly,
)
from aimtutor.core.context import Attachment


def test_resolve_render_mode_html_attachment_overrides_chartjs():
    att = Attachment(
        type="file",
        filename="report.html",
        mime_type="text/html",
        extracted_text="<!DOCTYPE html><html><body><div>Cost</div></body></html>",
    )
    assert (
        resolve_visualize_render_mode(
            "chartjs",
            attachments=[att],
            user_message="visualize this",
        )
        == "html"
    )


def test_should_render_attached_html_directly_short_prompt():
    assert should_render_attached_html_directly("visualize this")
    assert should_render_attached_html_directly("")


def test_extract_primary_html_attachment():
    att = Attachment(
        type="file",
        filename="dashboard.htm",
        extracted_text="<html><body><h1>Dashboard</h1></body></html>",
    )
    html = extract_primary_html_attachment([att])
    assert html is not None
    assert "<h1>Dashboard</h1>" in html


def test_is_valid_chartjs_config_rejects_plugin_snippet():
    plugin = """
    Chart.register({
      id: 'centerText',
      beforeDraw(chart) { /* ... */ }
    });
    """
    assert not is_valid_chartjs_config(plugin)

    config = '{"type":"doughnut","data":{"labels":["A"],"datasets":[{"data":[1]}]}}'
    assert is_valid_chartjs_config(config)
