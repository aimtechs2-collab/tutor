/**
 * Parse Chart.js configuration emitted by the visualize pipeline.
 * Models often return JavaScript object literals (unquoted keys, arrow
 * functions, line comments) — not strict JSON.
 */

export function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(
    /^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i,
  );
  return fenced ? fenced[1].trim() : trimmed;
}

/** Remove line and block comments so JSON-ish fallbacks can run. */
export function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  let inString: "'" | '"' | "`" | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\") {
        if (i + 1 < source.length) out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

function quoteUnquotedKeys(source: string): string {
  return source
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) =>
      JSON.stringify(value.replace(/\\'/g, "'")),
    )
    .replace(/,\s*([}\]])/g, "$1");
}

function isChartConfigShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return typeof o.type === "string" && typeof o.data === "object" && o.data !== null;
}

function evalJsObjectLiteral(source: string): unknown {
  const cleaned = stripJsComments(source).trim();
  if (!cleaned.startsWith("{")) {
    throw new Error("Chart config must be an object literal");
  }
  const expr = cleaned.startsWith("(") ? cleaned : `(${cleaned})`;
  // Config is produced by the user's own visualize turn — safe enough to evaluate.
  return new Function(`"use strict"; return ${expr};`)();
}

export function parseChartJsConfig(source: string): Record<string, unknown> | null {
  const raw = stripCodeFence(source);
  if (!raw) return null;

  const attempts: Array<() => unknown> = [
    () => JSON.parse(raw),
    () => JSON.parse(quoteUnquotedKeys(raw)),
    () => JSON.parse(quoteUnquotedKeys(stripJsComments(raw))),
    () => evalJsObjectLiteral(raw),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (isChartConfigShape(parsed)) return parsed;
    } catch {
      /* try next strategy */
    }
  }
  return null;
}

export function looksLikeChartJsConfig(text: string): boolean {
  const raw = stripCodeFence(text);
  if (!raw.includes("type") || !raw.includes("data")) return false;
  if (parseChartJsConfig(raw)) return true;
  return /\btype\s*:\s*["']?\w+["']?/.test(raw) && /\bdata\s*:\s*\{/.test(raw);
}
