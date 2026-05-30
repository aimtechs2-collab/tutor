"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __aimtutorGetClerkToken?: () => Promise<string | null>;
    __aimtutorClerkToken?: string;
    __clerk_publishable_key?: string;
    ClerkPublishableKey?: string;
    __internal_ClerkUICtor?: unknown;
    Clerk?: {
      load?: (options?: {
        publishableKey?: string;
        ui?: { ClerkUI?: unknown };
      }) => Promise<void>;
      session?: { getToken?: () => Promise<string | null> };
    };
  }
}

function loadScript(src: string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-aimtutor-clerk-asset='${marker}']`,
    );
    if (existing) {
      if (marker === "ui" && window.__internal_ClerkUICtor) {
        resolve();
        return;
      }
      if (marker === "clerk" && window.Clerk) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`${marker} script failed`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.async = false;
    script.crossOrigin = "anonymous";
    script.dataset.aimtutorClerkAsset = marker;
    script.src = src;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`${marker} script failed`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function ensureClerkScript(publishableKey: string): Promise<void> {
  window.__clerk_publishable_key = publishableKey;
  window.ClerkPublishableKey = publishableKey;
  return loadScript("/__clerk/ui.browser.js", "ui").then(() =>
    loadScript("/__clerk/clerk.browser.js", "clerk"),
  );
}

export function ClerkAuthBridge({ publishableKey }: { publishableKey: string }) {
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        await ensureClerkScript(publishableKey);
        await window.Clerk?.load?.({
          publishableKey,
          ui: { ClerkUI: window.__internal_ClerkUICtor },
        });
        const token = (await window.Clerk?.session?.getToken?.()) || null;
        if (!cancelled) window.__aimtutorClerkToken = token || undefined;
        return token;
      } catch {
        if (!cancelled) window.__aimtutorClerkToken = undefined;
        return null;
      }
    };

    window.__aimtutorGetClerkToken = refresh;
    void refresh();
    const id = window.setInterval(refresh, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.__aimtutorGetClerkToken = undefined;
      window.__aimtutorClerkToken = undefined;
    };
  }, [publishableKey]);

  return null;
}

export { ensureClerkScript };
