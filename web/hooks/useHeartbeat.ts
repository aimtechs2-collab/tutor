"use client";

/**
 * useHeartbeat — pings /api/v1/auth/me every 30s while the app is open.
 * Keeps the user's last_active timestamp fresh for presence tracking.
 */

import { useEffect } from "react";
import { apiFetch, apiUrl } from "@/lib/api";

export function useHeartbeat(intervalMs = 30_000) {
  useEffect(() => {
    let id: ReturnType<typeof setInterval>;

    const ping = () => {
      apiFetch(apiUrl("/api/v1/auth/me"), { method: "GET" }).catch(() => {});
    };

    ping();
    id = setInterval(ping, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
