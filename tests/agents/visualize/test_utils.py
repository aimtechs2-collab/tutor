"""Tests for visualize attachment routing helpers."""

from __future__ import annotations

from aimtutor.agents.visualize.models import ReviewResult
from aimtutor.agents.visualize.utils import (
    build_interactive_animation_fallback_html,
    choose_best_coding_model_option,
    extract_primary_html_attachment,
    has_interactive_animation_controls,
    inject_interactive_animation_controls,
    is_effectively_blank_html,
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


def test_resolve_render_mode_manim_video_maps_to_html():
    assert (
        resolve_visualize_render_mode(
            "manim_video",
            attachments=None,
            user_message="animate this concept",
        )
        == "html"
    )


def test_resolve_render_mode_manim_image_maps_to_svg():
    assert (
        resolve_visualize_render_mode(
            "manim_image",
            attachments=None,
            user_message="storyboard this concept",
        )
        == "svg"
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


def test_review_result_coerces_dict_optimized_code():
    result = ReviewResult.model_validate(
        {
            "optimized_code": {
                "type": "bar",
                "data": {"labels": ["A"], "datasets": [{"data": [1]}]},
            },
            "changed": False,
            "review_notes": "ok",
        }
    )
    assert isinstance(result.optimized_code, str)
    assert '"type": "bar"' in result.optimized_code
    assert is_valid_chartjs_config(result.optimized_code)


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


def test_animation_fallback_html_has_required_controls():
    html = build_interactive_animation_fallback_html(
        title="Limits Visualization",
        summary="Interactive walkthrough",
    )
    assert "<!DOCTYPE html>" in html
    assert has_interactive_animation_controls(html)


def test_has_interactive_animation_controls_rejects_static_html():
    static_html = "<html><body><h1>Only static content</h1></body></html>"
    assert not has_interactive_animation_controls(static_html)


def test_is_effectively_blank_html_flags_empty_like_pages():
    html = "<html><body><div>   </div></body></html>"
    assert is_effectively_blank_html(html)


def test_inject_controls_preserves_dataset_chart_content():
    html = """
    <!DOCTYPE html>
    <html><head><title>Dataset</title></head>
    <body>
      <section id="dataset-summary">Railway 1886, Brevo 779, Total 4137</section>
      <canvas id="costChart"></canvas>
    </body></html>
    """
    updated = inject_interactive_animation_controls(html, title="Data animation")
    assert "Railway 1886" in updated
    assert 'id="costChart"' in updated
    assert has_interactive_animation_controls(updated)


def test_choose_best_coding_model_option_prefers_strong_coding_models():
    options = [
        {"model": "gpt-4o-mini", "model_name": "GPT-4o Mini", "context_window": 128000},
        {"model": "claude-3-5-sonnet", "model_name": "Claude Sonnet", "context_window": 200000},
        {"model": "gemini-2.0-flash", "model_name": "Gemini Flash", "context_window": 1000000},
    ]
    best = choose_best_coding_model_option(options)
    assert best is not None
    assert best["model"] == "claude-3-5-sonnet"
