import { apiFetch, apiUrl } from "@/lib/api";

type GeminiLiveConfig = { enabled: boolean; screenpipeEnabled: boolean };

let cache: { at: number; value: Promise<GeminiLiveConfig> } | null = null;
const CACHE_MS = 60_000;

/** Shared, deduped config probe for Gemini Live (avoids N requests per remount). */
export function fetchGeminiLiveConfig(): Promise<GeminiLiveConfig> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return cache.value;
  }
  const fallback = { enabled: false, screenpipeEnabled: false };
  const value = apiFetch(apiUrl("/api/v1/gemini-live/config"))
    .then((r) => (r.ok ? r.json() : fallback))
    .then((d) => ({
      enabled: Boolean(d?.enabled),
      screenpipeEnabled: Boolean(d?.screenpipe_enabled),
    }))
    .catch(() => fallback);
  cache = { at: now, value };
  return value;
}
