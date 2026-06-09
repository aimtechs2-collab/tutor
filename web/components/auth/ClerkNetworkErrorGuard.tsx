"use client";

import { useEffect } from "react";
import { notify } from "@/lib/notifications";

function isClerkNetworkFailure(reason: unknown): boolean {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  if (!message.includes("ClerkJS")) return false;
  return (
    message.includes("Network error") ||
    message.includes("Failed to fetch") ||
    message.includes("Load failed")
  );
}

/**
 * Clerk periodically "touches" the session against clerk.accounts.dev.
 * A brief offline blip, VPN hiccup, or ad-blocker can make that fetch fail;
 * Clerk throws an unhandled rejection that Next.js surfaces as a runtime
 * crash even though the app is otherwise fine. Swallow those transient
 * failures and nudge the user once instead of bricking the page.
 */
export function ClerkNetworkErrorGuard() {
  useEffect(() => {
    let lastToastAt = 0;

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!isClerkNetworkFailure(event.reason)) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastToastAt > 60_000) {
        lastToastAt = now;
        notify(
          "Sign-in service is temporarily unreachable. Check your connection, then refresh if things stop working.",
          { tone: "error", durationMs: 8000 },
        );
      }
    };

    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  return null;
}
