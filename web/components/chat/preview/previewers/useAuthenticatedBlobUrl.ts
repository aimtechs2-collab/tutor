"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const CLERK_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export type AuthenticatedBlobState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; blobUrl: string }
  | { kind: "error"; message: string };

/**
 * Fetch a protected API URL with credentials and expose it as a blob: URL
 * suitable for <iframe src> / <img src> previews.
 */
export function useAuthenticatedBlobUrl(
  url: string | null,
): AuthenticatedBlobState {
  const [state, setState] = useState<AuthenticatedBlobState>({ kind: "idle" });
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!url) {
      setState({ kind: "idle" });
      return;
    }

    if (!AUTH_ENABLED && !CLERK_ENABLED) {
      setState({ kind: "ready", blobUrl: url });
      return;
    }

    if (url.startsWith("blob:") || url.startsWith("data:")) {
      setState({ kind: "ready", blobUrl: url });
      return;
    }

    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    setState({ kind: "loading" });

    (async () => {
      try {
        const res = await apiFetch(url, { signal: controller.signal });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.detail) detail = String(body.detail);
          } catch {
            // ignore parse errors
          }
          throw new Error(detail);
        }
        const blob = await res.blob();
        if (reqIdRef.current !== reqId) return;
        const blobUrl = URL.createObjectURL(blob);
        setState({ kind: "ready", blobUrl });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (reqIdRef.current !== reqId) return;
        const message =
          err instanceof Error ? err.message : "Failed to load preview";
        setState({ kind: "error", message });
      }
    })();

    return () => {
      controller.abort();
      reqIdRef.current += 1;
    };
  }, [url]);

  useEffect(() => {
    if (state.kind !== "ready" || !state.blobUrl.startsWith("blob:")) return;
    const blobUrl = state.blobUrl;
    return () => URL.revokeObjectURL(blobUrl);
  }, [state]);

  return state;
}
