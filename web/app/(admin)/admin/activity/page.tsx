"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface Activity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
  capability: string;
}

const TYPE_COLORS: Record<string, string> = {
  chat: "#3b82f6", quiz: "#f59e0b", question: "#f59e0b",
  research: "#a855f7", visualize: "#10b981", book: "#22c55e",
  solve: "#8b5cf6",
};

const TYPE_ICONS: Record<string, string> = {
  chat: "💬", quiz: "✅", question: "✅", research: "🔍",
  visualize: "📊", book: "📖", solve: "🧠",
};

function relTime(ts: number) {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const CAP_TYPES = ["all", "chat", "quiz", "research", "visualize", "book", "solve"];

export default function AdminActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch(apiUrl("/api/v1/multi-user/admin/activity?limit=100"))
      .then((r) => r.json())
      .then((d: Activity[]) => { setActivities(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 30_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  const filtered = filter === "all"
    ? activities
    : activities.filter((a) => a.type === filter || a.capability === filter);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>Activity Feed</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            {filtered.length} events
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all"
            style={{
              border: "1px solid var(--border)",
              background: autoRefresh ? "rgba(20,184,166,0.1)" : "var(--card)",
              color: autoRefresh ? "#14b8a6" : "var(--muted-foreground)",
            }}
          >
            <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
            Auto-refresh
          </button>
          <button
            onClick={load}
            className="rounded-lg px-3 py-2 text-xs"
            style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
          >
            Refresh now
          </button>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-2">
        {CAP_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-all capitalize"
            style={{
              background: filter === t ? "var(--primary)" : "var(--muted)",
              color: filter === t ? "var(--primary-foreground)" : "var(--muted-foreground)",
            }}
          >
            {t === "all" ? "All" : `${TYPE_ICONS[t] ?? "📄"} ${t}`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              {["User", "Type", "Title", "Summary", "Messages", "Time"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-left text-xs font-medium"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 animate-pulse rounded" style={{ background: "var(--muted)", width: j === 2 ? "80%" : "50%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
                  No activity found
                </td>
              </tr>
            ) : (
              filtered.map((a) => (
                <tr
                  key={a.id}
                  className="transition-colors hover:bg-[var(--accent)]"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {(a as any).user?.username ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
                      style={{
                        background: `${TYPE_COLORS[a.type] ?? "#6b7280"}18`,
                        color: TYPE_COLORS[a.type] ?? "var(--muted-foreground)",
                      }}
                    >
                      {TYPE_ICONS[a.type] ?? "📄"} {a.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate font-medium" style={{ color: "var(--foreground)" }}>
                    {a.title}
                  </td>
                  <td className="px-4 py-3 max-w-[260px] truncate text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {a.summary || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                    {a.message_count}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--muted-foreground)" }}>
                    {relTime(a.timestamp)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
