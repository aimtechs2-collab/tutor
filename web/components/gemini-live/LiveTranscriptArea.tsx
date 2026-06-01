"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useLiveVoiceOptional } from "@/context/LiveVoiceContext";
import type { TranscriptTurn, VoiceStatus } from "@/hooks/useGeminiLive";

function TranscriptBubble({ turn }: { turn: TranscriptTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(85%,28rem)] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
          isUser
            ? "border border-teal-500/25 bg-teal-500/15 text-[var(--foreground)]"
            : "border border-[var(--border)] bg-[var(--muted)]/60 text-[var(--foreground)]"
        }`}
      >
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {isUser ? "You" : "Tutor"}
        </span>
        {turn.text}
      </div>
    </div>
  );
}

interface LiveTranscriptAreaProps {
  /** When true, show a divider above live turns in an existing chat thread. */
  embedded?: boolean;
  /** Shared with chat auto-scroll — scroll-up disables stick until next user turn. */
  shouldAutoScrollRef?: React.MutableRefObject<boolean>;
}

function scrollRootFor(node: HTMLElement | null): HTMLElement | null {
  return node?.closest('[data-chat-scroll-root="true"]') as HTMLElement | null;
}

function isNearBottom(container: HTMLElement, threshold = 80): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  );
}

/** Live transcript in the normal chat scroll region (tutor left, you right). */
export default function LiveTranscriptArea({
  embedded = false,
  shouldAutoScrollRef,
}: LiveTranscriptAreaProps) {
  const live = useLiveVoiceOptional();
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const lastUserTurnTsRef = useRef(0);

  const transcript = live?.transcript ?? [];
  const error = live?.error;
  const status: VoiceStatus = live?.status ?? "idle";
  const lastTurn = transcript[transcript.length - 1];
  const lastTurnText = lastTurn?.text ?? "";

  useEffect(() => {
    const root = scrollRootFor(bottomRef.current);
    if (!root) return;

    const onScroll = () => {
      const near = isNearBottom(root);
      shouldStickRef.current = near;
      if (shouldAutoScrollRef) shouldAutoScrollRef.current = near;
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [transcript.length > 0, shouldAutoScrollRef]);

  useEffect(() => {
    if (shouldAutoScrollRef?.current) {
      shouldStickRef.current = true;
    }
  }, [transcript, lastTurnText, shouldAutoScrollRef]);

  useEffect(() => {
    const lastUser = [...transcript].reverse().find((t) => t.role === "user");
    if (lastUser && lastUser.ts !== lastUserTurnTsRef.current) {
      lastUserTurnTsRef.current = lastUser.ts;
      shouldStickRef.current = true;
    }
  }, [transcript]);

  useEffect(() => {
    if (transcript.length === 0) return;

    const root = scrollRootFor(bottomRef.current);
    if (!root || !shouldStickRef.current) return;

    const liveActive = status === "listening" || status === "speaking";
    const raf = window.requestAnimationFrame(() => {
      if (!shouldStickRef.current) return;
      if (liveActive) {
        root.scrollTop = root.scrollHeight;
      } else {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    });

    return () => window.cancelAnimationFrame(raf);
  }, [transcript, lastTurnText, status]);

  if (!live) return null;

  const isPending = status === "connecting" || status === "reconnecting";
  const emptyMessage = error
    ? error
    : isPending
      ? status === "reconnecting"
        ? "Reconnecting to your live tutor…"
        : "Connecting to your live tutor…"
      : "Speak when ready — your words will appear here.";

  return (
    <div className="mx-auto w-full space-y-6">
      {embedded && transcript.length > 0 && (
        <p className="px-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Live voice
        </p>
      )}
      {transcript.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-3 px-2 py-10"
          role={isPending ? "status" : undefined}
          aria-live="polite"
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2
              className="h-9 w-9 animate-spin text-teal-500/90 dark:text-teal-400"
              aria-hidden
            />
          ) : null}
          <p className="text-center text-sm text-[var(--muted-foreground)]">
            {emptyMessage}
          </p>
        </div>
      ) : (
        transcript.map((turn, i) => (
          <TranscriptBubble key={`${turn.ts}-${i}`} turn={turn} />
        ))
      )}
      {error && transcript.length > 0 && (
        <p className="text-center text-xs text-red-500">{error}</p>
      )}
      <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
    </div>
  );
}

/** Reports live transcript changes to the chat page scroll hook (outside LiveVoiceProvider). */
export function LiveScrollMetaReporter({
  onMeta,
}: {
  onMeta: (meta: {
    length: number;
    tail: string;
    status: VoiceStatus;
  }) => void;
}) {
  const live = useLiveVoiceOptional();
  const transcript = live?.transcript ?? [];
  const status: VoiceStatus = live?.status ?? "idle";
  const tail = transcript[transcript.length - 1]?.text ?? "";

  useEffect(() => {
    onMeta({ length: transcript.length, tail, status });
  }, [transcript, tail, status, onMeta]);

  return null;
}
