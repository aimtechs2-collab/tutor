"use client";

import { useRef, type ChangeEvent, type ReactNode } from "react";
import { Camera, Mic, Monitor, MonitorOff, Upload, X } from "lucide-react";
import { useLiveVoice } from "@/context/LiveVoiceContext";
import type { VoiceStatus } from "@/hooks/useGeminiLive";

const STATUS_HINT: Record<VoiceStatus, string> = {
  idle: "Tap Live to start",
  connecting: "Connecting…",
  listening: "Listening — speak anytime",
  speaking: "Tutor is speaking",
  reconnecting: "Reconnecting…",
  error: "Session error",
};

function LiveOrb({ status, active }: { status: VoiceStatus; active: boolean }) {
  const isLive =
    active &&
    (status === "listening" || status === "speaking" || status === "connecting");

  return (
    <div
      className="relative flex h-12 w-[min(180px,32vw)] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)]/70 bg-[var(--muted)]/40"
      style={{
        boxShadow: isLive ? "0 0 28px rgba(56, 189, 248, 0.3)" : undefined,
      }}
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-full"
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
            "radial-gradient(ellipse 60% 100% at 70% 40%, rgba(255,255,255,0.4) 0%, transparent 55%)",
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
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all disabled:opacity-40 ${
        active
          ? "border-teal-500/40 bg-teal-500/15 text-teal-600 dark:text-teal-300"
          : "border-[var(--border)] bg-[var(--muted)]/50 text-[var(--foreground)] hover:bg-[var(--muted)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Orb + live controls pinned above the chat composer. */
export default function LiveVoiceDock() {
  const {
    status,
    error,
    activeModel,
    interrupt,
    sendText,
    videoSource,
    videoPreviewRef,
    startVideo,
    stopVideo,
    endLive,
  } = useLiveVoice();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isConnected =
    status === "listening" || status === "speaking" || status === "reconnecting";
  const isSessionActive =
    isConnected || status === "connecting";
  const isVideoActive = videoSource !== null;

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
  };

  return (
    <div className="mx-auto w-full max-w-[720px] shrink-0 px-1 pb-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="text/*,.md,.txt,.pdf,image/*"
        onChange={(e) => void handleUpload(e)}
      />

      {isVideoActive ? (
        <div className="mb-2 flex justify-center">
          <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-black/90 shadow-lg">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="max-h-36 w-auto max-w-full object-contain"
            />
            <span className="absolute bottom-1 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">
              {videoSource === "screen"
                ? "Screen · ~1 frame/s to tutor"
                : "Camera"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-center gap-2 sm:gap-2.5">
        <CircleControl
          label={
            videoSource === "camera" ? "Stop camera" : "Camera"
          }
          active={videoSource === "camera"}
          disabled={!isConnected}
          onClick={() => {
            if (videoSource === "camera") stopVideo();
            else void startVideo("camera");
          }}
        >
          <Camera size={17} strokeWidth={1.75} />
        </CircleControl>

        <CircleControl
          label={
            videoSource === "screen" ? "Stop screen share" : "Share screen"
          }
          active={videoSource === "screen"}
          disabled={!isConnected}
          onClick={() => {
            if (videoSource === "screen") stopVideo();
            else void startVideo("screen");
          }}
        >
          {videoSource === "screen" ? (
            <MonitorOff size={17} strokeWidth={1.75} />
          ) : (
            <Monitor size={17} strokeWidth={1.75} />
          )}
        </CircleControl>

        <CircleControl
          label="Upload file"
          disabled={!isSessionActive}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={17} strokeWidth={1.75} />
        </CircleControl>

        <LiveOrb status={status} active={isSessionActive} />

        <CircleControl
          label={status === "speaking" ? "Interrupt" : "Microphone"}
          active={isSessionActive}
          onClick={() => {
            if (status === "speaking") interrupt();
          }}
        >
          <Mic size={17} strokeWidth={1.75} />
        </CircleControl>

        <CircleControl label="End live" onClick={() => void endLive()}>
          <X size={18} strokeWidth={1.75} />
        </CircleControl>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-[var(--muted-foreground)]">
        {error?.trim() || STATUS_HINT[status]}
      </p>
      {activeModel && !error && (
        <p
          className="text-center text-[10px] text-[var(--muted-foreground)]/70"
          title="On-screen text is a caption from this model and can lag behind your voice"
        >
          {activeModel.replace(/^gemini-/, "")}
        </p>
      )}
    </div>
  );
}
