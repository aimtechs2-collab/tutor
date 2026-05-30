"use client";

import { useCallback, type ComponentProps } from "react";
import ChatComposer from "@/components/chat/home/ChatComposer";
import { useLiveVoice } from "@/context/LiveVoiceContext";

type ChatComposerProps = ComponentProps<typeof ChatComposer>;

type LiveRoutedChatComposerProps = ChatComposerProps & {
  /** Route typed messages to Gemini Live instead of unified chat WS. */
  routeTextToLive?: boolean;
  /** Attachments, refs, or special caps — keep on normal chat path. */
  hasComposerExtras?: boolean;
  onLiveTextSent?: () => void;
};

/**
 * Wraps ChatComposer so text sent during an active Live session goes to
 * Gemini Live (same as MyTutor /teacher typed input).
 */
export default function LiveRoutedChatComposer({
  routeTextToLive = false,
  hasComposerExtras = false,
  onSend,
  onLiveTextSent,
  ...composerProps
}: LiveRoutedChatComposerProps) {
  const live = useLiveVoice();

  const isLiveSessionActive =
    live.status === "connecting" ||
    live.status === "listening" ||
    live.status === "speaking" ||
    live.status === "reconnecting";

  const routedSend = useCallback(
    (content: string) => {
      const trimmed = content.trim();

      if (
        routeTextToLive &&
        isLiveSessionActive &&
        trimmed &&
        !hasComposerExtras &&
        !composerProps.isStreaming
      ) {
        live.sendText(trimmed);
        onLiveTextSent?.();
        return;
      }

      onSend(content);
    },
    [
      routeTextToLive,
      isLiveSessionActive,
      hasComposerExtras,
      composerProps.isStreaming,
      live,
      onSend,
      onLiveTextSent,
    ],
  );

  return <ChatComposer {...composerProps} onSend={routedSend} />;
}
