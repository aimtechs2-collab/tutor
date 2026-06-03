"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, Copy, Check, ExternalLink, Maximize2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Mermaid } from "@/components/Mermaid";
import { prepareIframeHtml } from "@/lib/iframe-html";
import { parseChartJsConfig } from "@/lib/chart-config";
import { isManimResult, type VisualizeResult } from "@/lib/visualize-types";

const MathAnimatorViewer = dynamic(
  () => import("@/components/math-animator/MathAnimatorViewer"),
  { ssr: false },
);

function ChartJsRenderer({ config }: { config: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!canvasRef.current) return;

      try {
        const ChartModule = await import("chart.js/auto");
        const Chart = ChartModule.default;

        if (chartRef.current) {
          (chartRef.current as InstanceType<typeof Chart>).destroy();
          chartRef.current = null;
        }

        const parsedConfig = parseChartJsConfig(config) as ConstructorParameters<
          typeof Chart
        >[1] | null;
        if (!parsedConfig) {
          throw new Error(t("Invalid or empty chart configuration"));
        }

        if (cancelled) return;

        chartRef.current = new Chart(canvasRef.current, parsedConfig);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t("Failed to render chart"),
          );
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
      if (chartRef.current) {
        (chartRef.current as { destroy: () => void }).destroy();
        chartRef.current = null;
      }
    };
  }, [config, t]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t("Chart rendering error")}
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ maxHeight: 480 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function HtmlRenderer({ html }: { html: string }) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const prepared = useMemo(() => prepareIframeHtml(html || ""), [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = prepared;
  }, [prepared]);

  const handleOpenInNewTab = () => {
    try {
      const contentUrl = URL.createObjectURL(
        new Blob([prepared], { type: "text/html" }),
      );
      const wrapper = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visualization</title><style>html,body,iframe{height:100%;width:100%;margin:0;border:0;}</style></head><body><iframe sandbox="allow-scripts" src="${contentUrl}"></iframe></body></html>`;
      const url = URL.createObjectURL(
        new Blob([wrapper], { type: "text/html" }),
      );
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => {
        URL.revokeObjectURL(url);
        URL.revokeObjectURL(contentUrl);
      }, 60_000);
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={handleOpenInNewTab}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)]/90 px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] backdrop-blur transition-colors hover:text-[var(--foreground)]"
        title={t("Open in new tab")}
      >
        <ExternalLink size={10} strokeWidth={1.8} />
        {t("Open")}
      </button>
      <iframe
        ref={iframeRef}
        title={t("HTML visualization")}
        sandbox="allow-scripts"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)]"
        style={{ minHeight: 480, height: 560 }}
      />
    </div>
  );
}

function SvgRenderer({ svg }: { svg: string }) {
  const { t } = useTranslation();
  const decodeCommonEscapes = (input: string): string =>
    input
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');

  const normalizedSvg = useMemo(() => {
    const raw = (svg || "").trim();
    const fenced = raw.match(/^```(?:svg|xml)?\s*([\s\S]*?)\s*```$/i);
    const source = decodeCommonEscapes((fenced ? fenced[1] : raw).trim());
    const start = source.toLowerCase().indexOf("<svg");
    const end = source.toLowerCase().lastIndexOf("</svg>");
    if (start === -1 || end === -1 || end <= start) return "";
    let extracted = source.slice(start, end + 6).trim();
    // Repair common XML breakage from model output: bare '&' in labels/notes.
    extracted = extracted.replace(/&(?!#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]+;)/gi, "&amp;");
    // Repair template-like attributes such as width={123} -> width="123".
    extracted = extracted.replace(/=\{([^}]+)\}/g, '="$1"');
    return extracted;
  }, [svg]);

  const parsedSvg = useMemo<{ ok: true; svg: string } | { ok: false; error: string }>(() => {
    if (!normalizedSvg) {
      return { ok: false, error: t("Invalid SVG: missing <svg> block") };
    }
    const parser = new DOMParser();
    try {
      let parsed = parser.parseFromString(normalizedSvg, "image/svg+xml");
      if (parsed.querySelector("parsererror")) {
        // Last-chance fallback: wrap in <svg> if model emitted only inner nodes.
        const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480">${normalizedSvg}</svg>`;
        parsed = parser.parseFromString(wrapped, "image/svg+xml");
        if (parsed.querySelector("parsererror")) {
          // XML parser is strict; attempt HTML parser recovery for slightly
          // malformed but still renderable SVG markup.
          const htmlParsed = parser.parseFromString(normalizedSvg, "text/html");
          const recovered = htmlParsed.querySelector("svg");
          if (recovered) {
            return { ok: true, svg: recovered.outerHTML };
          }
          return { ok: false, error: t("Invalid SVG: could not parse XML") };
        }
        const node = parsed.querySelector("svg");
        return node
          ? { ok: true, svg: node.outerHTML }
          : { ok: false, error: t("Invalid SVG: could not parse XML") };
      }
      const node = parsed.querySelector("svg");
      return node
        ? { ok: true, svg: node.outerHTML }
        : { ok: false, error: t("Invalid SVG: could not parse XML") };
    } catch {
      return { ok: false, error: t("Invalid SVG: could not parse XML") };
    }
  }, [normalizedSvg, t]);
  const error = parsedSvg.ok ? null : parsedSvg.error;

  const svgUrl = useMemo(() => {
    if (error || !parsedSvg.ok) return "";
    // Use a stable data URL (instead of Blob URL) so fullscreen/duplicate
    // renderers don't depend on object URL lifecycle timing.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(parsedSvg.svg)}`;
  }, [error, parsedSvg]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t("SVG rendering error")}
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex justify-center overflow-x-auto">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgUrl} alt={t("SVG visualization")} className="max-w-full" />
    </div>
  );
}

