"use client";

import { useCallback, useEffect, useRef } from "react";

interface AutoScrollOptions {
  hasMessages: boolean;
  isStreaming: boolean;
  composerHeight: number;
  messageCount: number;
  lastMessageContent?: string;
  lastEventCount?: number;
  /** Live voice transcript — scroll parent when turns update. */
  liveTranscriptLength?: number;
  liveTranscriptTail?: string;
  liveVoiceActive?: boolean;
  liveVoiceStatus?: "idle" | "connecting" | "listening" | "speaking" | "reconnecting" | "error";
}

const THROTTLE_MS = 80;

export function useChatAutoScroll({
  hasMessages,
  isStreaming,
  composerHeight,
  messageCount,
  lastMessageContent,
  lastEventCount,
  liveTranscriptLength = 0,
  liveTranscriptTail = "",
  liveVoiceActive = false,
  liveVoiceStatus = "idle",
}: AutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTimeRef = useRef(0);
  const pendingRafRef = useRef(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;

    const now = performance.now();
    const elapsed = now - lastScrollTimeRef.current;
    const liveStreaming =
      liveVoiceActive &&
      (liveVoiceStatus === "listening" || liveVoiceStatus === "speaking");
    const fastScroll = isStreaming || liveStreaming;

    if (fastScroll && elapsed < THROTTLE_MS) {
      if (pendingRafRef.current) return;
      pendingRafRef.current = window.setTimeout(() => {
        pendingRafRef.current = 0;
        if (shouldAutoScrollRef.current) {
          scrollToBottom("instant");
          lastScrollTimeRef.current = performance.now();
        }
      }, THROTTLE_MS - elapsed);
      return () => {
        if (pendingRafRef.current) {
          clearTimeout(pendingRafRef.current);
          pendingRafRef.current = 0;
        }
      };
    }

    const raf = window.requestAnimationFrame(() => {
      scrollToBottom(fastScroll ? "instant" : "smooth");
      lastScrollTimeRef.current = performance.now();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (pendingRafRef.current) {
        clearTimeout(pendingRafRef.current);
        pendingRafRef.current = 0;
      }
    };
  }, [
    isStreaming,
    lastEventCount,
    lastMessageContent,
    liveTranscriptLength,
    liveTranscriptTail,
    liveVoiceActive,
    liveVoiceStatus,
    messageCount,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!hasMessages && !liveVoiceActive) return;
    if (!shouldAutoScrollRef.current) return;
    const raf = window.requestAnimationFrame(() => {
      scrollToBottom("instant");
    });
    return () => window.cancelAnimationFrame(raf);
  }, [composerHeight, hasMessages, liveVoiceActive, scrollToBottom]);

  // After streaming ends, dynamically-loaded components (e.g. MathAnimatorViewer
  // via next/dynamic) may render and grow the content height. Detect that and
  // scroll to bottom so the user can see the full result.
  //
  // This observer used to run for the entire lifetime of the conversation,
  // which meant any post-stream DOM change — including the user expanding a
  // trace `<details>` row to read it — was treated as "new content arrived"
  // and pulled the user back to the bottom. We now gate it to a short window
  // right after `isStreaming` flips false, which is when late-mounting
  // dynamic components actually settle.
  const POST_STREAM_AUTOSCROLL_WINDOW_MS = 4000;
  useEffect(() => {
    if (isStreaming) return;
    if (!hasMessages) return;

    const container = containerRef.current;
    if (!container) return;

    let prevHeight = container.scrollHeight;
    let rafId = 0;
    const deadline = performance.now() + POST_STREAM_AUTOSCROLL_WINDOW_MS;

    const check = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (performance.now() > deadline) return;
        const curHeight = container.scrollHeight;
        if (curHeight > prevHeight && shouldAutoScrollRef.current) {
          scrollToBottom("instant");
        }
        prevHeight = curHeight;
      });
    };

    const mo = new MutationObserver(check);
    mo.observe(container, { childList: true, subtree: true });
    const stopTimer = window.setTimeout(() => {
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    }, POST_STREAM_AUTOSCROLL_WINDOW_MS);

    return () => {
      window.clearTimeout(stopTimer);
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [hasMessages, isStreaming, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  return {
    containerRef,
    endRef,
    shouldAutoScrollRef,
    scrollToBottom,
    handleScroll,
  };
}
