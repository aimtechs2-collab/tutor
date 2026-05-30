"use client";

/**
 * In-chat Gemini Live — transcript in the message area (tutor left, you right),
 * control bar above the composer. No full-screen overlay.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Mic, Upload, X } from "lucide-react";
import { useGeminiLive, type VoiceStatus, type TranscriptTurn } from "@/hooks/useGeminiLive";

interface GeminiLivePanelProps {
  open: boolean;
  sessionId?: string;
  kbName?: string;
  defaultVoice?: string;
  autoStart?: boolean;
  onClose: () => void;
  onTranscriptUpdate?: (turns: TranscriptTurn[]) => void;
}

const STATUS_HINT: Record<VoiceStatus, string> = {
  idle: "Tap Live to start voice",
  connecting: "Connecting…",
  listening: "Listening — speak anytime",
  speaking: "Tutor is speaking",
  reconnecting: "Reconnecting…",
  error: "Session error",
};

function LiveOrb({
  status,
  active,
  compact = false,
}: {
  status: VoiceStatus;
  active: boolean;
  compact?: boolean;
}) {
  const isLive =
    active &&
    (status === "listening" || status === "speaking" || status === "connecting");

  if (compact) {
    return (
      <div
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full"
        style={{
          boxShadow: isLive
            ? "0 0 28px rgba(56, 189, 248, 0.4)"
            : "0 0 12px rgba(99, 102, 241, 0.15)",
        }}
        aria-hidden
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 40%, #7dd3fc 0%, #6366f1 50%, #312e81 100%)",
            animation: isLive ? "live-orb-drift 4s ease-in-out infinite" : "none",
          }}
        />
        <div
          className="absolute inset-0 rounded-full mix-blend-screen opacity-80"
          style={{
            background:
              "radial-gradient(circle at 65% 35%, rgba(255,255,255,0.55) 0%, transparent 60%)",
            animation: isLive ? "live-orb-pulse 2.2s ease-in-out infinite" : "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-[48px] w-[min(200px,36vw)] items-center justify-center overflow-hidden rounded-full border border-[var(--border)]/60 bg-[var(--muted)]/30"
      style={{
        boxShadow: isLive
          ? "0 0 32px rgba(56, 189, 248, 0.25)"
          : undefined,
      }}
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-full opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 120% at 30% 50%, #7dd3fc 0%, #6366f1 45%, #312e81 100%)",
          animation: isLive ? "live-orb-drift 4s ease-in-out infinite" : "none",
        }}
      />
      <div
        className="absolute inset-0 rounded-full mix-blend-screen"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 70% 40%, rgba(255,255,255,0.45) 0%, transparent 55%)",
          animation: isLive ? "live-orb-pulse 2.2s ease-in-out infinite" : "none",
        }}
      />
    </div>
  );
}

function CircleControl({
  onClick,
  disabled,
  active,
  label,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all disabled:opacity-40 ${
        active
          ? "border-teal-500/40 bg-teal-500/15 text-teal-600 dark:text-teal-300"
          : "border-[var(--border)] bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]"
      }`}
    >
      {children}
    </button>
  );
}

function TranscriptBubble({ turn }: { turn: TranscriptTurn }) {
  const isUser = turn.role === "user";
  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[min(85%,28rem)] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
          isUser
            ? "bg-teal-500/15 text-[var(--foreground)] border border-teal-500/25"
            : "bg-[var(--muted)]/60 text-[var(--foreground)] border border-[var(--border)]"
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

export default function GeminiLivePanel({
  open,
  sessionId,
  kbName,
  defaultVoice = "Aoede",
  autoStart = true,
  onClose,
  onTranscriptUpdate,
}: GeminiLivePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    status,
    transcript,
    error,
    isSupported,
    startSession,
    stopSession,
    interrupt,
    sendText,
  } = useGeminiLive();

  useEffect(() => {
    onTranscriptUpdate?.(transcript);
  }, [transcript, onTranscriptUpdate]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, status]);

  const handleStart = useCallback(async () => {
    await startSession({
      voice: defaultVoice,
      sessionId,
      kbName,
    });
  }, [startSession, defaultVoice, sessionId, kbName]);

  const autoStartDoneRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoStartDoneRef.current = false;
      return;
    }
    if (!autoStart || autoStartDoneRef.current) return;
    autoStartDoneRef.current = true;
    if (status === "idle" && !error) void handleStart();
  }, [open, autoStart, status, error, handleStart]);

  useEffect(() => {
    if (!open && status !== "idle") {
      stopSession();
    }
  }, [open, status, stopSession]);

  const handleClose = useCallback(() => {
    stopSession();
    onClose();
  }, [stopSession, onClose]);

  const handleUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (file.type.startsWith("text/") || file.name.endsWith(".md")) {
        const text = await file.text();
        sendText(`[Attached file: ${file.name}]\n\n${text.slice(0, 8000)}`);
        return;
      }
      sendText(
        `I shared a file named "${file.name}" (${file.type || "unknown type"}). Please help me with it.`,
      );
    },
    [sendText],
  );

  const isSessionActive =
    status === "listening" ||
    status === "speaking" ||
    status === "connecting" ||
    status === "reconnecting";

  if (!open) return null;

  if (!isSupported) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center px-6 text-center text-sm text-[var(--muted-foreground)]">
        <p>
          {!window.isSecureContext
            ? "Live voice requires HTTPS."
            : "Live voice is not supported in this browser."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex w-full flex-1 min-h-0 flex-col overflow-hidden"
      role="region"
      aria-label="Live voice conversation"
    >
      {/* Transcript — tutor left, you right */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 py-4 [scrollbar-gutter:stable] [scrollbar-width:thin]"
      >
        {transcript.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-4 text-center">
            <LiveOrb status={status} active={isSessionActive} compact />
            <p className="max-w-sm text-[15px] text-[var(--muted-foreground)]">
              {error || STATUS_HINT[status]}
            </p>
          </div>
        ) : (
          transcript.map((turn, i) => (
            <TranscriptBubble key={`${turn.ts}-${i}`} turn={turn} />
          ))
        )}
      </div>

      {error && transcript.length > 0 && (
        <p className="shrink-0 px-2 pb-1 text-center text-xs text-red-500">
          {error}
        </p>
      )}

      {/* Bottom live controls — sits above composer */}
      <div className="shrink-0 border-t border-[var(--border)]/80 bg-[var(--background)]/95 px-2 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[520px] items-center justify-center gap-2.5 sm:gap-3">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="text/*,.md,.txt,.pdf,image/*"
            onChange={(e) => void handleUpload(e)}
          />

          <CircleControl
            label="Upload file"
            disabled={!isSessionActive}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={18} strokeWidth={1.75} />
          </CircleControl>

          <LiveOrb status={status} active={isSessionActive} />

          <CircleControl
            label={status === "speaking" ? "Interrupt" : "Microphone"}
            active={isSessionActive}
            onClick={() => {
              if (status === "speaking") interrupt();
            }}
          >
            <Mic size={18} strokeWidth={1.75} />
          </CircleControl>

          <CircleControl label="End live" onClick={handleClose}>
            <X size={20} strokeWidth={1.75} />
          </CircleControl>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">
          {STATUS_HINT[status]}
        </p>
      </div>
    </div>
  );
}
