"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { listUsers, type UserRecord } from "@/lib/admin-api";
import Link from "next/link";

interface UserStats {
  user_id: string;
  username: string;
  total_sessions: number;
  quiz_sessions: number;
  voice_minutes: number;
  streak_days: number;
  last_active: string | null;
}

type SortKey = "streak_days" | "total_sessions" | "quiz_sessions" | "voice_minutes";

function relTime(iso: string | null) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(val: number, max: number) {
  const pct = max > 0 ? val / max : 0;
  if (pct >= 0.66) return "#22c55e";
  if (pct >= 0.33) return "#f59e0b";
  return "#ef4444";
}

export default function AdminProgressPage() {
  const [rows, setRows] = useState<UserStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("streak_days");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    listUsers().then(async (users) => {
      const stats = await Promise.all(
        users.map((u) =>
          apiFetch(apiUrl(`/api/v1/multi-user/admin/users/${u.id}/stats`))
            .then((r) => r.json())
            .catch(() => null),
        ),
      );
      setRows(stats.filter(Boolean) as UserStats[]);
      setLoading(false);
    });
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort] ?? 0;
    const bv = b[sort] ?? 0;
    return dir === "desc"
      ? (bv as number) - (av as number)
      : (av as number) - (bv as number);
  });

  const maxStreak = Math.max(...rows.map((r) => r.streak_days), 1);
  const maxSessions = Math.max(...rows.map((r) => r.total_sessions), 1);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSort(key); setDir("desc"); }
  };

  const SortTh = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="px-4 py-2.5 text-left text-xs font-medium cursor-pointer select-none hover:opacity-80"
      style={{ color: sort === k ? "var(--primary)" : "var(--muted-foreground)" }}
      onClick={() => toggleSort(k)}
    >
      {label} {sort === k ? (dir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
          Progress Analytics
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          {rows.length} users · click column headers to sort
        </p>
      </div>

      {/* Leaderboard cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "🔥 Streak Leaders", key: "streak_days" as SortKey, unit: "days" },
          { label: "✅ Quiz Champions", key: "quiz_sessions" as SortKey, unit: "sessions" },
          { label: "🎙 Voice Learners", key: "voice_minutes" as SortKey, unit: "min" },
        ].map(({ label, key, unit }) => (
          <div key={key} className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="mb-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>{label}</div>
            {[...rows]
              .sort((a, b) => ((b[key] as number) ?? 0) - ((a[key] as number) ?? 0))
              .slice(0, 5)
              .map((r, i) => (
                <div key={r.user_id} className="flex items-center gap-2 py-1.5">
                  <span className="text-xs w-4 text-center" style={{ color: "var(--muted-foreground)" }}>{i + 1}</span>
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0"
                    style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    {r.username[0]?.toUpperCase()}
                  </div>
                  <Link href={`/admin/users/${r.user_id}`} className="flex-1 truncate text-xs hover:underline" style={{ color: "var(--foreground)" }}>
                    {r.username}
                  </Link>
                  <span className="text-xs font-bold tabular-nums" style={{ color: "var(--primary)" }}>
                    {(r[key] as number)?.toFixed(key === "voice_minutes" ? 1 : 0)} {unit}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>

      {/* Full table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>User</th>
              <SortTh k="streak_days" label="Streak" />
              <SortTh k="total_sessions" label="Sessions" />
              <SortTh k="quiz_sessions" label="Quizzes" />
              <SortTh k="voice_minutes" label="Voice min" />
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Last active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 animate-pulse rounded" style={{ background: "var(--muted)", width: j === 0 ? "60%" : "40%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.map((r) => (
              <tr key={r.user_id} className="transition-colors hover:bg-[var(--accent)]" style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${r.user_id}`} className="font-medium hover:underline" style={{ color: "var(--foreground)" }}>
                    {r.username}
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums text-xs font-bold" style={{ color: scoreColor(r.streak_days, maxStreak) }}>
                  {r.streak_days}🔥
                </td>
                <td className="px-4 py-3 tabular-nums text-xs" style={{ color: scoreColor(r.total_sessions, maxSessions) }}>
                  {r.total_sessions}
                </td>
                <td className="px-4 py-3 tabular-nums text-xs" style={{ color: "var(--foreground)" }}>{r.quiz_sessions}</td>
                <td className="px-4 py-3 tabular-nums text-xs" style={{ color: "var(--foreground)" }}>{r.voice_minutes.toFixed(1)}</td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>{relTime(r.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
