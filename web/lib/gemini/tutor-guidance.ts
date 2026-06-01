/**
 * tutor-guidance — bridge between Gemini Live function calls and the AIMTutor UI.
 *
 * The live voice tutor can drive the app (navigate pages, spotlight a control,
 * click a whitelisted control) via Gemini Live function calling. The functions
 * are declared server-side and baked into the ephemeral token
 * (see aimtutor/api/routers/gemini_live.py — keep TUTOR_PAGES / TUTOR_TARGETS in
 * sync with the Python TUTOR_NAV_PAGES / TUTOR_UI_TARGETS).
 *
 * A single mounted overlay registers concrete handlers here; the live client
 * resolves each incoming tool call against them. Everything is whitelisted: the
 * model can only reach pages/controls listed below, and can never touch the OS.
 *
 * ``look_at_screen`` is the exception that doesn't need the overlay: it asks the
 * backend for a fresh ScreenPipe snapshot of what's on screen right now.
 */

import { apiFetch, apiUrl } from "@/lib/api";

export const TUTOR_PAGES = [
  "chat",
  "history",
  "knowledge",
  "notebook",
  "question",
  "solver",
  "research",
  "co_writer",
  "settings",
] as const;
export type TutorPage = (typeof TUTOR_PAGES)[number];

export const TUTOR_PAGE_ROUTES: Record<TutorPage, string> = {
  chat: "/chat",
  history: "/history",
  knowledge: "/knowledge",
  notebook: "/notebook",
  question: "/question",
  solver: "/solver",
  research: "/research",
  co_writer: "/co_writer",
  settings: "/settings",
};

export const TUTOR_TARGETS = [
  "composer.input",
  "composer.send",
  "composer.attach",
  "composer.capabilities",
  "composer.knowledge",
  "composer.space",
  "composer.voice",
] as const;
export type TutorTarget = (typeof TUTOR_TARGETS)[number];

function isTutorPage(value: string): value is TutorPage {
  return (TUTOR_PAGES as readonly string[]).includes(value);
}
function isTutorTarget(value: string): value is TutorTarget {
  return (TUTOR_TARGETS as readonly string[]).includes(value);
}

export interface TutorGuidanceHandlers {
  navigate: (page: TutorPage) => void | Promise<void>;
  /** Resolves false if the control never appears on screen. */
  highlight: (target: TutorTarget, note?: string) => boolean | Promise<boolean>;
  /** Resolves false if the control never appears on screen. */
  click: (target: TutorTarget) => boolean | Promise<boolean>;
  clear: () => void;
}

export interface TutorFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface TutorFunctionResult {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

let current: TutorGuidanceHandlers | null = null;

/** Register the active guidance handlers (from the mounted overlay). */
export function registerTutorGuidance(handlers: TutorGuidanceHandlers): () => void {
  current = handlers;
  return () => {
    if (current === handlers) current = null;
  };
}

/** Execute one Gemini Live tool call and produce a function response payload. */
export async function executeTutorCall(
  call: TutorFunctionCall,
): Promise<TutorFunctionResult> {
  const respond = (response: Record<string, unknown>): TutorFunctionResult => ({
    id: call.id,
    name: call.name,
    response,
  });

  const args = call.args ?? {};

  // look_at_screen reads ScreenPipe via the backend; it does not need the
  // overlay handlers, so handle it before the UI-guidance readiness check.
  if (call.name === "look_at_screen") {
    try {
      const query = args.query != null ? String(args.query) : undefined;
      const res = await apiFetch(apiUrl("/api/v1/gemini-live/screenpipe/context"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string };
      const text = typeof data?.text === "string" ? data.text : "";
      return respond(
        text
          ? { ok: true, screen_text: text }
          : { ok: true, screen_text: "", note: "No recent screen text available." },
      );
    } catch {
      return respond({ ok: false, error: "Could not read the screen." });
    }
  }

  if (!current) {
    return respond({ ok: false, error: "Guidance UI is not ready." });
  }

  try {
    switch (call.name) {
      case "navigate_to": {
        const page = String(args.page ?? "");
        if (!isTutorPage(page)) {
          return respond({ ok: false, error: `Unknown page: ${page}` });
        }
        await current.navigate(page);
        return respond({ ok: true, navigated_to: page });
      }
      case "highlight_element": {
        const target = String(args.target ?? "");
        if (!isTutorTarget(target)) {
          return respond({ ok: false, error: `Unknown target: ${target}` });
        }
        const note = args.note != null ? String(args.note) : undefined;
        const ok = await current.highlight(target, note);
        return respond(
          ok ? { ok: true } : { ok: false, error: "That control is not on screen right now." },
        );
      }
      case "click_element": {
        const target = String(args.target ?? "");
        if (!isTutorTarget(target)) {
          return respond({ ok: false, error: `Unknown target: ${target}` });
        }
        const ok = await current.click(target);
        return respond(
          ok ? { ok: true } : { ok: false, error: "That control is not on screen right now." },
        );
      }
      case "clear_guidance": {
        current.clear();
        return respond({ ok: true });
      }
      default:
        return respond({ ok: false, error: `Unknown function: ${call.name}` });
    }
  } catch (err) {
    return respond({
      ok: false,
      error: err instanceof Error ? err.message : "Action failed.",
    });
  }
}
