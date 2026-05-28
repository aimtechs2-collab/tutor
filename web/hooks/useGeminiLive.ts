"use client";

/**
 * useGeminiLive — manages a full Gemini Live real-time voice session.
 *
 * Lifecycle:
 *   idle → connecting → listening ↔ speaking → idle
 *
 * Audio flow:
 *   Mic → AudioWorklet (or ScriptProcessorNode fallback) → 16 kHz Int16 PCM
 *   → base64 → WS → backend proxy → Gemini Live
 *   Gemini Live → backend proxy → WS → base64 → 24 kHz PCM → AudioContext queue
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsUrl, apiFetch } from "@/lib/api";

// ── types ──────────────────────────────────────────────────────────────────

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
  enableVideo?: boolean;
  enableAffectiveDialog?: boolean;
  proactivePrompt?: string;
}

export interface GeminiLiveHook {
  status: VoiceStatus;
  transcript: TranscriptTurn[];
  error: string | null;
  isSupported: boolean;
  startSession: (config?: GeminiLiveConfig) => Promise<void>;
  stopSession: () => void;
  interrupt: () => void;
  sendText: (text: string) => void;
  clearTranscript: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ── hook ───────────────────────────────────────────────────────────────────

export function useGeminiLive(): GeminiLiveHook {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const nextStartRef = useRef<number>(0);
  const reconnectAttemptsRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const configRef = useRef<GeminiLiveConfig>({});
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── support detection (stable, no deps) ────────────────────────────────
  const isSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof WebSocket !== "undefined" &&
      !!navigator?.mediaDevices?.getUserMedia &&
      !!(window.AudioContext || (window as any).webkitAudioContext) &&
      window.isSecureContext
    );
  }, []);

  // ── audio playback ─────────────────────────────────────────────────────
  const scheduleAudio = useCallback((pcm24khz: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const SAMPLE_RATE = 24000;
      const int16 = new Int16Array(pcm24khz);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const buf = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      buf.copyToChannel(float32, 0);
      audioQueueRef.current.push(buf);

      // Play next buffer in sequence
      const playNext = () => {
        const next = audioQueueRef.current.shift();
        if (!next || !audioCtxRef.current) return;
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = next;
        source.connect(audioCtxRef.current.destination);
        const start = Math.max(audioCtxRef.current.currentTime, nextStartRef.current);
        source.start(start);
        nextStartRef.current = start + next.duration;
        source.onended = () => {
          if (audioQueueRef.current.length > 0) playNext();
          else setStatus((s) => (s === "speaking" ? "listening" : s));
        };
        setStatus("speaking");
      };

      if (audioQueueRef.current.length === 1) playNext();
    } catch {
      // Non-fatal — audio chunk dropped
    }
  }, []);

  // ── WS message handler ─────────────────────────────────────────────────
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      switch (msg.type) {
        case "audio_chunk":
          scheduleAudio(base64ToArrayBuffer(msg.data));
          break;
        case "transcript":
          setTranscript((prev) => [
            ...prev,
            { role: msg.role, text: msg.text, ts: Date.now() },
          ]);
          break;
        case "turn_complete":
          setStatus("listening");
          break;
        case "tool_start":
          // Could show a "searching…" indicator — for now just log
          console.debug("[GeminiLive] tool_start:", msg.tool);
          break;
        case "tool_done":
          console.debug("[GeminiLive] tool_done:", msg.tool);
          break;
        case "info":
          console.info("[GeminiLive] info:", msg.message);
          break;
        case "ping":
          wsRef.current?.send(JSON.stringify({ type: "pong" }));
          break;
        case "error":
          setError(msg.message || "Session error");
          setStatus("error");
          break;
      }
    },
    [scheduleAudio],
  );

  // ── mic capture ────────────────────────────────────────────────────────
  const startMicCapture = useCallback(
    async (ctx: AudioContext, stream: MediaStream) => {
      const sourceNode = ctx.createMediaStreamSource(stream);
      let workletSupported = false;

      try {
        await ctx.audioWorklet.addModule("/audio-processor.worklet.js");
        workletSupported = true;
      } catch {
        console.warn("[GeminiLive] AudioWorklet unavailable, using ScriptProcessor");
      }

      const sendChunk = (int16: Int16Array) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "audio_chunk",
              data: arrayBufferToBase64(int16.buffer),
            }),
          );
        }
      };

      if (workletSupported) {
        const worklet = new AudioWorkletNode(ctx, "pcm-downsample-processor", {
          processorOptions: { inputSampleRate: ctx.sampleRate },
        });
        worklet.port.onmessage = (e) => {
          if (e.data?.type === "pcm_chunk") sendChunk(new Int16Array(e.data.buffer));
        };
        sourceNode.connect(worklet);
        workletNodeRef.current = worklet;
      } else {
        const { createScriptProcessorCapture } = await import(
          "@/lib/audio/scriptProcessorFallback"
        );
        scriptNodeRef.current = createScriptProcessorCapture(ctx, sourceNode, sendChunk);
      }
    },
    [],
  );

  // ── cleanup ────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    workletNodeRef.current?.port.postMessage({ type: "stop" });
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    scriptNodeRef.current?.disconnect();
    scriptNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioQueueRef.current = [];
    nextStartRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000);
      wsRef.current = null;
    }
  }, []);

  // ── open WS session ────────────────────────────────────────────────────
  const openSession = useCallback(
    async (token: string, expiresAt: string, cfg: GeminiLiveConfig) => {
      const params = new URLSearchParams({ token });
      if (cfg.sessionId) params.set("session_id", cfg.sessionId);
      if (cfg.kbName) params.set("kb", cfg.kbName);
      if (cfg.enableVideo) params.set("enable_video", "1");
      if (cfg.proactivePrompt) params.set("proactive_prompt", cfg.proactivePrompt);

      const url = wsUrl(`/api/v1/gemini-live/session?${params}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (e) => handleMessage(e.data);
      ws.onerror = () => {
        if (!stopRequestedRef.current) setError("Connection error");
      };
      ws.onclose = (e) => {
        if (stopRequestedRef.current) return;
        if (e.code === 4001 || e.code === 4003) {
          setError("Authentication failed");
          setStatus("error");
          return;
        }
        // Auto-reconnect up to 3 times
        if (reconnectAttemptsRef.current < 3) {
          reconnectAttemptsRef.current++;
          const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
          setStatus("reconnecting");
          setTimeout(() => {
            if (!stopRequestedRef.current) startSession(cfg);
          }, delay);
        } else {
          setError("Connection lost after 3 attempts");
          setStatus("error");
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        setTimeout(() => reject(new Error("WS connect timeout")), 10000);
      });

      // Schedule token refresh 30s before expiry
      const expiresMs = new Date(expiresAt).getTime() - Date.now() - 30_000;
      if (expiresMs > 0) {
        tokenRefreshTimerRef.current = setTimeout(async () => {
          if (stopRequestedRef.current) return;
          try {
            const res = await apiFetch("/api/v1/gemini-live/token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: "gemini-2.0-flash-live" }),
            });
            const data = await res.json();
            cleanup();
            await openSession(data.token, data.expires_at, cfg);
          } catch {
            // Token refresh failed — session will end naturally
          }
        }, expiresMs);
      }
    },
    [cleanup, handleMessage],
  );

  // ── startSession ───────────────────────────────────────────────────────
  const startSession = useCallback(
    async (cfg: GeminiLiveConfig = {}) => {
      configRef.current = cfg;
      stopRequestedRef.current = false;
      reconnectAttemptsRef.current = 0;

      if (!window.isSecureContext) {
        setError("Live Voice requires HTTPS. Please use a secure connection.");
        setStatus("error");
        return;
      }

      setStatus("connecting");
      setError(null);

      try {
        // 1. Check feature enabled
        const cfgRes = await apiFetch("/api/v1/gemini-live/config");
        const cfgData = await cfgRes.json();
        if (!cfgData.enabled) {
          setError("Gemini Live is not configured. Add GEMINI_API_KEY in Settings.");
          setStatus("error");
          return;
        }

        // 2. Get ephemeral token
        const tokenRes = await apiFetch("/api/v1/gemini-live/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: cfg.voice
              ? cfgData.models?.[0]?.id ?? "gemini-2.0-flash-live"
              : "gemini-2.0-flash-live",
            voice: cfg.voice ?? "Aoede",
            enable_affective_dialog: cfg.enableAffectiveDialog ?? false,
          }),
        });
        if (!tokenRes.ok) {
          const err = await tokenRes.json().catch(() => ({}));
          throw new Error(err.detail || `Token request failed: ${tokenRes.status}`);
        }
        const { token, expires_at } = await tokenRes.json();

        // 3. Mic access — MUST happen in this user-gesture context
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e: any) {
          if (e.name === "NotAllowedError") {
            throw new Error("Microphone access denied. Please allow mic access and try again.");
          }
          throw new Error("No microphone found. Connect a mic and try again.");
        }
        streamRef.current = stream;

        // 4. AudioContext — created inside user gesture (iOS Safari requirement)
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        if (ctx.state === "suspended") await ctx.resume();
        audioCtxRef.current = ctx;

        // 5. Open WS
        await openSession(token, expires_at, cfg);

        // 6. Start mic capture
        await startMicCapture(ctx, stream);

        setStatus("listening");
      } catch (e: any) {
        cleanup();
        setError(e.message || "Failed to start session");
        setStatus("error");
      }
    },
    [cleanup, openSession, startMicCapture],
  );

  // ── stopSession ────────────────────────────────────────────────────────
  const stopSession = useCallback(() => {
    stopRequestedRef.current = true;
    wsRef.current?.send(JSON.stringify({ type: "end_turn" }));
    cleanup();
    setStatus("idle");
    setError(null);
  }, [cleanup]);

  // ── interrupt ──────────────────────────────────────────────────────────
  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
    audioQueueRef.current = [];
    nextStartRef.current = audioCtxRef.current?.currentTime ?? 0;
    setStatus("listening");
  }, []);

  // ── sendText ───────────────────────────────────────────────────────────
  const sendText = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "text", content: text }));
  }, []);

  const clearTranscript = useCallback(() => setTranscript([]), []);

  // ── cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => () => cleanup(), [cleanup]);

  return {
    status,
    transcript,
    error,
    isSupported,
    startSession,
    stopSession,
    interrupt,
    sendText,
    clearTranscript,
  };
}
