"use client";

import { useEffect, useRef, useState } from "react";
import { ensureClerkScript } from "@/components/auth/ClerkAuthBridge";

type ClerkJs = {
  load?: (options?: {
    publishableKey?: string;
    ui?: { ClerkUI?: unknown };
  }) => Promise<void>;
  mountSignIn?: (node: HTMLDivElement, props?: Record<string, unknown>) => void;
  mountSignUp?: (node: HTMLDivElement, props?: Record<string, unknown>) => void;
  unmountSignIn?: (node: HTMLDivElement) => void;
  unmountSignUp?: (node: HTMLDivElement) => void;
};

declare global {
  interface Window {
    __internal_ClerkUICtor?: unknown;
    Clerk?: ClerkJs;
  }
}

const appearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorBackground: "var(--card)",
    colorText: "var(--foreground)",
    fontFamily: "inherit",
  },
  elements: {
    card: "shadow-none border border-[var(--border)] rounded-xl",
    formButtonPrimary: "bg-[var(--primary)] hover:opacity-90",
  },
};

function AuthLoading({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-8 py-6 text-sm text-[var(--muted-foreground)]">
      {label}
    </div>
  );
}

export function ClerkAuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";

  useEffect(() => {
    let cancelled = false;
    const node = mountRef.current;
    if (!node) return;

    const mount = async () => {
      for (let i = 0; i < 100 && !window.Clerk; i++) {
        if (publishableKey) await ensureClerkScript(publishableKey).catch(() => {});
        if (window.Clerk) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (cancelled) return;
      const clerk = window.Clerk;
      if (!clerk) {
        setError("Clerk failed to load. Check the publishable key and network access.");
        return;
      }
      await clerk.load?.({
        publishableKey,
        ui: { ClerkUI: window.__internal_ClerkUICtor },
      });
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const redirectUrl = params.get("redirect_url") || params.get("next") || "/chat";
      const props = {
        appearance,
        afterSignInUrl: redirectUrl,
        afterSignUpUrl: redirectUrl,
        signInUrl: "/sign-in",
        signUpUrl: "/sign-up",
      };
      node.replaceChildren();
      if (mode === "sign-in") {
        clerk.mountSignIn?.(node, props);
      } else {
        clerk.mountSignUp?.(node, props);
      }
    };

    void mount();
    return () => {
      cancelled = true;
      if (mode === "sign-in") {
        window.Clerk?.unmountSignIn?.(node);
      } else {
        window.Clerk?.unmountSignUp?.(node);
      }
    };
  }, [mode]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-8 py-6 text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div ref={mountRef} className="min-w-[22rem]">
      <AuthLoading label={mode === "sign-in" ? "Loading sign in..." : "Loading sign up..."} />
    </div>
  );
}
