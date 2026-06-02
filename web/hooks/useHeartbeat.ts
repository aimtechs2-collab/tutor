"use client";

import { useEffect } from "react";
import { isPublicAuthPath } from "@/lib/auth-routes";
import { apiFetch, apiUrl } from "@/lib/api";

export function useHeartbeat(intervalMs = 30_000) {
  useEffect(() => {
    if (typeof window !== "undefined" && isPublicAuthPath(window.location.pathname)) {
      return;
    }
    const ping = () => {
      // Update last_active via auth status check
      apiFetch(apiUrl("/api/v1/auth/status")).catch(() => {});
      // Presence requires a session; skip on auth pages (handled above) and when unauthenticated
      apiFetch(apiUrl("/api/v1/presence/ping"), { method: "POST" }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
