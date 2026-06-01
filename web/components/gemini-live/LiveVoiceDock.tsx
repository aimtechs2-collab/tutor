"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Camera, Loader2, Mic, Monitor, MonitorOff, Upload, X } from "lucide-react";
import { useLiveVoice } from "@/context/LiveVoiceContext";
import type { VoiceStatus } from "@/hooks/useGeminiLive";
import { apiFetch, apiUrl } from "@/lib/api";
import {
  ATTACHMENT_ACCEPT,
  classifyFile,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/doc-attachments";

/** Cap the text we feed the live model so a huge doc doesn't stall the WS. */
const MAX_LIVE_DOC_CHARS = 30_000;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

const STATUS_HINT: Record<VoiceStatus, string> = {
  idle: "Tap Live to start",
  connecting: "Connecting…",
  listening: "Listening — speak anytime",
  speaking: "Tutor is speaking",
  reconnecting: "Reconnecting…",
  error: "Session error",
};

function LiveOrb({ status, active }: { status: VoiceStatus; active: boolean }) {
  const isPending = status === "connecting" || status === "reconnecting";
  const isLive =
    active &&
    (status === "listening" ||
      status === "speaking" ||
      status === "connecting" ||
      status === "reconnecting");

  return (
    <div
      className="relative flex h-12 w-[min(180px,32vw)] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)]/70 bg-[var(--muted)]/40"
      style={{
        boxShadow: isLive ? "0 0 28px rgba(56, 189, 248, 0.3)" : undefined,
      }}
      aria-hidden={!isPending}
      aria-busy={isPending}
      role={isPending ? "status" : undefined}
      aria-label={isPending ? STATUS_HINT[status] : undefined}
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
      {isPending ? (
        <Loader2
          className="relative z-10 h-5 w-5 animate-spin text-white drop-shadow-sm"
          strokeWidth={2.25}
        />
      ) : null}
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
    sendImage,
    videoSource,
    videoPreviewRef,
    startVideo,
    stopVideo,
    endLive,
  } = useLiveVoice();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const isConnected =
    status === "listening" || status === "speaking" || status === "reconnecting";
  const isSessionActive =
    isConnected || status === "connecting";
  const isPending = status === "connecting" || status === "reconnecting";
  const isVideoActive = videoSource !== null;

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!isConnected) {
      setUploadMsg("Wait until Live is connected before uploading.");
      return;
    }
    const kind = classifyFile(file);
    if (!kind) {
      setUploadMsg(`Unsupported file: ${file.name}`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadMsg(`${file.name} is too large (max 10 MB).`);
      return;
    }

    setUploadBusy(true);
    setUploadMsg(`Reading ${file.name}…`);
    try {
      const b64 = await fileToBase64(file);

      // Images go straight to the model as a visual frame so it can "see" them.
      if (kind === "image") {
        sendImage(b64, file.type || "image/jpeg");
        sendText(
          `I just uploaded an image named "${file.name}". Please look at it carefully and help me with it.`,
        );
        setUploadMsg(`Sent ${file.name} to the tutor.`);
        return;
      }

      // Everything else (PDF, Word, Excel, PPT, text, zip, audio, video) is
      // extracted to text server-side via the shared MIME upload pipeline.
      const res = await apiFetch(apiUrl("/api/v1/uploads/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          base64: b64,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { detail?: string }).detail || `Extract failed: ${res.status}`,
        );
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();

      if (!text) {
        sendText(
          `I uploaded a file named "${file.name}" but no readable text could be extracted from it. Let me know what you'd like to do.`,
        );
      } else {
        const clipped =
          text.length > MAX_LIVE_DOC_CHARS
            ? `${text.slice(0, MAX_LIVE_DOC_CHARS)}\n\n…(truncated)`
            : text;
        // Send the full content silently (keeps the transcript readable) and
        // ask the model to walk the student through it.
        sendText(
          `The student uploaded a file named "${file.name}". Here is its content:\n\n${clipped}\n\nRead it and help the student with it. Briefly say what it is, then ask what they want to do.`,
          { silent: true },
        );
      }
      setUploadMsg(`Sent ${file.name} to the tutor.`);
    } catch (err) {
      setUploadMsg(
        err instanceof Error ? err.message : `Could not upload ${file.name}.`,
      );
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <>
      {/*
        Keep the preview video mounted whenever Live is open so videoPreviewRef
        exists before startVideo() attaches the MediaStream (MyTutor parity).
      */}
      <div
        className={`pointer-events-none fixed right-5 top-[4.75rem] z-40 aspect-video w-[min(13rem,28vw)] overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-2xl transition-opacity duration-200 ${
          isVideoActive ? "opacity-100" : "hidden"
        }`}
        aria-hidden={!isVideoActive}
      >
        <video
          ref={videoPreviewRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-contain"
        />
        <span className="absolute bottom-1.5 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white/95">
          {videoSource === "screen" ? "Screen share" : "Camera"}
        </span>
      </div>

      <div className="mx-auto w-full max-w-[720px] shrink-0 px-1 pb-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => void handleUpload(e)}
        />

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
            disabled={!isConnected || uploadBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadBusy ? (
              <Loader2 size={17} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Upload size={17} strokeWidth={1.75} />
            )}
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
        <p
          className="mt-1.5 flex items-center justify-center gap-2 text-center text-[11px] text-[var(--muted-foreground)]"
          aria-live="polite"
        >
          {(isPending || uploadBusy) && !error?.trim() ? (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-500 dark:text-teal-400"
              aria-hidden
            />
          ) : null}
          <span>{error?.trim() || uploadMsg?.trim() || STATUS_HINT[status]}</span>
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
    </>
  );
}
