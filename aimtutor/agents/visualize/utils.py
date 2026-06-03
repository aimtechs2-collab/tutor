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
    Resolve the requested visualize mode to an executable backend mode.

    We intentionally avoid server-side Manim execution in this deployment:
      - manim_video -> html (web-native animation)
      - manim_image -> svg (web-native storyboard/static frame)

    When the user attaches an HTML file, Chart.js/SVG/Mermaid are usually wrong
    for "visualize this" — route to the HTML viewer.
    """
    mode = (render_mode or "auto").strip().lower()
    if mode == "manim_video":
        return "html"
    if mode == "manim_image":
        return "svg"
    if mode == "html":
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


def has_interactive_animation_controls(html: str) -> bool:
    """Heuristic check for required animation controls in HTML output."""
    lowered = (html or "").lower()
    if not lowered:
        return False
    has_play = "play" in lowered
    has_pause = "pause" in lowered
    has_next = "next" in lowered
    has_prev = "previous" in lowered or "prev" in lowered
    has_restart = "restart" in lowered or "reset" in lowered
    has_progress = "progress" in lowered or "step" in lowered or "aria-valuenow" in lowered
    return has_play and has_pause and has_next and has_prev and has_restart and has_progress


def is_effectively_blank_html(html: str) -> bool:
    """Detect HTML pages that are technically valid but effectively empty."""
    if not html:
        return True
    lowered = html.lower()
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    has_visual_targets = any(
        token in lowered
        for token in (
            "<canvas",
            "<svg",
            "<table",
            "chart",
            "plot",
            "graph",
            "dataset",
            "data-",
        )
    )
    # If neither meaningful text nor visual structures exist, treat as blank.
    if len(text) < 40 and not has_visual_targets:
        return True
    return False


def inject_interactive_animation_controls(
    html: str,
    *,
    title: str = "Interactive Animation",
) -> str:
    """
    Preserve generated HTML and inject step controls around existing content.

    This keeps dataset-specific visuals while adding animation affordances.
    """
    if not html or not is_valid_html_document(html):
        return html
    if has_interactive_animation_controls(html):
        return html

    controls_css = """
