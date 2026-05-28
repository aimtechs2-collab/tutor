"use client";

import { useEffect, useState } from "react";
import { Flame, MessageSquare, Mic, CheckSquare } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { ActivityChart } from "@/components/dashboard/ActivityChart";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { fetchAuthStatus } from "@/lib/auth";

interface DashboardStats {
  total_sessions: number;
  quiz_sessions: number;
  voice_minutes: number;
  streak_days: number;
  last_active: string | null;
  seven_day_activity: Record<string, { chat: number; quiz: number; voice: number; research: number; other: number }>;
}

interface Activity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
}

export default function DashboardPage() {
  const [username, setUsername] = useState<string>("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [memorySnapshot, setMemorySnapshot] = useState<Record<string, string>>({});
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    fetchAuthStatus().then((s) => {
      if (s?.username) setUsername(s.username);
    });

    apiFetch(apiUrl("/api/v1/dashboard/stats"))
      .then((r) => r.json())
      .then((d) => { setStats(d); setLoadingStats(false); })
      .catch(() => setLoadingStats(false));

    apiFetch(apiUrl("/api/v1/dashboard/recent?limit=40"))
      .then((r) => r.json())
      .then((d: Activity[]) => { setActivities(d); setLoadingActivity(false); })
      .catch(() => setLoadingActivity(false));

    apiFetch(apiUrl("/api/v1/dashboard/memory-snapshot"))
      .then((r) => r.json())
      .then(setMemorySnapshot)
      .catch(() => {});
  }, []);

  const statCards = stats
    ? [
        { label: "Total Sessions", value: stats.total_sessions, icon: "💬", accent: "var(--primary)" },
        { label: "Quiz Sessions", value: stats.quiz_sessions, icon: "✅", accent: "#f59e0b" },
        { label: "Voice Minutes", value: `${stats.voice_minutes}m`, icon: "🎙", accent: "#14b8a6" },
        { label: "Day Streak", value: stats.streak_days, icon: "🔥", accent: "#f97316" },
      ]
    : Array.from({ length: 4 }).map((_, i) => ({
        label: ["Total Sessions", "Quiz Sessions", "Voice Minutes", "Day Streak"][i],
        value: "—",
        icon: ["💬", "✅", "🎙", "🔥"][i],
        accent: "var(--muted-foreground)",
      }));

  const memoryKeys = Object.keys(memorySnapshot);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
            {username ? `Welcome back, ${username} 👋` : "Your Dashboard"}
          </h1>
          {stats?.last_active && (
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              Last active:{" "}
              {new Date(stats.last_active).toLocaleDateString(undefined, {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </p>
          )}
        </div>
        {stats && stats.streak_days > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{ background: "rgba(249,115,22,0.12)", color: "#f97316", border: "1px solid rgba(249,115,22,0.25)" }}
          >
            <Flame size={14} />
            {stats.streak_days} day streak
          </div>
        )}
      </div>

      {/* Stats */}
      <StatsGrid stats={statCards} />

      {/* Chart + Memory */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {stats ? (
            <ActivityChart sevenDayActivity={stats.seven_day_activity} />
          ) : (
            <div
              className="h-64 animate-pulse rounded-xl"
              style={{ background: "var(--muted)" }}
            />
          )}
        </div>

        {/* Memory snapshot */}
        <div
          className="rounded-xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            🧠 What your tutor remembers
          </h3>
          {memoryKeys.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Memory builds up as you use AIMTutor. Check back after a few sessions.
            </p>
          ) : (
            <div className="space-y-3">
              {memoryKeys.slice(0, 3).map((surface) => (
                <div key={surface}>
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {surface}
                  </div>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: "var(--foreground)" }}
                  >
                    {memorySnapshot[surface].slice(0, 200)}
                    {memorySnapshot[surface].length > 200 ? "…" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <h2 className="mb-4 text-base font-semibold" style={{ color: "var(--foreground)" }}>
          Recent Activity
        </h2>
        <ActivityFeed activities={activities} loading={loadingActivity} />
      </div>
    </div>
  );
}
