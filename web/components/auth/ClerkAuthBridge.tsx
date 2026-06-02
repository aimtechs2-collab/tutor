"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

declare global {
  interface Window {
    __aimtutorGetClerkToken?: () => Promise<string | null>;
    __aimtutorClerkToken?: string;
  }
}

export function ClerkAuthBridge() {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const token = (await getToken()) || null;
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
  }, [getToken, isLoaded]);

  return null;
}
