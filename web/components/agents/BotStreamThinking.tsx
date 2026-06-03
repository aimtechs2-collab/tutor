"use client";

import { useTranslation } from "react-i18next";

/** Shown when the model pauses mid-stream (tools / reasoning between chunks). */
export function BotStreamThinking({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t("Thinking");
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 flex items-center gap-2 text-[13px] text-[var(--muted-foreground)]"
    >
      <span className="dt-thinking-shimmer font-medium">{text}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
      </span>
    </div>
  );
}
