"use client";

import { useEffect } from "react";
import { apiFetch, apiUrl } from "@/lib/api";

export function useHeartbeat(intervalMs = 30_000) {
  useEffect(() => {
    const ping = () => {
      // Update last_active via auth status check
      apiFetch(apiUrl("/api/v1/auth/status")).catch(() => {});
      // Update presence indicator
      apiFetch(apiUrl("/api/v1/presence/ping"), { method: "POST" }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
