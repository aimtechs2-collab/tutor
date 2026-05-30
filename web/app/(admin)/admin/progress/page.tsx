"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUrl } from "@/lib/api";

interface UserProgress {
  user_id: string;
  username: string;
  plan_name: string;
  total_sessions: number;
  quiz_sessions: number;
  voice_minutes: number;
  streak_days: number;
  last_active: string | null;
}

type SortKey = "streak_days" | "total_sessions" | "quiz_sessions" | "voice_minutes";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(val: number, max: number): string {
  const pct = max > 0 ? val / max : 0;
  if (pct >= 0.66) return "#22c55e";
  if (pct >= 0.33) return "#f59e0b";
  return "#ef4444";
}

export default function AdminProgressPage() {
  const [rows, setRows] = useState<UserProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("streak_days");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    apiFetch(apiUrl("/api/v1/multi-user/admin/progress"))
      .then((r) => r.json())
      .then((d: UserProgress[]) => {
        setRows(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const av = (a[sort] as number) ?? 0;
    const bv = (b[sort] as number) ?? 0;
    return dir === "desc" ? bv - av : av - bv;
  });

  const maxStreak = Math.max(...rows.map((r) => r.streak_days), 1);
  const maxSessions = Math.max(...rows.map((r) => r.total_sessions), 1);

  const toggle = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSort(key); setDir("desc"); }
  };

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th onClick={() => toggle(k)} className="px-4 py-2.5 text-left text-xs font-medium cursor-pointer select-none hover:opacity-80"
      style={{ color: sort === k ? "var(--primary)" : "var(--muted-foreground)" }}>
      {label} {sort === k ? (dir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  // Leaderboards
  const leaderboards = [
    { label: "🔥 Streak Leaders", key: "streak_days" as SortKey, unit: "days" },
    { label: "✅ Quiz Champions", key: "quiz_sessions" as SortKey, unit: "sessions" },
    { label: "🎙 Voice Learners", key: "voice_minutes" as SortKey, unit: "min" },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
            Progress Analytics
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            {rows.length} users · click column headers to sort
          </p>
        </div>

        {/* Leaderboards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {leaderboards.map(({ label, key, unit }) => (
            <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>{label}</div>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-6 animate-pulse rounded" style={{ background: "var(--muted)" }} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {[...rows].sort((a, b) => ((b[key] as number) ?? 0) - ((a[key] as number) ?? 0))
                    .slice(0, 5).map((r, i) => (
                      <div key={r.user_id} className="flex items-center gap-2">
                        <span className="w-4 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
                          {i + 1}
                        </span>
                        <Link href={`/admin/users/${encodeURIComponent(r.user_id)}`}
                          className="flex-1 truncate text-xs hover:underline"
                          style={{ color: "var(--foreground)" }}>
                          {r.username}
                        </Link>
                        <span className="text-xs font-bold tabular-nums" style={{ color: "var(--primary)" }}>
                          {((r[key] as number) ?? 0).toFixed(key === "voice_minutes" ? 1 : 0)} {unit}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Sortable table */}
        <div className="rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                <th className="px-4 py-2.5 text-left text-xs font-medium"
                  style={{ color: "var(--muted-foreground)" }}>User</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium"
                  style={{ color: "var(--muted-foreground)" }}>Plan</th>
                <Th k="streak_days" label="Streak" />
                <Th k="total_sessions" label="Sessions" />
                <Th k="quiz_sessions" label="Quizzes" />
                <Th k="voice_minutes" label="Voice min" />
                <th className="px-4 py-2.5 text-left text-xs font-medium"
                  style={{ color: "var(--muted-foreground)" }}>Last active</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 animate-pulse rounded"
                          style={{ background: "var(--muted)", width: "60%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm"
                    style={{ color: "var(--muted-foreground)" }}>
                    No user data yet
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.user_id} className="hover:bg-[var(--accent)] transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${encodeURIComponent(r.user_id)}`}
                        className="font-medium hover:underline text-sm"
                        style={{ color: "var(--foreground)" }}>
                        {r.username}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-xs capitalize"
                        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                        {r.plan_name ?? "free"}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs font-bold"
                      style={{ color: scoreColor(r.streak_days, maxStreak) }}>
                      {r.streak_days}🔥
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs"
                      style={{ color: scoreColor(r.total_sessions, maxSessions) }}>
                      {r.total_sessions}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs"
                      style={{ color: "var(--foreground)" }}>
                      {r.quiz_sessions}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs"
                      style={{ color: "var(--foreground)" }}>
                      {r.voice_minutes?.toFixed(1) ?? "0.0"}
                    </td>
                    <td className="px-4 py-3 text-xs"
                      style={{ color: "var(--muted-foreground)" }}>
                      {relTime(r.last_active)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
