"use client";

/**
 * TutorGuidanceOverlay — renders the on-screen spotlight the live voice tutor
 * uses to point at controls, and registers the concrete navigate/highlight/
 * click handlers that Gemini Live function calls resolve against.
 *
 * Mount once inside the workspace layout. The overlay is pointer-events-none so
 * the student can keep interacting with the app while it points.
 *
 * Smoothness notes:
 *  - The spotlight follows its target via direct DOM writes inside a single rAF
 *    loop that *only* touches the DOM when the rect actually changes. We never
 *    call setState per frame (that caused a 60fps re-render storm + jank).
 *  - highlight/click wait for the element to appear (polling) so a navigate_to
 *    immediately followed by a highlight resolves once the new page mounts.
 *  - Switching targets glides; the first appearance and scroll-tracking snap.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  registerTutorGuidance,
  TUTOR_PAGE_ROUTES,
  type TutorPage,
  type TutorTarget,
} from "@/lib/gemini/tutor-guidance";

const PAD = 8;
const APPEAR_TIMEOUT_MS = 2500;
const APPEAR_POLL_MS = 80;
const CLICK_DELAY_MS = 420;
const CLICK_LINGER_MS = 900;
const GLIDE = "left 260ms ease, top 260ms ease, width 260ms ease, height 260ms ease";

function locate(target: TutorTarget): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-tutor-id="${target}"]`);
}

/** Resolve an element now, or poll briefly for it to mount (e.g. post-navigate). */
function waitForElement(
  target: TutorTarget,
  timeoutMs = APPEAR_TIMEOUT_MS,
): Promise<HTMLElement | null> {
  const existing = locate(target);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const start = performance.now();
    const poll = () => {
      const el = locate(target);
      if (el) return resolve(el);
      if (performance.now() - start >= timeoutMs) return resolve(null);
      window.setTimeout(poll, APPEAR_POLL_MS);
    };
    window.setTimeout(poll, APPEAR_POLL_MS);
  });
}

export default function TutorGuidanceOverlay() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLDivElement | null>(null);
  const targetElRef = useRef<HTMLElement | null>(null);
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const animateNextRef = useRef(false);
  const everShownRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);

  const cancelClearTimer = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  };

  // Sync the spotlight box (and note) to the target's current rect. Writes the
  // DOM directly and bails when nothing moved, so the rAF loop stays cheap.
  const syncRect = useCallback(() => {
    const el = targetElRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const last = lastRectRef.current;
    const unchanged =
      last && last.x === r.left && last.y === r.top && last.w === r.width && last.h === r.height;
    if (unchanged && !animateNextRef.current) return;

    lastRectRef.current = { x: r.left, y: r.top, w: r.width, h: r.height };
    const animate = animateNextRef.current;
    animateNextRef.current = false;

    box.style.transition = animate ? `${GLIDE}, opacity 160ms ease` : "opacity 160ms ease";
    box.style.left = `${r.left - PAD}px`;
    box.style.top = `${r.top - PAD}px`;
    box.style.width = `${r.width + PAD * 2}px`;
    box.style.height = `${r.height + PAD * 2}px`;
    box.style.opacity = "1";

    const noteEl = noteRef.current;
    if (noteEl) {
      const below = r.top + r.height + PAD + 8;
      const placeAbove = below > window.innerHeight - 40;
      const cx = Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90);
      noteEl.style.transition = animate
        ? "left 260ms ease, top 260ms ease, opacity 160ms ease"
        : "opacity 160ms ease";
      noteEl.style.left = `${cx}px`;
      noteEl.style.top = `${placeAbove ? r.top - PAD - 36 : below}px`;
      noteEl.style.opacity = "1";
    }
  }, []);

  const stop = useCallback(() => {
    cancelClearTimer();
    targetElRef.current = null;
    lastRectRef.current = null;
    everShownRef.current = false;
    setVisible(false);
    setNote(undefined);
  }, []);

  const startTracking = useCallback((el: HTMLElement, noteText?: string) => {
    cancelClearTimer();
    // Glide when moving from one target to another; snap on first appearance.
    animateNextRef.current = everShownRef.current;
    everShownRef.current = true;
    targetElRef.current = el;
    lastRectRef.current = null;
    setNote(noteText);
    setVisible(true);
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, []);

  useEffect(() => {
    const unregister = registerTutorGuidance({
      navigate: (page: TutorPage) => {
        router.push(TUTOR_PAGE_ROUTES[page]);
      },
      highlight: async (target, noteText) => {
        const el = await waitForElement(target);
        if (!el) return false;
        startTracking(el, noteText);
        return true;
      },
      click: async (target) => {
        const el = await waitForElement(target);
        if (!el) return false;
        startTracking(el);
        await new Promise((res) => setTimeout(res, CLICK_DELAY_MS));
        try {
          el.click();
        } catch {
          /* element vanished mid-action */
        }
        clearTimerRef.current = setTimeout(stop, CLICK_LINGER_MS);
        return true;
      },
      clear: () => stop(),
    });
    return () => {
      cancelClearTimer();
      unregister();
    };
  }, [router, startTracking, stop]);

  // Single rAF loop: follow scroll/resize/layout and auto-clear if the target
  // leaves the DOM (e.g. the page changed out from under us).
  useEffect(() => {
    if (!visible) return;
    const loop = () => {
      const el = targetElRef.current;
      if (el && !document.contains(el)) {
        stop();
        return;
      }
      syncRect();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, syncRect, stop]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]" aria-hidden>
      <div
        ref={boxRef}
        className="absolute rounded-xl ring-[3px] ring-teal-400"
        style={{
          opacity: 0,
          boxShadow: "0 0 0 9999px rgba(8, 12, 20, 0.42)",
          willChange: "left, top, width, height, opacity",
        }}
      >
        <span className="absolute inset-0 rounded-xl ring-2 ring-teal-300/70 animate-pulse" />
      </div>
      {note && (
        <div
          ref={noteRef}
          className="absolute max-w-[240px] -translate-x-1/2 rounded-lg bg-teal-500 px-3 py-1.5 text-center text-[12px] font-medium text-white shadow-lg"
          style={{ opacity: 0 }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
