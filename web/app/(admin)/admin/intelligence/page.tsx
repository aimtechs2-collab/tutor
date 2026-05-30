"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, Loader2, SendHorizontal } from "lucide-react";
import SimpleMarkdownRenderer from "@/components/common/SimpleMarkdownRenderer";
import { notify } from "@/lib/notifications";
import {
  sendAdminAgentMessage,
  type AdminAgentChatMessage,
} from "@/lib/admin-agent-api";

type PromptCategory = {
  label: string;
  prompts: string[];
};

const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    label: "Analytics",
    prompts: [
      "What happened today?",
      "AI cost this month?",
      "Plan profit margins?",
    ],
  },
  {
    label: "Users",
    prompts: [
      "Most active users",
      "Inactive 14+ days",
      "Users likely to cancel",
    ],
  },
  {
    label: "Issues",
    prompts: [
      "Flagged conversations today",
      "Quota violations",
      "Risk flags",
    ],
  },
];

export default function AdminIntelligencePage() {
  const [messages, setMessages] = useState<AdminAgentChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const nextHistory = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(nextHistory);
      setInput("");
      setLoading(true);

      try {
        const result = await sendAdminAgentMessage(trimmed, messages);
        setMessages([
          ...nextHistory,
          { role: "assistant", content: result.response },
        ]);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Agent request failed", {
          tone: "error",
        });
        setMessages(messages);
        setInput(trimmed);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages],
  );

  function handlePromptClick(prompt: string) {
    setInput(prompt);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <div className="border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-center gap-2">
          <BrainCircuit size={20} className="text-[var(--primary)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">Intelligence</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Ask questions about users, revenue, AI costs, and platform risk
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--card)] p-4 lg:w-[35%] lg:border-b-0 lg:border-r">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Suggested prompts
          </h2>
          <div className="space-y-4">
            {PROMPT_CATEGORIES.map((category) => (
              <div key={category.label}>
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">{category.label}</p>
                <div className="grid gap-2">
                  {category.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handlePromptClick(prompt)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-left text-sm text-[var(--foreground)] transition-colors hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_6%,var(--background))]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col lg:w-[65%]">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {messages.length === 0 && !loading ? (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
                Pick a suggested prompt or ask anything about the platform.
              </div>
            ) : null}

            {messages.map((message, index) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                      isUser
                        ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-[var(--foreground)]"
                        : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <SimpleMarkdownRenderer content={message.content} />
                    )}
                  </div>
                </div>
              );
            })}

            {loading ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  <Loader2 size={14} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-[var(--border)] bg-[var(--card)] px-6 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(input);
            }}
          >
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={3}
                placeholder="Ask about users, revenue, AI costs, or risk…"
                className="min-h-[84px] flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit(input);
                  }
                }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                Ask
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
