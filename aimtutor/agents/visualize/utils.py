"""Utility helpers for the visualize pipeline."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from aimtutor.core.context import Attachment


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract a JSON object from raw model output."""
    raw = (text or "").strip()
    if not raw:
        return {}

    fenced = re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    candidates = fenced + [raw]

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            parsed = _decode_first_json_object(candidate)
            if parsed is not None:
                return parsed

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = raw[start : end + 1]
        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            parsed = _decode_first_json_object(snippet)
            if parsed is not None:
                return parsed

    raise json.JSONDecodeError("No JSON object found", raw, 0)


def _decode_first_json_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    stripped = (text or "").lstrip()
    if not stripped:
        return None

    starts = [0]
    brace_index = stripped.find("{")
    if brace_index > 0:
        starts.append(brace_index)

    for start in starts:
        try:
            parsed, _end = decoder.raw_decode(stripped[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def extract_code_block(text: str, language: str = "") -> str:
    """Extract a fenced code block from LLM output.

    If *language* is given the block must start with that tag;
    otherwise any triple-backtick fence is accepted.
    """
    if language:
        pattern = rf"```{re.escape(language)}\s*\n([\s\S]*?)\n```"
    else:
        pattern = r"```[A-Za-z]*\s*\n([\s\S]*?)\n```"
    match = re.search(pattern, text or "", re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return (text or "").strip()


def is_valid_html_document(html: str) -> bool:
    """Heuristic check that *html* looks like a renderable HTML fragment."""
    if not html:
        return False
    lowered = html.lower()
    return "<html" in lowered or "<!doctype" in lowered or "<body" in lowered or "<div" in lowered


_HTML_EXTENSIONS = (".html", ".htm")
_HTML_MIME_MARKERS = ("text/html", "application/xhtml")


def _attachment_filename(att: Attachment) -> str:
    return str(getattr(att, "filename", "") or "").strip().lower()


def _attachment_mime(att: Attachment) -> str:
    return str(getattr(att, "mime_type", "") or "").strip().lower()


def is_html_attachment(att: Attachment) -> bool:
    name = _attachment_filename(att)
    if any(name.endswith(ext) for ext in _HTML_EXTENSIONS):
        return True
    mime = _attachment_mime(att)
    return any(marker in mime for marker in _HTML_MIME_MARKERS)


def has_html_attachment(attachments: list[Attachment] | None) -> bool:
    if not attachments:
        return False
    return any(is_html_attachment(att) for att in attachments)


def extract_primary_html_attachment(attachments: list[Attachment] | None) -> str | None:
    """Return the first renderable HTML document from attachments."""
    if not attachments:
        return None
    for att in attachments:
        if not is_html_attachment(att):
            continue
        text = str(getattr(att, "extracted_text", "") or "").strip()
        if is_valid_html_document(text):
            return text
    return None


_DIRECT_RENDER_HINTS = re.compile(
    r"\b("
    r"visuali[sz]e(\s+this)?|show\s+this|display\s+this|render\s+this|"
    r"open\s+this|view\s+this|see\s+this|preview\s+this"
    r")\b",
    re.IGNORECASE,
)


def should_render_attached_html_directly(user_message: str) -> bool:
    """True when the user likely wants the attached page shown as-is."""
    text = (user_message or "").strip()
    if not text:
        return True
    if "[attached documents]" in text.lower():
        # Strip boilerplate and look at the user question tail.
        if "[user question]" in text.lower():
            text = text.split("[User Question]", 1)[-1].split("[user question]", 1)[-1].strip()
    if len(text) <= 120 and _DIRECT_RENDER_HINTS.search(text):
        return True
    return len(text) <= 48


def resolve_visualize_render_mode(
    render_mode: str,
    *,
    attachments: list[Attachment] | None,
    user_message: str,
) -> str:
    """
  When the user attaches an HTML file, Chart.js/SVG/Mermaid are usually wrong
  for "visualize this" — route to the HTML viewer unless they explicitly chose
  Manim or already chose HTML.
    """
    mode = (render_mode or "auto").strip().lower()
    if mode in ("manim_video", "manim_image", "html"):
        return mode
    if not has_html_attachment(attachments):
        return mode
  # Attached dashboard/report pages should render in the HTML iframe.
    if mode in ("auto", "chartjs", "svg", "mermaid"):
        return "html"
    return mode


def is_valid_chartjs_config(code: str) -> bool:
    """Heuristic: config must look like ``new Chart(ctx, config)`` input."""
    raw = extract_code_block(code, "javascript") or (code or "").strip()
    if not raw:
        return False
    lowered = raw.lower()
    if "chart.register" in lowered or "chart.defaults" in lowered:
        return False
    if "plugins:" in lowered and "type:" not in lowered:
        return False
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        jsonish = raw
        if not jsonish.lstrip().startswith("{"):
            return False
        try:
            parsed = json.loads(jsonish)
        except json.JSONDecodeError:
            return False
    if not isinstance(parsed, dict):
        return False
    if "type" not in parsed:
        return False
    data = parsed.get("data")
    return isinstance(data, dict)


def build_fallback_html(*, title: str, summary: str = "", note: str = "") -> str:
    """Build a minimal, self-contained fallback HTML page.

    Used when the model fails to produce a renderable HTML document, so the
    user still gets *something* shown in the iframe instead of a blank panel.
    """
    safe_title = (title or "Visualization").strip() or "Visualization"
    safe_summary = (summary or "").replace("\n", "<br>") or (
        "The model did not return a renderable HTML document."
    )
    safe_note = (note or "").replace("\n", "<br>")

    note_block = (
        f'<div class="note"><strong>Note:</strong><br>{safe_note}</div>' if safe_note else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{safe_title}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box;}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:linear-gradient(135deg,#F8FAFC 0%,#EFF6FF 100%);
       min-height:100vh;padding:2rem;color:#1E293B;}}
  .card{{max-width:760px;margin:0 auto;background:#fff;border-radius:16px;
        padding:1.75rem 2rem;box-shadow:0 4px 6px -1px rgba(0,0,0,.08);}}
  h1{{color:#1E40AF;font-size:1.4rem;margin-bottom:1rem;}}
  .summary{{line-height:1.7;color:#475569;}}
  .note{{margin-top:1rem;padding:0.9rem 1rem;background:#FEF3C7;
        border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;color:#92400E;}}
</style>
</head>
<body>
  <div class="card">
    <h1>{safe_title}</h1>
    <div class="summary">{safe_summary}</div>
    {note_block}
  </div>
</body>
</html>"""


__all__ = [
    "build_fallback_html",
    "extract_code_block",
    "extract_json_object",
    "extract_primary_html_attachment",
    "has_html_attachment",
    "is_html_attachment",
    "is_valid_chartjs_config",
    "is_valid_html_document",
    "resolve_visualize_render_mode",
    "should_render_attached_html_directly",
]
