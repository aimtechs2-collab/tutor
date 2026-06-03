"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, Send, Square } from "lucide-react";
import { BotStreamThinking } from "@/components/agents/BotStreamThinking";
import { apiFetch, apiUrl, wsUrl } from "@/lib/api";
import { firstParam } from "@/lib/route-params";
import AssistantResponse from "@/components/common/AssistantResponse";
import { SimpleComposerInput } from "@/components/chat/home/SimpleComposerInput";
import { downloadChatMarkdown } from "@/lib/chat-export";
import {
  normalizeMessageContent,
  type RawMessageContent,
} from "@/lib/message-content";
import type { MessageItem } from "@/context/UnifiedChatContext";
import type {
  NotebookSaveMessage,
  NotebookSavePayload,
} from "@/components/notebook/SaveToNotebookModal";

const SaveToNotebookModal = dynamic(
  () => import("@/components/notebook/SaveToNotebookModal"),
  { ssr: false },
);

interface BotInfo {
  bot_id: string;
  name: string;
  running: boolean;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  thinking?: string[];
}

export default function BotChatPage() {
  const params = useParams<{ botId?: string | string[] }>();
  const botId = firstParam(params?.botId);
  const router = useRouter();
  const { t } = useTranslation();

  const [bot, setBot] = useState<BotInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamDraft, setStreamDraft] = useState("");
  const [streamPaused, setStreamPaused] = useState(false);
  const [thinking, setThinking] = useState<string[]>([]);
  const thinkingRef = useRef<string[]>([]);
  const streamDraftRef = useRef("");
  const renderDraftRef = useRef("");
  const renderQueueRef = useRef("");
  const renderPumpRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamChunkBufferRef = useRef("");
  const streamFlushRafRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);

  const exportTitle = useMemo(() => {
    const firstUser = messages
      .find((m) => m.role === "user")
      ?.content.trim()
      .slice(0, 80);
    return firstUser || bot?.name || botId || "Bot Chat";
  }, [bot?.name, botId, messages]);

  const exportMessages = useMemo<MessageItem[]>(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages],
  );

  const notebookSaveMessages = useMemo<NotebookSaveMessage[]>(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages],
  );

  const notebookSavePayload = useMemo<NotebookSavePayload | null>(() => {
    if (!messages.length) return null;
    return {
      recordType: "tutorbot",
      title: exportTitle,
      // SaveToNotebookModal rebuilds userQuery / output from the user's
      // selected message subset; we just need a non-null payload here.
      userQuery: "",
      output: "",
      metadata: {
        source: "agent_chat",
        bot_id: botId ?? null,
        bot_name: bot?.name ?? null,
        total_message_count: messages.length,
      },
    };
  }, [bot?.name, botId, exportTitle, messages.length]);

  const handleDownloadMarkdown = useCallback(() => {
    if (!exportMessages.length) return;
    downloadChatMarkdown(exportMessages, { title: exportTitle });
  }, [exportMessages, exportTitle]);

  const handleCloseSaveModal = useCallback(() => setShowSaveModal(false), []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior,
      });
    });
  }, []);

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }, []);

  const stopRenderPump = useCallback(() => {
    if (renderPumpRef.current) {
      clearInterval(renderPumpRef.current);
      renderPumpRef.current = null;
    }
  }, []);

  const flushRenderToFull = useCallback(() => {
    stopRenderPump();
    renderQueueRef.current = "";
    renderDraftRef.current = streamDraftRef.current;
    setStreamDraft(renderDraftRef.current);
  }, [stopRenderPump]);

  const ensureRenderPump = useCallback(() => {
    if (renderPumpRef.current) return;
    renderPumpRef.current = setInterval(() => {
      const queued = renderQueueRef.current;
      if (!queued) {
        if (!streaming) stopRenderPump();
        return;
      }
      const take =
        queued.length > 500 ? 24 : queued.length > 220 ? 14 : 8;
      const chunk = queued.slice(0, take);
      renderQueueRef.current = queued.slice(take);
      renderDraftRef.current += chunk;
      setStreamDraft(renderDraftRef.current);
      scrollToBottom("auto");
    }, 18);
  }, [scrollToBottom, stopRenderPump, streaming]);

  const enqueueRenderChunk = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      renderQueueRef.current += chunk;
      ensureRenderPump();
    },
    [ensureRenderPump],
  );

  const queuePauseIndicator = useCallback(() => {
    clearPauseTimer();
    pauseTimerRef.current = setTimeout(() => {
      setStreamPaused(true);
      scrollToBottom("auto");
      pauseTimerRef.current = null;
    }, 140);
  }, [clearPauseTimer, scrollToBottom]);

  const flushBufferedStream = useCallback(
    (force = false) => {
      if (!force && streamFlushRafRef.current !== null) return;
      const run = () => {
        streamFlushRafRef.current = null;
        const chunk = streamChunkBufferRef.current;
        if (!chunk) return;
        streamChunkBufferRef.current = "";
        streamDraftRef.current += chunk;
        enqueueRenderChunk(chunk);
        setStreamPaused(false);
      };
      if (force) {
        run();
      } else {
        streamFlushRafRef.current = requestAnimationFrame(run);
      }
    },
    [enqueueRenderChunk],
  );

  useEffect(() => {
    if (!botId) {
      return;
    }
    let cancelled = false;
    // Clear stale transcript immediately when navigating between bots.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setThinking([]);
    thinkingRef.current = [];
    streamChunkBufferRef.current = "";
    renderQueueRef.current = "";
    renderDraftRef.current = "";
    stopRenderPump();
    if (streamFlushRafRef.current !== null) {
      cancelAnimationFrame(streamFlushRafRef.current);
      streamFlushRafRef.current = null;
    }
    clearPauseTimer();
    streamDraftRef.current = "";
    setStreamDraft("");
    setStreamPaused(false);
    setStreaming(false);

    apiFetch(apiUrl(`/api/v1/tutorbot/${botId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setBot(data);
      })
      .catch(() => {
        if (!cancelled) setBot(null);
      });

    apiFetch(apiUrl(`/api/v1/tutorbot/${botId}/history`))
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          history: {
            role: string;
            content: RawMessageContent;
            reasoning_content?: unknown;
          }[],
        ) => {
          const restored: ChatMsg[] = history
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: normalizeMessageContent(m.content),
            }));
          if (cancelled) return;
          setMessages(restored);
          if (restored.length) {
            requestAnimationFrame(() => scrollToBottom("instant"));
            window.setTimeout(() => scrollToBottom("instant"), 80);
            window.setTimeout(() => scrollToBottom("instant"), 250);
          }
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [botId, scrollToBottom]);

  useEffect(() => {
    if (!botId) {
      return;
    }
    const ws = new WebSocket(wsUrl(`/api/v1/tutorbot/${botId}/ws`));
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "stream_start") {
        clearPauseTimer();
        streamChunkBufferRef.current = "";
        renderQueueRef.current = "";
        renderDraftRef.current = "";
        stopRenderPump();
        if (streamFlushRafRef.current !== null) {
          cancelAnimationFrame(streamFlushRafRef.current);
          streamFlushRafRef.current = null;
        }
        streamDraftRef.current = "";
        setStreamDraft("");
        setStreamPaused(false);
        thinkingRef.current = [];
        setThinking([]);
        scrollToBottom("auto");
      } else if (data.type === "delta") {
        const chunk = String(data.content || "");
        if (!chunk) return;
        clearPauseTimer();
        streamChunkBufferRef.current += chunk;
        flushBufferedStream();
      } else if (data.type === "stream_pause") {
        queuePauseIndicator();
      } else if (data.type === "thinking") {
        clearPauseTimer();
        flushBufferedStream(true);
        thinkingRef.current = [...thinkingRef.current, data.content];
        setThinking([...thinkingRef.current]);
        queuePauseIndicator();
      } else if (data.type === "content") {
        clearPauseTimer();
        flushBufferedStream(true);
        flushRenderToFull();
        const snap = thinkingRef.current;
        const finalText =
          String(data.content || "") || streamDraftRef.current;
        setMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: finalText,
            thinking: snap.length ? [...snap] : undefined,
          },
        ]);
        streamDraftRef.current = "";
        setStreamDraft("");
        setStreamPaused(false);
        thinkingRef.current = [];
        setThinking([]);
        scrollToBottom("auto");
      } else if (data.type === "done") {
        clearPauseTimer();
        flushBufferedStream(true);
        flushRenderToFull();
        setStreaming(false);
        streamDraftRef.current = "";
        renderDraftRef.current = "";
        renderQueueRef.current = "";
        setStreamDraft("");
        setStreamPaused(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      } else if (data.type === "stopped") {
        clearPauseTimer();
        flushBufferedStream(true);
        flushRenderToFull();
        const partial = streamDraftRef.current;
        const snap = thinkingRef.current;
        if (partial) {
          setMessages((msgs) => [
            ...msgs,
            {
              role: "assistant",
              content: partial,
              thinking: snap.length ? [...snap] : undefined,
            },
          ]);
        }
        streamDraftRef.current = "";
        renderDraftRef.current = "";
        renderQueueRef.current = "";
        setStreamDraft("");
        setStreamPaused(false);
        thinkingRef.current = [];
        setThinking([]);
        setStreaming(false);
        setTimeout(() => inputRef.current?.focus(), 50);
        scrollToBottom("auto");
      } else if (data.type === "proactive") {
        clearPauseTimer();
        flushBufferedStream(true);
        flushRenderToFull();
        setMessages((msgs) => [
          ...msgs,
          { role: "assistant", content: data.content },
        ]);
        scrollToBottom("auto");
      } else if (data.type === "error") {
        clearPauseTimer();
        flushBufferedStream(true);
        flushRenderToFull();
        const partial = streamDraftRef.current;
        setMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: partial
              ? `${partial}\n\nError: ${data.content}`
              : `Error: ${data.content}`,
          },
        ]);
        streamDraftRef.current = "";
        renderDraftRef.current = "";
        renderQueueRef.current = "";
        setStreamDraft("");
        setStreamPaused(false);
        thinkingRef.current = [];
        setThinking([]);
        setStreaming(false);
      }
    };

    ws.onclose = () => {
      clearPauseTimer();
      flushBufferedStream(true);
      flushRenderToFull();
      setStreaming(false);
    };

    return () => {
      clearPauseTimer();
      stopRenderPump();
      if (streamFlushRafRef.current !== null) {
        cancelAnimationFrame(streamFlushRafRef.current);
        streamFlushRafRef.current = null;
      }
      ws.close();
      wsRef.current = null;
    };
  }, [
    botId,
    clearPauseTimer,
    flushRenderToFull,
    flushBufferedStream,
    queuePauseIndicator,
    scrollToBottom,
    stopRenderPump,
  ]);

  const handleSend = useCallback(
    (content: string) => {
      if (
        !botId ||
        streaming ||
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN
      )
        return;

      setMessages((msgs) => [...msgs, { role: "user", content }]);
      setStreaming(true);
      streamDraftRef.current = "";
      setStreamDraft("");
      setStreamPaused(false);
      setThinking([]);
      thinkingRef.current = [];
      wsRef.current.send(JSON.stringify({ content }));
      scrollToBottom("auto");
    },
    [botId, streaming, scrollToBottom],
  );

  const handleManualSend = useCallback(() => {
    const content = inputRef.current?.value.trim();
    if (content) {
      handleSend(content);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [handleSend]);

  const handleStop = useCallback(() => {
    if (!streaming || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "stop" }));
  }, [streaming]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <button
          onClick={() => router.push("/agents")}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Bot className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span className="text-[14px] font-medium text-[var(--foreground)]">
          {bot?.name ?? botId}
        </span>
        {bot?.running && (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowSaveModal(true)}
            disabled={!notebookSavePayload}
            className="rounded-lg border border-[var(--border)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)]/50 disabled:hover:text-[var(--muted-foreground)]"
          >
            {t("Save to Notebook")}
          </button>
          <button
            onClick={handleDownloadMarkdown}
            disabled={!messages.length}
            title={t("Download chat history as Markdown")}
            className="rounded-lg border border-[var(--border)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)]/50 disabled:hover:text-[var(--muted-foreground)]"
          >
            {t("Download Markdown")}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-6 [scrollbar-gutter:stable]"
      >
        <div className="mx-auto max-w-[720px] space-y-5">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center pt-24 text-center">
              <div className="mb-3 rounded-xl bg-[var(--muted)] p-3 text-[var(--muted-foreground)]">
                <Bot size={22} />
              </div>
              <p className="text-[14px] font-medium text-[var(--foreground)]">
                {t("Chat with {{name}}", { name: bot?.name ?? botId })}
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
                {t("Send a message to start the conversation.")}
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={msg.role === "user" ? "flex justify-end" : ""}
            >
              {msg.role === "user" ? (
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--primary)] px-4 py-2.5 text-[14px] text-[var(--primary-foreground)]">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-full">
                  {msg.thinking && msg.thinking.length > 0 && (
                    <details className="mb-2">
                      <summary className="cursor-pointer text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        {t("Thinking ({{count}} steps)", {
                          count: msg.thinking.length,
                        })}
                      </summary>
                      <div className="mt-1 space-y-1 border-l-2 border-[var(--border)] pl-3">
                        {msg.thinking.map((th, j) => (
                          <p
                            key={j}
                            className="text-[12px] text-[var(--muted-foreground)]"
                          >
                            {th}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  <AssistantResponse content={msg.content} />
                </div>
              )}
            </div>
          ))}

          {/* Live streaming assistant turn */}
          {streaming && (
            <div className="max-w-full space-y-2">
              {streamDraft ? (
                <AssistantResponse content={streamDraft} />
              ) : null}
              {streamPaused && thinking.length > 0 && (
                <details open className="mb-1">
                  <summary className="cursor-pointer text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    {t("Thinking ({{count}} steps)", { count: thinking.length })}
                  </summary>
                  <div className="mt-1 space-y-1 border-l-2 border-[var(--border)] pl-3">
                    {thinking.map((th, i) => (
                      <p
                        key={i}
                        className="text-[12px] text-[var(--muted-foreground)]"
                      >
                        {th}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              {streamPaused || (!streamDraft && thinking.length === 0) ? (
                <BotStreamThinking
                  label={
                    thinking.length > 0 ? t("Working...") : undefined
                  }
                />
              ) : (
                <span
                  className="inline-block h-4 w-0.5 animate-pulse bg-[var(--primary)]"
                  aria-hidden
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] px-5 py-3">
        <div className="mx-auto flex max-w-[720px] items-end gap-2">
          <SimpleComposerInput
            textareaRef={inputRef}
            onSend={handleSend}
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="group relative flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_4px_12px_color-mix(in_srgb,var(--primary)_18%,transparent)] transition-opacity hover:opacity-90"
              aria-label={t("Stop generating")}
              title={t("Stop generating")}
            >
              <span className="pointer-events-none absolute inset-0 rounded-xl border-2 border-white/30 border-t-white/85 animate-spin opacity-90 transition-opacity group-hover:opacity-40" />
              <Square size={14} strokeWidth={2.6} className="relative z-10 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleManualSend}
              className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
              aria-label={t("Send message")}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <SaveToNotebookModal
        open={showSaveModal}
        payload={notebookSavePayload}
        messages={notebookSaveMessages}
        onClose={handleCloseSaveModal}
      />
    </div>
  );
}
