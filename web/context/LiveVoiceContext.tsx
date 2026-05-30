"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  useGeminiLive,
  type GeminiLiveHook,
  type TranscriptTurn,
  type VideoSource,
} from "@/hooks/useGeminiLive";

interface LiveVoiceContextValue extends GeminiLiveHook {
  endLive: () => void | Promise<void>;
}

const LiveVoiceContext = createContext<LiveVoiceContextValue | null>(null);

export function useLiveVoice(): LiveVoiceContextValue {
  const ctx = useContext(LiveVoiceContext);
  if (!ctx) {
    throw new Error("useLiveVoice must be used within LiveVoiceProvider");
  }
  return ctx;
}

export function useLiveVoiceOptional(): LiveVoiceContextValue | null {
  return useContext(LiveVoiceContext);
}

interface LiveVoiceProviderProps {
  active: boolean;
  sessionId?: string;
  kbName?: string;
  defaultVoice?: string;
  autoStart?: boolean;
  /** Called before UI closes; persist transcript to chat history. */
  onPersistTranscript?: (turns: TranscriptTurn[]) => void | Promise<void>;
  onEnd: () => void;
  children: ReactNode;
}

export function LiveVoiceProvider({
  active,
  sessionId,
  kbName,
  defaultVoice = "Aoede",
  autoStart = true,
  onPersistTranscript,
  onEnd,
  children,
}: LiveVoiceProviderProps) {
  const live = useGeminiLive();
  const autoStartDoneRef = useRef(false);

  const handleStart = useCallback(async () => {
    await live.startSession({
      voice: defaultVoice,
      sessionId,
      kbName,
    });
  }, [live, defaultVoice, sessionId, kbName]);

  const persistAndStop = useCallback(async () => {
    const turns = [...live.transcript];
    live.stopVideo();
    live.stopSession();
    if (turns.length > 0) {
      try {
        await onPersistTranscript?.(turns);
      } catch (err) {
        console.error("Failed to persist live transcript", err);
      }
    }
    live.clearTranscript();
  }, [live, onPersistTranscript]);

  useEffect(() => {
    if (!active) {
      autoStartDoneRef.current = false;
      if (live.status !== "idle") {
        void persistAndStop();
      }
      return;
    }
    if (!autoStart || autoStartDoneRef.current) return;
    autoStartDoneRef.current = true;
    if (live.status === "idle" && !live.error) void handleStart();
  }, [active, autoStart, live.status, live.error, handleStart, live, persistAndStop]);

  const endLive = useCallback(() => {
    onEnd();
  }, [onEnd]);

  const value: LiveVoiceContextValue = {
    ...live,
    endLive,
  };

  return (
    <LiveVoiceContext.Provider value={value}>
      {children}
    </LiveVoiceContext.Provider>
  );
}

export type { TranscriptTurn, VideoSource };
