"use client";

/**
 * useGeminiLive — direct Gemini Live WebSocket (MyTutor /teacher parity).
 * No localhost proxy; audio goes browser ↔ Google with ephemeral token from API.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { AudioPlayer } from "@/lib/gemini/AudioPlayer";
import { AudioStreamer } from "@/lib/gemini/AudioStreamer";
import { GeminiLiveClient } from "@/lib/gemini/GeminiLiveClient";
import { VideoStreamer, type VideoSource } from "@/lib/gemini/VideoStreamer";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "error";

export interface TranscriptTurn {
  role: "user" | "model";
  text: string;
  ts: number;
}

export interface GeminiLiveConfig {
  voice?: string;
  sessionId?: string;
  kbName?: string;
  proactivePrompt?: string;
}

export interface GeminiLiveHook {
  status: VoiceStatus;
  transcript: TranscriptTurn[];
  activeModel: string | null;
  error: string | null;
  isSupported: boolean;
  videoSource: VideoSource | null;
  videoPreviewRef: RefObject<HTMLVideoElement | null>;
  startSession: (config?: GeminiLiveConfig) => Promise<void>;
  stopSession: () => void;
  startVideo: (source: VideoSource, captureFps?: number) => Promise<void>;
  stopVideo: () => void;
  interrupt: () => void;
  sendText: (text: string) => void;
  clearTranscript: () => void;
}

const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const MAX_RECONNECT = 3;
/** MyTutor /teacher: hidden warmup turn so the first real user speech is not model-cold. */
const LIVE_GREET_SIGNAL = "__GREET_USER__";
const LIVE_GREET_DELAY_MS = 700;

function isHiddenLiveSignal(text: string): boolean {
  return text.trim() === LIVE_GREET_SIGNAL;
}

function appendTranscriptTurn(
  prev: TranscriptTurn[],
  role: "user" | "model",
  text: string,
): TranscriptTurn[] {
  const trimmed = text.trim();
  if (!trimmed) return prev;
  const last = prev[prev.length - 1];
  if (last && last.role === role && Date.now() - last.ts < 15_000) {
    const merged =
      trimmed.length >= last.text.length &&
      trimmed.startsWith(last.text.slice(0, Math.min(last.text.length, 32)))
        ? trimmed
        : `${last.text} ${trimmed}`.trim();
    return [...prev.slice(0, -1), { role, text: merged, ts: Date.now() }];
  }
  return [...prev, { role, text: trimmed, ts: Date.now() }];
}

function buildRecentContext(turns: TranscriptTurn[]): string {
  return turns
    .slice(-12)
    .map((t) => `${t.role === "user" ? "Student" : "Tutor"}: ${t.text}`)
    .join("\n");
}

