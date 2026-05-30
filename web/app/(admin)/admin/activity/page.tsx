"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface Activity {
  session_id: string;
  title: string;
  capability: string;
  message_count: number;
  updated_at: number;
  user_id: string;
  username: string;
  flagged: boolean;
}

const CAP_ICONS: Record<string, string> = {
  chat: "💬", question: "✅", quiz: "✅", research: "🔍",
  visualize: "📊", book: "📖", solve: "🧠", voice: "🎙",
};
const CAP_COLORS: Record<string, string> = {
  chat: "#3b82f6", question: "#f59e0b", quiz: "#f59e0b",
  research: "#a855f7", visualize: "#10b981", voice: "#14b8a6",
};
const ALL_CAPS = ["all", "chat", "quiz", "research", "voice", "visualize"];

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AdminActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [cap, setCap] = useState("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (cap !== "all") params.set("capability", cap);
    if (search) params.set("search", search);
    apiFetch(apiUrl(`/api/v1/multi-user/admin/conversations?${params}`))
      .then((r) => r.json())
      .then((d: Activity[]) => setActivities(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [cap]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 30_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, cap]);

  const filtered = search
    ? activities.filter((a) =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.username.toLowerCase().includes(search.toLowerCase())
      )
    : activities;

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
              Activity Feed
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              {filtered.length} sessions across all users
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs transition-all"
              style={{
                background: autoRefresh ? "rgba(20,184,166,0.1)" : "var(--card)",
                color: autoRefresh ? "#14b8a6" : "var(--muted-foreground)",
              }}
            >
              <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
              Auto
            </button>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              style={{ color: "var(--muted-foreground)" }}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions or users…"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
            style={{ color: "var(--foreground)", minWidth: 200 }}
          />
          {ALL_CAPS.map((c) => (
            <button key={c} onClick={() => setCap(c)}
              className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-all"
              style={{
                background: cap === c ? `${CAP_COLORS[c] ?? "var(--primary)"}22` : "var(--muted)",
                color: cap === c ? (CAP_COLORS[c] ?? "var(--primary)") : "var(--muted-foreground)",
              }}>
              {c === "all" ? "All" : `${CAP_ICONS[c] ?? "📄"} ${c}`}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                {["User", "Type", "Session", "Msgs", "Time", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium"
                    style={{ color: "var(--muted-foreground)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 animate-pulse rounded"
                          style={{ background: "var(--muted)", width: j === 2 ? "80%" : "50%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm"
                    style={{ color: "var(--muted-foreground)" }}>
                    No activity found
                  </td>
                </tr>
              ) : filtered.map((a) => (
                <tr key={a.session_id}
                  className="hover:bg-[var(--accent)] transition-colors"
                  style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${encodeURIComponent(a.user_id)}`}
                      className="text-sm hover:underline font-medium"
                      style={{ color: "var(--foreground)" }}>
                      {a.username}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: `${CAP_COLORS[a.capability] ?? "#6b7280"}18`,
                        color: CAP_COLORS[a.capability] ?? "var(--muted-foreground)",
                      }}>
                      {CAP_ICONS[a.capability] ?? "📄"} {a.capability}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate"
                    style={{ color: "var(--foreground)" }}>
                    {a.title}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs"
                    style={{ color: "var(--muted-foreground)" }}>
                    {a.message_count}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap"
                    style={{ color: "var(--muted-foreground)" }}>
                    {a.updated_at ? relTime(a.updated_at) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {a.flagged && (
                      <span className="rounded-full px-2 py-0.5 text-xs"
                        style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                        🚩 Flagged
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
