import { apiFetch, apiUrl } from "@/lib/api";
import { withClientCache } from "@/lib/client-cache";

export interface DashboardDayActivity {
  chat: number;
  quiz: number;
  voice: number;
  research: number;
  other: number;
}

export interface DashboardStats {
  total_sessions: number;
  quiz_sessions: number;
  voice_minutes: number;
  streak_days: number;
  last_active: string | null;
  seven_day_activity: Record<string, DashboardDayActivity>;
}

export interface DashboardActivity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
}

export interface DashboardOverview {
  stats: DashboardStats;
  activities: DashboardActivity[];
  memory: Record<string, string>;
}

const STORAGE_KEY = "aimtutor:dashboard:overview";
const STORAGE_TTL_MS = 5 * 60_000;

function readSessionStorageOverview(): DashboardOverview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: DashboardOverview };
    if (Date.now() - parsed.savedAt > STORAGE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSessionStorageOverview(data: DashboardOverview): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    // Quota or private mode — ignore.
  }
}

async function fetchOverviewFromApi(): Promise<DashboardOverview> {
  const response = await apiFetch(apiUrl("/api/v1/dashboard/overview"), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Dashboard overview failed: ${response.status}`);
  }
  const data = (await response.json()) as DashboardOverview;
  writeSessionStorageOverview(data);
  return data;
}

/** Cached dashboard payload — one round-trip for stats, activity, and memory. */
export async function fetchDashboardOverview(options?: {
  force?: boolean;
}): Promise<DashboardOverview> {
  return withClientCache(
    "dashboard:overview",
    fetchOverviewFromApi,
    { ttlMs: 60_000, force: options?.force },
  );
}

/** Synchronously read last-known overview (sessionStorage) for instant paint. */
export function getStaleDashboardOverview(): DashboardOverview | null {
  return readSessionStorageOverview();
}