type TextResult = Extract<
  VisualizeResult,
  { render_type: "svg" | "chartjs" | "mermaid" | "html" }
>;

function renderTextVisualization(result: TextResult) {
  if (result.render_type === "svg") {
    return <SvgRenderer svg={result.code.content} />;
  }
  if (result.render_type === "mermaid") {
    return <Mermaid chart={result.code.content} />;
  }
  if (result.render_type === "html") {
    return <HtmlRenderer html={result.code.content} />;
  }
  return <ChartJsRenderer config={result.code.content} />;
}

export default function VisualizationViewer({
  result,
}: {
  result: VisualizeResult;
}) {
  const { t } = useTranslation();

  // All hooks must run unconditionally before any early return — React
  // requires a stable hook order across renders. The text-path body below
  // is the only consumer of these states; the manim path returns earlier
  // and ignores them.
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  if (isManimResult(result)) {
    return <MathAnimatorViewer result={result.manim} />;
  }

  // TypeScript narrows ``result`` to the text-only variant from here on.
  // HTML iframe already provides its own "Open in new tab" affordance; the
  // sandboxed iframe also doesn't behave well inside a re-rendered modal.
  const isSvgStoryboard =
    result.render_type === "svg" &&
    /storyboard/i.test(String(result.analysis?.chart_type || ""));
  const supportsFullscreen = result.render_type !== "html" && !isSvgStoryboard;
  const supportsOpenInNewTab = result.render_type === "mermaid";

  const handleOpenMermaidInNewTab = () => {
    if (result.render_type !== "mermaid") return;
    try {
      const escaped = JSON.stringify(result.code.content || "");
      const standalone = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mermaid Visualization</title>
  <style>
    html,body{margin:0;padding:0;background:#0b1020;color:#e5e7eb;font-family:Inter,Segoe UI,Roboto,sans-serif}
    .wrap{padding:20px;min-height:100vh;box-sizing:border-box}
    .panel{background:#0f172a;border:1px solid #1f2a44;border-radius:12px;padding:16px;overflow:auto}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div id="mermaid-root" class="mermaid"></div>
    </div>
  </div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'dark' });
    const code = ${escaped};
    const root = document.getElementById('mermaid-root');
    if (root) {
      root.textContent = code;
      await mermaid.run({ nodes: [root] });
    }
  </script>
</body>
</html>`;
      const url = URL.createObjectURL(new Blob([standalone], { type: "text/html" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* no-op */
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.code.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may be unavailable */
    }
  };

  return (
    <div className="space-y-3">
      {/* Visualization area */}
      <div
        className={`relative ${
          result.render_type === "html"
            ? "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]"
            : "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] p-4"
        }`}
      >
        {supportsFullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            title={t("Fullscreen")}
            className={`absolute top-2 z-10 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)]/90 px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] backdrop-blur transition-colors hover:text-[var(--foreground)] ${
              supportsOpenInNewTab ? "right-[92px]" : "right-2"
            }`}
          >
            <Maximize2 size={10} strokeWidth={1.8} />
            {t("Fullscreen")}
          </button>
        )}
        {supportsOpenInNewTab && (
          <button
            type="button"
            onClick={handleOpenMermaidInNewTab}
            title={t("Open in new tab")}
            className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)]/90 px-2 py-1 text-[10px] font-medium text-[var(--muted-foreground)] backdrop-blur transition-colors hover:text-[var(--foreground)]"
          >
            <ExternalLink size={10} strokeWidth={1.8} />
            {t("Open")}
          </button>
        )}
        {renderTextVisualization(result)}
      </div>

      {!isSvgStoryboard && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCode((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <Code2 size={12} strokeWidth={1.8} />
            {showCode ? t("Hide code") : t("Show code")}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            {copied ? (
              <Check size={12} strokeWidth={1.8} />
            ) : (
              <Copy size={12} strokeWidth={1.8} />
            )}
            {copied ? t("Copied") : t("Copy code")}
          </button>

          <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]/50">
            {result.render_type === "svg"
              ? "SVG"
              : result.render_type === "mermaid"
                ? `Mermaid · ${result.analysis.chart_type || "diagram"}`
                : result.render_type === "html"
                  ? `HTML · ${result.analysis.chart_type || "interactive"}`
                  : `Chart.js · ${result.analysis.chart_type || "chart"}`}
          </span>
        </div>
      )}

      {/* Code panel — matches the always-dark .md-code-block style used by the
          markdown renderers so a "Show code" toggle inside a chart message
          looks identical to a fenced code block in the assistant response. */}
      {showCode && (
        <div className="md-code-block overflow-hidden rounded-xl border border-[var(--border)] bg-[#1f2937]">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
            {result.code.language}
          </div>
          <pre className="max-h-80 overflow-auto p-4 text-[13px] leading-relaxed text-[#e5e7eb]">
            <code>{result.code.content}</code>
          </pre>
        </div>
      )}

      {/* Review notes */}
      {result.review.changed && result.review.review_notes && (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {t("Review")}: {result.review.review_notes}
        </p>
      )}

      {/* Fullscreen overlay */}
      {fullscreen && supportsFullscreen && (
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setFullscreen(false)}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between text-white">
            <div className="text-xs uppercase tracking-wider opacity-80">
              {result.render_type === "svg"
                ? "SVG"
                : result.render_type === "mermaid"
                  ? `Mermaid · ${result.analysis.chart_type || "diagram"}`
                  : `Chart.js · ${result.analysis.chart_type || "chart"}`}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreen(false);
              }}
              title={t("Close")}
              className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/20"
            >
              <X size={12} strokeWidth={1.8} />
              {t("Close")}
            </button>
          </div>
          <div
            className="flex flex-1 items-center justify-center overflow-auto rounded-xl bg-[var(--card)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-[1600px]">
              {renderTextVisualization(result)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
