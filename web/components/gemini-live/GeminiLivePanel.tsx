"use client";

/**
 * GeminiLivePanel — floating voice-tutoring panel.
 *
 * Design: oscilloscope-meets-tutor. Dark background panel with
 * teal/amber waveform, monospace stats, clean transcript.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Mic,
  MicOff,
  Zap,
  X,
  Volume2,
  Send,
  RotateCcw,
  Download,
} from "lucide-react";
import { useGeminiLive, type VoiceStatus, type TranscriptTurn } from "@/hooks/useGeminiLive";
import { apiFetch } from "@/lib/api";

// ── props ─────────────────────────────────────────────────────────────────

interface GeminiLivePanelProps {
  sessionId?: string;
  kbName?: string;
  defaultVoice?: string;
  className?: string;
  onClose?: () => void;
  onTranscriptUpdate?: (turns: TranscriptTurn[]) => void;
}

// ── constants ─────────────────────────────────────────────────────────────

const VOICES = ["Aoede", "Puck", "Charon", "Kore", "Fenrir"] as const;

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Speaking",
  reconnecting: "Reconnecting…",
  error: "Error",
};

const STATUS_COLORS: Record<VoiceStatus, string> = {
  idle: "#6b7280",
  connecting: "#f59e0b",
  listening: "#14b8a6",
  speaking: "#f97316",
  reconnecting: "#f59e0b",
  error: "#ef4444",
};

// ── waveform component ────────────────────────────────────────────────────

function Waveform({ status, analyserNode }: {
  status: VoiceStatus;
  analyserNode: AnalyserNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const smoothRef = useRef<Float32Array>(new Float32Array(32).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const BAR_COUNT = 32;
    const data = new Uint8Array(analyserNode ? analyserNode.fftSize : 128);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "rgba(9,11,17,0.0)";
      ctx.fillRect(0, 0, W, H);

      if (analyserNode) analyserNode.getByteTimeDomainData(data);

      const barW = Math.floor(W / BAR_COUNT) - 2;
      const isActive = status === "listening" || status === "speaking";
      const color = status === "speaking" ? "#f97316" : "#14b8a6";

      for (let i = 0; i < BAR_COUNT; i++) {
        let amplitude: number;
        if (!isActive || !analyserNode) {
          // Idle: gentle flatline ripple
          amplitude = 0.03 + Math.sin(Date.now() / 600 + i * 0.4) * 0.02;
        } else {
          const sample = data[Math.floor((i / BAR_COUNT) * data.length)] / 128 - 1;
          amplitude = Math.abs(sample);
        }

        // Smooth
        smoothRef.current[i] = smoothRef.current[i] * 0.75 + amplitude * 0.25;
        const barH = Math.max(3, smoothRef.current[i] * H * 2.2);

        const x = i * (barW + 2);
        const y = (H - barH) / 2;

        // Glow
        ctx.shadowBlur = isActive ? 8 : 3;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = isActive ? 0.85 : 0.35;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, analyserNode]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={56}
      className="w-full rounded-md"
      style={{ background: "rgba(0,0,0,0.3)" }}
    />
  );
}

// ── transcript item ────────────────────────────────────────────────────────

function TurnItem({ turn }: { turn: TranscriptTurn }) {
  const isUser = turn.role === "user";
  const time = new Date(turn.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-500/20 text-teal-100 border border-teal-500/30"
            : "bg-white/8 text-gray-200 border border-white/10"
        }`}
        style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: "0.8rem" }}
      >
        {turn.text}
      </div>
      <span className="text-[10px] text-gray-500 px-1">{time}</span>
    </div>
  );
}

// ── main panel ─────────────────────────────────────────────────────────────

export default function GeminiLivePanel({
  sessionId,
  kbName,
  defaultVoice = "Aoede",
  className = "",
  onClose,
  onTranscriptUpdate,
}: GeminiLivePanelProps) {
  const [selectedVoice, setSelectedVoice] = useState(defaultVoice);
  const [textInput, setTextInput] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const {
    status,
    transcript,
    error,
    isSupported,
    startSession,
    stopSession,
    interrupt,
    sendText,
    clearTranscript,
  } = useGeminiLive();

  // Notify parent of transcript changes
  useEffect(() => {
    onTranscriptUpdate?.(transcript);
  }, [transcript, onTranscriptUpdate]);

  // Auto-scroll transcript
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // Keyboard shortcuts
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === textInputRef.current) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (status === "idle") handleStart();
        else if (status === "speaking") interrupt();
      } else if (e.code === "Escape") {
        if (status !== "idle") stopSession();
      } else if (e.code === "KeyT") {
        textInputRef.current?.focus();
      } else if (e.code === "KeyV") {
        const idx = VOICES.indexOf(selectedVoice as any);
        setSelectedVoice(VOICES[(idx + 1) % VOICES.length]);
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, [status, interrupt, stopSession, selectedVoice]);

  const handleStart = useCallback(async () => {
    await startSession({
      voice: selectedVoice,
      sessionId,
      kbName,
    });
  }, [startSession, selectedVoice, sessionId, kbName]);

  const handleTextSend = useCallback(() => {
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput("");
  }, [sendText, textInput]);

  const handleExport = useCallback(async () => {
    if (!transcript.length) return;
    const lines = [
      `# Voice Session — ${new Date().toLocaleDateString()}`,
      `**Turns:** ${transcript.length}`,
      "---",
      ...transcript.map(
        (t) => `**${t.role === "user" ? "You" : "Tutor"}:** ${t.text}`,
      ),
    ].join("\n\n");
    const blob = new Blob([lines], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-session-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript]);

  const dotColor = STATUS_COLORS[status];
  const isActive = status !== "idle" && status !== "error";

  if (!isSupported) {
    return (
      <div
        className={`rounded-xl border p-5 text-sm ${className}`}
        style={{
          background: "rgba(9,11,17,0.95)",
          borderColor: "rgba(255,255,255,0.1)",
          color: "#9ca3af",
        }}
      >
        {!window.isSecureContext ? (
          <p>⚠️ Live Voice requires <strong>HTTPS</strong>. Please access this app over a secure connection.</p>
        ) : (
          <p>⚠️ Live Voice is not supported in this browser. Try Chrome or Edge.</p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      className={`flex flex-col rounded-xl outline-none ${className}`}
      style={{
        background: "rgba(9,11,17,0.97)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        width: 340,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <Volume2 size={14} color="#14b8a6" />
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "#e2e8f0", letterSpacing: "0.12em" }}
          >
            Live Tutor
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: dotColor,
                boxShadow: isActive ? `0 0 6px ${dotColor}` : undefined,
                animation: isActive ? "pulse 1.5s infinite" : undefined,
              }}
            />
            <span className="text-[10px]" style={{ color: "#6b7280" }}>
              {STATUS_LABELS[status]}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
              style={{ color: "#9ca3af" }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Waveform ── */}
      <div className="px-4 pt-3">
        <Waveform status={status} analyserNode={analyserNode} />
      </div>

      {/* ── Transcript ── */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ minHeight: 120, maxHeight: 220, scrollbarWidth: "thin" }}
      >
        {transcript.length === 0 ? (
          <p
            className="text-center text-xs"
            style={{ color: "#4b5563", paddingTop: 24 }}
          >
            {status === "idle"
              ? "Press Start to begin a voice session"
              : "Listening…"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {transcript.map((turn, i) => (
              <TurnItem key={i} turn={turn} />
            ))}
          </div>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          className="mx-4 mb-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          {error}
        </div>
      )}

      {/* ── Controls ── */}
      <div
        className="px-4 pb-4 pt-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Primary action buttons */}
        <div className="flex items-center gap-2 mb-3">
          {status === "idle" || status === "error" ? (
            <button
              onClick={handleStart}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all"
              style={{
                background: "rgba(20,184,166,0.2)",
                border: "1px solid rgba(20,184,166,0.4)",
                color: "#5eead4",
              }}
            >
              <Mic size={14} />
              Start
            </button>
          ) : (
            <>
              <button
                onClick={stopSession}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all"
                style={{
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "#fca5a5",
                }}
              >
                <MicOff size={14} />
                Stop
              </button>
              <button
                onClick={interrupt}
                disabled={status !== "speaking"}
                className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-30"
                style={{
                  background: "rgba(249,115,22,0.15)",
                  border: "1px solid rgba(249,115,22,0.3)",
                  color: "#fdba74",
                }}
                title="Interrupt (Space)"
              >
                <Zap size={13} />
                Cut
              </button>
            </>
          )}
        </div>

        {/* Text fallback input */}
        <div className="flex items-center gap-2 mb-3">
          <input
            ref={textInputRef}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTextSend()}
            placeholder="Type instead…"
            className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#e2e8f0",
            }}
          />
          <button
            onClick={handleTextSend}
            disabled={!textInput.trim() || !isActive}
            className="rounded-lg p-1.5 disabled:opacity-30 transition-opacity"
            style={{ background: "rgba(20,184,166,0.2)", color: "#5eead4" }}
          >
            <Send size={13} />
          </button>
        </div>

        {/* Voice selector + util buttons */}
        <div className="flex items-center gap-2">
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={isActive}
            className="flex-1 rounded-lg px-2 py-1 text-xs outline-none disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#9ca3af",
            }}
          >
            {VOICES.map((v) => (
              <option key={v} value={v} style={{ background: "#1f2937" }}>
                {v}
              </option>
            ))}
          </select>

          <button
            onClick={clearTranscript}
            title="Clear transcript"
            className="rounded-lg p-1.5 opacity-50 transition-opacity hover:opacity-100"
            style={{ color: "#9ca3af" }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={handleExport}
            disabled={!transcript.length}
            title="Export transcript"
            className="rounded-lg p-1.5 opacity-50 transition-opacity hover:opacity-100 disabled:opacity-20"
            style={{ color: "#9ca3af" }}
          >
            <Download size={13} />
          </button>
          <button
            onClick={() => setShowShortcuts((s) => !s)}
            className="rounded-lg px-2 py-1 text-[10px] opacity-40 hover:opacity-70 transition-opacity"
            style={{ color: "#9ca3af", fontFamily: "monospace" }}
          >
            ⌨
          </button>
        </div>

        {/* Keyboard shortcuts legend */}
        {showShortcuts && (
          <div
            className="mt-2 rounded-lg px-3 py-2 text-[10px] space-y-1"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#6b7280",
              fontFamily: "monospace",
            }}
          >
            <div><kbd className="opacity-70">Space</kbd> — Start / Interrupt</div>
            <div><kbd className="opacity-70">Esc</kbd> — Stop session</div>
            <div><kbd className="opacity-70">T</kbd> — Focus text input</div>
            <div><kbd className="opacity-70">V</kbd> — Cycle voice</div>
          </div>
        )}
      </div>
    </div>
  );
}