<style id="dt-animation-controls-style">
  .dt-animation-controls{position:sticky;top:0;z-index:9999;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;background:rgba(10,15,35,.92);color:#e5ecff;border:1px solid #2f3d67;border-radius:10px;margin:8px 0 14px}
  .dt-animation-controls button{border:1px solid #445690;background:#1b2a54;color:#eaf1ff;border-radius:8px;padding:6px 10px;cursor:pointer}
  .dt-animation-controls button:hover{background:#24376d}
  .dt-animation-progress{height:8px;background:#1a2342;border-radius:999px;overflow:hidden;min-width:180px;flex:1}
  .dt-animation-progress > div{height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#6366f1)}
  .dt-animation-step{min-width:120px;text-align:right;font-size:.9rem;color:#c3d0f1}
  .dt-step-target[data-dt-hidden="1"]{display:none!important}
</style>
"""
    controls_html = f"""
<div class="dt-animation-controls" role="region" aria-label="{title} controls">
  <button id="dtPrevBtn" type="button">Previous</button>
  <button id="dtPlayBtn" type="button">Play</button>
  <button id="dtPauseBtn" type="button">Pause</button>
  <button id="dtNextBtn" type="button">Next</button>
  <button id="dtRestartBtn" type="button">Restart</button>
  <div class="dt-animation-progress" role="progressbar" aria-label="Animation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <div id="dtProgressBar"></div>
  </div>
  <div id="dtStepText" class="dt-animation-step">Step 1 / 1</div>
</div>
"""
    controls_js = """
<script id="dt-animation-controls-script">
document.addEventListener("DOMContentLoaded", function () {
  const targets = Array.from(document.querySelectorAll("section, article, canvas, svg, table, [data-step], .step, .chart, .visual"));
  const unique = [];
  const seen = new Set();
  for (const el of targets) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest(".dt-animation-controls")) continue;
    if (seen.has(el)) continue;
    seen.add(el);
    unique.push(el);
  }
  const steps = unique.length ? unique : [document.body];
  steps.forEach((el) => { if (el !== document.body) el.classList.add("dt-step-target"); });
  let index = 0;
  let timer = null;
  const prevBtn = document.getElementById("dtPrevBtn");
  const nextBtn = document.getElementById("dtNextBtn");
  const playBtn = document.getElementById("dtPlayBtn");
  const pauseBtn = document.getElementById("dtPauseBtn");
  const restartBtn = document.getElementById("dtRestartBtn");
  const stepText = document.getElementById("dtStepText");
  const progressBar = document.getElementById("dtProgressBar");
  const progressWrap = document.querySelector(".dt-animation-progress[role='progressbar']");
  if (!prevBtn || !nextBtn || !playBtn || !pauseBtn || !restartBtn || !stepText || !progressBar || !progressWrap) return;
  function render() {
    steps.forEach((el, i) => {
      if (el === document.body) return;
      el.setAttribute("data-dt-hidden", i === index ? "0" : "1");
    });
    const pct = Math.round(((index + 1) / steps.length) * 100);
    progressBar.style.width = pct + "%";
    progressWrap.setAttribute("aria-valuenow", String(pct));
    stepText.textContent = "Step " + (index + 1) + " / " + steps.length;
  }
  function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
  prevBtn.addEventListener("click", function () { index = Math.max(0, index - 1); render(); });
  nextBtn.addEventListener("click", function () { index = Math.min(steps.length - 1, index + 1); render(); });
  restartBtn.addEventListener("click", function () { stop(); index = 0; render(); });
  playBtn.addEventListener("click", function () {
    stop();
    timer = window.setInterval(function () {
      if (index >= steps.length - 1) { stop(); return; }
      index += 1;
      render();
    }, 1400);
  });
  pauseBtn.addEventListener("click", stop);
  render();
});
</script>
"""

    output = html
    if "</head>" in output.lower():
        output = re.sub(
            r"</head>",
            controls_css + "\n</head>",
            output,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        output = controls_css + "\n" + output

    if "</body>" in output.lower():
        output = re.sub(
            r"</body>",
            controls_html + "\n" + controls_js + "\n</body>",
            output,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        output = output + "\n" + controls_html + "\n" + controls_js
    return output


def choose_best_coding_model_option(
    options: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Pick the strongest code-oriented model from available LLM options."""
    if not options:
        return None

    def _score(option: dict[str, Any]) -> tuple[int, int]:
        model = str(option.get("model") or "").lower()
        model_name = str(option.get("model_name") or "").lower()
        merged = f"{model} {model_name}"
        score = 0

        # Strong coding/reasoning families first.
        if "claude" in merged and "sonnet" in merged:
            score += 350
        if "claude" in merged and "opus" in merged:
            score += 330
        if "gpt-5" in merged or "gpt-4.1" in merged or "gpt-4o" in merged:
            score += 320
        if re.search(r"\bo[34]\b", merged):
            score += 300
        if "gemini-2.5-pro" in merged or "gemini 2.5 pro" in merged:
            score += 290
        if "deepseek-coder" in merged or "codestral" in merged or "coder" in merged:
            score += 280

        # Mild penalty for clearly lightweight/tiny variants.
        if "mini" in merged or "small" in merged or "flash" in merged:
            score -= 80

        context_window = option.get("context_window")
        try:
            context_int = int(context_window) if context_window is not None else 0
        except (TypeError, ValueError):
            context_int = 0
        score += min(context_int // 4000, 25)
        return score, context_int

    ranked = sorted(
        [opt for opt in options if isinstance(opt, dict) and str(opt.get("model") or "").strip()],
        key=_score,
        reverse=True,
    )
    return ranked[0] if ranked else None


def build_interactive_animation_fallback_html(
    *, title: str, summary: str = "", note: str = ""
) -> str:
    """Build a self-contained interactive animation fallback page."""
    safe_title = (title or "Interactive Animation").strip() or "Interactive Animation"
    safe_summary = (summary or "Step-based visual walkthrough.").strip()
    safe_note = (note or "").strip()
    note_block = (
        f'<p class="note"><strong>Note:</strong> {safe_note}</p>'
        if safe_note
        else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{safe_title}</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;font-family:Inter,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#e2e8f0;padding:16px}}
  .wrap{{max-width:920px;margin:0 auto;display:grid;gap:14px}}
  .panel{{background:#111a33;border:1px solid #253056;border-radius:14px;padding:14px}}
  h1{{margin:0 0 8px;font-size:1.35rem}}
  .muted{{color:#a7b0c9;line-height:1.55}}
  .stage{{min-height:220px;display:grid;place-items:center;background:#0b1329;border:1px dashed #3b4a76;border-radius:12px;padding:14px;text-align:center}}
  .frameTitle{{font-size:1.05rem;font-weight:700;margin-bottom:8px}}
  .frameBody{{max-width:52ch;color:#c8d2ec;line-height:1.5}}
  .controls{{display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
  button{{border:1px solid #42538a;background:#1b2a54;color:#eaf1ff;border-radius:10px;padding:8px 12px;cursor:pointer}}
  button:hover{{background:#24376d}}
  .progress{{height:8px;background:#1a2342;border-radius:999px;overflow:hidden;flex:1;min-width:180px}}
  .bar{{height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#6366f1)}}
  .stepText{{min-width:120px;text-align:right;color:#c3d0f1;font-size:.9rem}}
  .note{{margin:.4rem 0 0;color:#fde68a}}
</style>
</head>
<body>
  <div class="wrap">
    <section class="panel">
      <h1>{safe_title}</h1>
      <p class="muted">{safe_summary}</p>
      {note_block}
    </section>
    <section class="panel">
      <div id="stage" class="stage" role="group" aria-label="Animation stage">
        <div>
          <div id="frameTitle" class="frameTitle"></div>
          <div id="frameBody" class="frameBody"></div>
        </div>
      </div>
    </section>
    <section class="panel controls" aria-label="Animation controls">
      <button id="prevBtn" type="button">Previous</button>
      <button id="playBtn" type="button">Play</button>
      <button id="pauseBtn" type="button">Pause</button>
      <button id="nextBtn" type="button">Next</button>
      <button id="restartBtn" type="button">Restart</button>
      <div class="progress" role="progressbar" aria-label="Animation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="progressBar" class="bar"></div>
      </div>
      <div id="stepText" class="stepText">Step 1 / 3</div>
    </section>
  </div>
  <script>
    document.addEventListener("DOMContentLoaded", function () {{
      const frames = [
        {{ title: "Step 1", body: "Set up the base view and identify the starting variables." }},
        {{ title: "Step 2", body: "Apply the transformation/change and observe intermediate state updates." }},
        {{ title: "Step 3", body: "Summarize the final state and key takeaway from the animation." }}
      ];
      const frameTitle = document.getElementById("frameTitle");
      const frameBody = document.getElementById("frameBody");
      const progressBar = document.getElementById("progressBar");
      const progressWrap = document.querySelector('[role="progressbar"]');
      const stepText = document.getElementById("stepText");
      const prevBtn = document.getElementById("prevBtn");
      const nextBtn = document.getElementById("nextBtn");
      const playBtn = document.getElementById("playBtn");
      const pauseBtn = document.getElementById("pauseBtn");
      const restartBtn = document.getElementById("restartBtn");
      if (!frameTitle || !frameBody || !progressBar || !stepText || !prevBtn || !nextBtn || !playBtn || !pauseBtn || !restartBtn || !progressWrap) return;
      let index = 0;
      let timer = null;
      function render() {{
        const frame = frames[index];
        frameTitle.textContent = frame.title;
        frameBody.textContent = frame.body;
        const ratio = ((index + 1) / frames.length) * 100;
        progressBar.style.width = ratio + "%";
        progressWrap.setAttribute("aria-valuenow", String(Math.round(ratio)));
        stepText.textContent = "Step " + (index + 1) + " / " + frames.length;
      }}
      function stop() {{
        if (timer) {{
          window.clearInterval(timer);
          timer = null;
        }}
      }}
      prevBtn.addEventListener("click", function () {{
        index = Math.max(0, index - 1);
        render();
      }});
      nextBtn.addEventListener("click", function () {{
        index = Math.min(frames.length - 1, index + 1);
        render();
      }});
      restartBtn.addEventListener("click", function () {{
        stop();
        index = 0;
        render();
      }});
      playBtn.addEventListener("click", function () {{
        stop();
        timer = window.setInterval(function () {{
          if (index >= frames.length - 1) {{
            stop();
            return;
          }}
          index += 1;
          render();
        }}, 1200);
      }});
      pauseBtn.addEventListener("click", stop);
      render();
    }});
  </script>
</body>
</html>"""


__all__ = [
    "build_interactive_animation_fallback_html",
    "build_fallback_html",
    "extract_code_block",
    "extract_json_object",
    "extract_primary_html_attachment",
    "has_html_attachment",
    "inject_interactive_animation_controls",
    "has_interactive_animation_controls",
    "is_effectively_blank_html",
    "is_html_attachment",
    "is_valid_chartjs_config",
    "is_valid_html_document",
    "resolve_visualize_render_mode",
    "should_render_attached_html_directly",
    "choose_best_coding_model_option",
]
