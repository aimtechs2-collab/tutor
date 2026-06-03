import { looksLikeChartJsConfig, stripCodeFence } from "@/lib/chart-config";
import type { MathAnimatorResult } from "@/lib/math-animator-types";
import { extractMathAnimatorResult } from "@/lib/math-animator-types";

export type VisualizeTextRenderType = "svg" | "chartjs" | "mermaid" | "html";
export type VisualizeManimRenderType = "manim_video" | "manim_image";
export type VisualizeRenderType =
  | VisualizeTextRenderType
  | VisualizeManimRenderType;
export type VisualizeRenderMode = "auto" | VisualizeRenderType;

export interface VisualizeFormConfig {
  render_mode: VisualizeRenderMode;
  // Only consumed by the backend when the resolved render_type ends up
  // being manim_video / manim_image. Ignored on text-only paths but kept
  // in form state so toggling between modes preserves the user's choice.
  quality: "low" | "medium" | "high";
  style_hint: string;
}

export const DEFAULT_VISUALIZE_CONFIG: VisualizeFormConfig = {
  render_mode: "auto",
  quality: "medium",
  style_hint: "",
};

export function buildVisualizeWSConfig(
  cfg: VisualizeFormConfig,
): Record<string, unknown> {
  return {
    render_mode: cfg.render_mode,
    quality: cfg.quality,
    style_hint: cfg.style_hint.trim(),
  };
}

const VISUALIZE_RENDER_LABELS: Record<VisualizeRenderMode, string> = {
  auto: "Auto",
  chartjs: "Chart.js",
  svg: "SVG",
  mermaid: "Mermaid",
  html: "HTML",
  manim_video: "Animation",
  manim_image: "Storyboard",
};

export function isManimRenderType(
  renderType: string,
): renderType is VisualizeManimRenderType {
  return renderType === "manim_video" || renderType === "manim_image";
}

export function isManimResult(
  result: VisualizeResult,
): result is VisualizeManimResult {
  return isManimRenderType(result.render_type);
}

/**
 * One-line summary of the visualize form, shown next to the collapsed
 * `Settings` chevron in the composer. Pass `translate` (typically the
 * `t` function from `react-i18next`) so the summary follows the active
 * UI language.
 */
export function summarizeVisualizeConfig(
  cfg: VisualizeFormConfig,
  translate?: (key: string) => string,
): string {
  const label = VISUALIZE_RENDER_LABELS[cfg.render_mode] ?? cfg.render_mode;
  const text = translate ? translate(label) : label;
  // For manim modes, surface the quality tier alongside the format —
  // matches what users were used to in the old Animator panel.
  if (cfg.render_mode === "manim_video" || cfg.render_mode === "manim_image") {
    const qLabel = cfg.quality.charAt(0).toUpperCase() + cfg.quality.slice(1);
    const q = translate ? translate(qLabel) : qLabel;
    return `${text} · ${q}`;
  }
  return text;
}

interface VisualizeTextResult {
  response: string;
  render_type: VisualizeTextRenderType;
  code: {
    language: string;
    content: string;
  };
  analysis: {
    render_type: string;
    description: string;
    data_description: string;
    chart_type: string;
    visual_elements: string[];
    rationale: string;
  };
  review: {
    optimized_code: string;
    changed: boolean;
    review_notes: string;
  };
}

interface VisualizeManimResult {
  render_type: VisualizeManimRenderType;
  manim: MathAnimatorResult;
}

export type VisualizeResult = VisualizeTextResult | VisualizeManimResult;

function looksLikeSvg(text: string): boolean {
  const raw = stripCodeFence(text).toLowerCase();
  return raw.includes("<svg");
}

function looksLikeMermaid(text: string): boolean {
  const raw = stripCodeFence(text).toLowerCase();
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|mindmap|pie)\b/.test(
    raw,
  );
}