export function useGeminiLive(): GeminiLiveHook {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<GeminiLiveClient | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const videoStreamerRef = useRef<VideoStreamer | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const configRef = useRef<GeminiLiveConfig>({});
  const stopRequestedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const resumptionHandleRef = useRef<string | null>(null);
  const connectInFlightRef = useRef(false);
  const liveGreetSentRef = useRef(false);
  const videoSourceRef = useRef<VideoSource | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof WebSocket !== "undefined" &&
      !!navigator?.mediaDevices?.getUserMedia &&
      !!navigator?.mediaDevices?.getDisplayMedia &&
      !!(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) &&
      window.isSecureContext
    );
  }, []);

  const stopVideo = useCallback(() => {
    videoStreamerRef.current?.stop();
    videoStreamerRef.current = null;
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    setVideoSource(null);
  }, []);

  const addTranscript = useCallback((role: "user" | "model", text: string) => {
    if (role === "user" && isHiddenLiveSignal(text)) return;
    transcriptRef.current = appendTranscriptTurn(transcriptRef.current, role, text);
    setTranscript([...transcriptRef.current]);
  }, []);

  const tearDown = useCallback((opts?: { keepVideo?: boolean }) => {
    if (!opts?.keepVideo) {
      stopVideo();
    }
    streamerRef.current?.stop();
    streamerRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, [stopVideo]);

  const startVideo = useCallback(
    async (source: VideoSource, captureFps?: number) => {
      if (!clientRef.current) {
        setError("Start Live before sharing camera or screen.");
        return;
      }
      const fps = captureFps ?? 1;
      try {
        stopVideo();
        const streamer = new VideoStreamer();
        await streamer.start(
          source,
          (frame) => clientRef.current?.sendImage(frame),
          videoPreviewRef.current,
          fps,
          () => {
            videoSourceRef.current = null;
            setVideoSource(null);
          },
        );
        videoStreamerRef.current = streamer;
        videoSourceRef.current = source;
        setVideoSource(source);
        setError(null);
      } catch (err) {
        stopVideo();
        setError(err instanceof Error ? err.message : "Could not start video");
      }
    },
    [stopVideo],
  );

  const connectLive = useCallback(
    async (cfg: GeminiLiveConfig, startMic: boolean) => {
      if (connectInFlightRef.current) return;
      connectInFlightRef.current = true;
      const voice = cfg.voice ?? "Aoede";

      try {
        playerRef.current?.destroy();
        const player = new AudioPlayer();
        const tokenPromise = apiFetch(apiUrl("/api/v1/gemini-live/token"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voice,
            session_id: cfg.sessionId,
            recent_context: buildRecentContext(transcriptRef.current),
          }),
        });

        const [, tokenRes] = await Promise.all([player.init(), tokenPromise]);
        if (!tokenRes.ok) {
          const err = await tokenRes.json().catch(() => ({}));
          throw new Error((err as { detail?: string }).detail || `Token failed: ${tokenRes.status}`);
        }
        const { token, model } = (await tokenRes.json()) as {
          token: string;
          model?: string;
        };
        const liveModel = model || DEFAULT_LIVE_MODEL;
        setActiveModel(liveModel);
        playerRef.current = player;

        const scheduleLiveGreet = () => {
          if (liveGreetSentRef.current || stopRequestedRef.current) return;
          if (transcriptRef.current.length > 0) return;
          if (cfg.proactivePrompt?.trim()) return;
          liveGreetSentRef.current = true;
          window.setTimeout(() => {
            if (!stopRequestedRef.current && clientRef.current) {
              clientRef.current.sendText(LIVE_GREET_SIGNAL);
            }
          }, LIVE_GREET_DELAY_MS);
        };

        const client = new GeminiLiveClient({
          onReady: async () => {
            reconnectAttemptsRef.current = 0;
            setStatus("listening");
            if (startMic) {
              await player.resume();
              const streamer = new AudioStreamer();
              await streamer.start((chunk) => clientRef.current?.sendAudio(chunk));
              streamerRef.current = streamer;
            }
            scheduleLiveGreet();
          },
          onAudioChunk: (b64) => {
            playerRef.current?.playChunk(b64);
            setStatus("speaking");
          },
          onInterrupted: () => {
            playerRef.current?.interrupt();
            setStatus("listening");
          },
          onTurnComplete: () => setStatus("listening"),
          onInputTranscript: (text) => addTranscript("user", text),
          onOutputTranscript: (text) => addTranscript("model", text),
          onResumptionUpdate: (u) => {
            if (u.newHandle) resumptionHandleRef.current = u.newHandle;
          },
          onGoAway: () => {
            if (!stopRequestedRef.current && reconnectAttemptsRef.current < MAX_RECONNECT) {
              reconnectAttemptsRef.current += 1;
              setStatus("reconnecting");
              tearDown();
              setTimeout(() => {
                if (!stopRequestedRef.current) {
                  void connectLive(cfg, true);
                }
              }, 2000);
            }
          },
          onError: (err) => {
            if (!stopRequestedRef.current) {
              setError(err.message);
              setStatus("error");
            }
          },
          onClose: (info) => {
            if (stopRequestedRef.current) return;
            if (
              reconnectAttemptsRef.current < MAX_RECONNECT &&
              resumptionHandleRef.current &&
              info.code !== 1000
            ) {
              reconnectAttemptsRef.current += 1;
              setStatus("reconnecting");
              tearDown({ keepVideo: !!videoSourceRef.current });
              setTimeout(() => {
                if (!stopRequestedRef.current) void connectLive(cfg, true);
              }, 500);
            }
          },
        });

        clientRef.current = client;
        await client.connect(token, {
          model: liveModel,
          voiceName: voice,
          sessionResumptionHandle: resumptionHandleRef.current,
        });
      } finally {
        connectInFlightRef.current = false;
      }
    },
    [addTranscript, tearDown],
  );

  const startSession = useCallback(
    async (cfg: GeminiLiveConfig = {}) => {
      configRef.current = cfg;
      stopRequestedRef.current = false;
      reconnectAttemptsRef.current = 0;
      liveGreetSentRef.current = false;

      if (!window.isSecureContext) {
        setError("Live Voice requires HTTPS.");
        setStatus("error");
        return;
      }

      setStatus("connecting");
      setError(null);
      tearDown();

      try {
        const cfgRes = await apiFetch(apiUrl("/api/v1/gemini-live/config"));
        const cfgData = await cfgRes.json();
        if (!cfgData.enabled) {
          setError("Gemini Live is not configured. Add GEMINI_API_KEY in Settings.");
          setStatus("error");
          return;
        }

        await connectLive(cfg, true);

        if (cfg.proactivePrompt?.trim()) {
          liveGreetSentRef.current = true;
          clientRef.current?.sendText(cfg.proactivePrompt.trim());
        }
      } catch (e: unknown) {
        tearDown();
        setError(e instanceof Error ? e.message : "Failed to start session");
        setStatus("error");
      }
    },
    [connectLive, tearDown],
  );

  const stopSession = useCallback(() => {
    stopRequestedRef.current = true;
    tearDown();
    setStatus("idle");
    setActiveModel(null);
    setError(null);
  }, [tearDown]);

  const interrupt = useCallback(() => {
    playerRef.current?.interrupt();
    setStatus("listening");
  }, []);

  const sendText = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!isHiddenLiveSignal(t)) addTranscript("user", t);
    clientRef.current?.sendText(t);
  }, [addTranscript]);

  const clearTranscript = useCallback(() => {
    transcriptRef.current = [];
    setTranscript([]);
    liveGreetSentRef.current = false;
  }, []);

  useEffect(() => () => {
    stopRequestedRef.current = true;
    tearDown();
  }, [tearDown]);

  return {
    status,
    transcript,
    activeModel,
    error,
    isSupported,
    videoSource,
    videoPreviewRef,
    startSession,
    stopSession,
    startVideo,
    stopVideo,
    interrupt,
    sendText,
    clearTranscript,
  };
}

export type { VideoSource };
