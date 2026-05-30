"use client";

import { useEffect, useRef } from "react";
import { useLiveVoiceOptional } from "@/context/LiveVoiceContext";
import type { TranscriptTurn } from "@/hooks/useGeminiLive";

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
  /** When true, parent scroll container handles overflow (show with existing chat). */
  embedded?: boolean;
}

/** Live transcript in the normal chat scroll region (tutor left, you right). */
export default function LiveTranscriptArea({ embedded = false }: LiveTranscriptAreaProps) {
  const live = useLiveVoiceOptional();
  const scrollRef = useRef<HTMLDivElement>(null);

  const transcript = live?.transcript ?? [];
  const error = live?.error;
  const status = live?.status ?? "idle";

  useEffect(() => {
    if (embedded) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, status, embedded]);

  if (!live) return null;

  const inner = (
    <>
      {embedded && transcript.length > 0 && (
        <p className="px-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Live voice
        </p>
      )}
      {transcript.length === 0 ? (
        <p className="px-2 text-center text-sm text-[var(--muted-foreground)]">
          {error || "Speak when ready — your words will appear here."}
        </p>
      ) : (
        transcript.map((turn, i) => (
          <TranscriptBubble key={`${turn.ts}-${i}`} turn={turn} />
        ))
      )}
      {error && transcript.length > 0 && (
        <p className="text-center text-xs text-red-500">{error}</p>
      )}
    </>
  );

  if (embedded) {
    return <div className="mx-auto w-full space-y-6">{inner}</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="mx-auto w-full flex-1 min-h-0 space-y-6 overflow-y-auto pt-6 pr-4 [scrollbar-gutter:stable] [scrollbar-width:thin]"
      style={{
        paddingBottom: "16px",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0px, #000 24px, #000 calc(100% - 24px), transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0px, #000 24px, #000 calc(100% - 24px), transparent 100%)",
      }}
    >
      {inner}
    </div>
  );
}