function looksLikeHtml(text: string): boolean {
  const raw = stripCodeFence(text).toLowerCase();
  return raw.includes("<html") || raw.includes("<!doctype");
}

/** Recover a visualize payload from assistant markdown when the result event is missing. */
export function extractVisualizeResultFromContent(
  content: string,
): VisualizeResult | null {
  if (!content?.trim()) return null;

  let renderType: VisualizeTextRenderType | null = null;
  let codeBody = "";

  const fenceMatch = content.match(
    /```(json|javascript|js|svg|mermaid|html)?\s*([\s\S]*?)```/i,
  );
  if (fenceMatch) {
    const lang = (fenceMatch[1] || "").toLowerCase();
    codeBody = fenceMatch[2].trim();
    if (lang === "svg" || looksLikeSvg(codeBody)) renderType = "svg";
    else if (lang === "mermaid" || looksLikeMermaid(codeBody)) renderType = "mermaid";
    else if (lang === "html" || looksLikeHtml(codeBody)) renderType = "html";
    else if (looksLikeChartJsConfig(codeBody)) renderType = "chartjs";
  }

  if (!renderType) {
    const trimmed = content.trim();
    if (looksLikeChartJsConfig(trimmed)) {
      renderType = "chartjs";
      codeBody = stripCodeFence(trimmed);
    } else if (looksLikeSvg(trimmed)) {
      renderType = "svg";
      codeBody = stripCodeFence(trimmed);
    } else if (looksLikeMermaid(trimmed)) {
      renderType = "mermaid";
      codeBody = stripCodeFence(trimmed);
    } else if (looksLikeHtml(trimmed)) {
      renderType = "html";
      codeBody = stripCodeFence(trimmed);
    }
  }

  if (!renderType || !codeBody) return null;

  const lang =
    renderType === "svg"
      ? "svg"
      : renderType === "mermaid"
        ? "mermaid"
        : renderType === "html"
          ? "html"
          : "javascript";

  return {
    response: content,
    render_type: renderType,
    code: { language: lang, content: codeBody },
    analysis: {
      render_type: renderType,
      description: "",
      data_description: "",
      chart_type: "",
      visual_elements: [],
      rationale: "Recovered from assistant message content.",
    },
    review: {
      optimized_code: codeBody,
      changed: false,
      review_notes: "Recovered from message content (no result event).",
    },
  };
}

export function extractVisualizeResult(
  resultMetadata: Record<string, unknown> | undefined,
): VisualizeResult | null {
  if (!resultMetadata) return null;

  const renderType = resultMetadata.render_type;

  // Manim path: delegate decoding to math-animator-types so the existing
  // MathAnimatorViewer can render the artefacts unchanged.
  if (renderType === "manim_video" || renderType === "manim_image") {
    const manim = extractMathAnimatorResult(resultMetadata);
    if (!manim) return null;
    return { render_type: renderType, manim };
  }

  if (
    renderType !== "svg" &&
    renderType !== "chartjs" &&
    renderType !== "mermaid" &&
    renderType !== "html"
  )
    return null;

  const codeRaw =
    resultMetadata.code && typeof resultMetadata.code === "object"
      ? (resultMetadata.code as Record<string, unknown>)
      : {};

  if (!codeRaw.content) return null;

  return {
    response: String(resultMetadata.response ?? ""),
    render_type: renderType,
    code: {
      language: String(codeRaw.language ?? ""),
      content: String(codeRaw.content ?? ""),
    },
    analysis:
      resultMetadata.analysis && typeof resultMetadata.analysis === "object"
        ? (resultMetadata.analysis as VisualizeTextResult["analysis"])
        : {
            render_type: renderType,
            description: "",
            data_description: "",
            chart_type: "",
            visual_elements: [],
            rationale: "",
          },
    review:
      resultMetadata.review && typeof resultMetadata.review === "object"
        ? (resultMetadata.review as VisualizeTextResult["review"])
        : { optimized_code: "", changed: false, review_notes: "" },
  };
}
