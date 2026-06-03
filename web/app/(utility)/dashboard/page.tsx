"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Flame,
  MessageSquare,
  Mic,
  CheckSquare,
  Brain,
  ArrowRight,
} from "lucide-react";
import { StatsGrid, type Stat } from "@/components/dashboard/StatsGrid";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { ActivityChart } from "@/components/dashboard/ActivityChart";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { fetchAuthStatus } from "@/lib/auth";
import {
  fetchDashboardOverview,
  getStaleDashboardOverview,
  type DashboardActivity,
  type DashboardOverview,
  type DashboardStats,
} from "@/lib/dashboard-api";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function displayName(username: string): string {
  if (!username) return "";
  if (/^user_/i.test(username)) return "there";
  return username;
}

function applyOverview(
  overview: DashboardOverview,
  setters: {
    setStats: (s: DashboardStats) => void;
    setActivities: (a: DashboardActivity[]) => void;
    setMemorySnapshot: (m: Record<string, string>) => void;
    setLoadingActivity: (v: boolean) => void;
  },
) {
  setters.setStats(overview.stats);
  setters.setActivities(overview.activities);
  setters.setMemorySnapshot(overview.memory);
  setters.setLoadingActivity(false);
}

export default function DashboardPage() {
  const [initialStale] = useState(() => getStaleDashboardOverview());

  const [username, setUsername] = useState<string>("");
  const [stats, setStats] = useState<DashboardStats | null>(
    initialStale?.stats ?? null,
  );
  const [activities, setActivities] = useState<DashboardActivity[]>(
    initialStale?.activities ?? [],
  );
  const [memorySnapshot, setMemorySnapshot] = useState<Record<string, string>>(
    initialStale?.memory ?? {},
  );
  const [loadingActivity, setLoadingActivity] = useState(!initialStale);
  const [refreshing, setRefreshing] = useState(Boolean(initialStale));

  useEffect(() => {
    fetchAuthStatus().then((s) => {
      if (s?.username) setUsername(s.username);
    });

    const setters = {
      setStats,
      setActivities,
      setMemorySnapshot,
      setLoadingActivity,
    };

    let cancelled = false;

    fetchDashboardOverview({ force: !initialStale })
      .then((overview) => {
        if (cancelled) return;
        applyOverview(overview, setters);
        setRefreshing(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingActivity(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialStale]);

  const statCards: Stat[] = [
    {
      label: "Total Sessions",
      value: stats ? stats.total_sessions : "—",
      icon: MessageSquare,
      accent: "var(--primary)",
      loading: !stats,
    },
    {
      label: "Quiz Sessions",
      value: stats ? stats.quiz_sessions : "—",
      icon: CheckSquare,
      accent: "#f59e0b",
      loading: !stats,
    },
    {
      label: "Voice Minutes",
      value: stats ? `${stats.voice_minutes}m` : "—",
      icon: Mic,
      accent: "#14b8a6",
      loading: !stats,
    },
    {
      label: "Day Streak",
      value: stats ? stats.streak_days : "—",
      icon: Flame,
      accent: "#f97316",
      loading: !stats,
    },
  ];

  const memoryKeys = Object.keys(memorySnapshot);
  const name = displayName(username);

  return (
    <div className="mx-auto max-w-5xl space-y-7 p-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
            {name ? `${greeting()}, ${name}` : "Your Dashboard"} 👋
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            {stats?.last_active ? (
              <>
                Last active{" "}
                {new Date(stats.last_active).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {refreshing ? " · updating…" : ""}
              </>
            ) : (
              "Here's an overview of your learning activity."
            )}
          </p>
        </div>
        {stats && stats.streak_days > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: "rgba(249,115,22,0.12)",
              color: "#f97316",
              border: "1px solid rgba(249,115,22,0.25)",
            }}
          >
            <Flame size={14} />
            {stats.streak_days} day streak
          </div>
        )}
      </div>

      <StatsGrid stats={statCards} />

      <QuickActions />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {stats ? (
            <ActivityChart sevenDayActivity={stats.seven_day_activity} />
          ) : (
            <div
              className="h-72 animate-pulse rounded-2xl"
              style={{ background: "var(--muted)" }}
            />
          )}
        </div>

        <div
          className="flex flex-col rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3
            className="mb-3 flex items-center gap-2 text-sm font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            <Brain size={15} style={{ color: "var(--primary)" }} />
            What your tutor remembers
          </h3>
          {memoryKeys.length === 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              Memory builds up as you use AIMTutor. Check back after a few sessions.
            </p>
          ) : (
            <>
              <div className="flex-1 space-y-3">
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
                      {memorySnapshot[surface].slice(0, 180)}
                      {memorySnapshot[surface].length > 180 ? "…" : ""}
                    </p>
                  </div>
                ))}
              </div>
              <Link
                href="/memory"
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--primary)" }}
              >
                View memory <ArrowRight size={12} />
              </Link>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Recent Activity
          </h2>
          {activities.length > 0 && (
            <Link
              href="/space/chat-history"
              className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--primary)" }}
            >
              View all <ArrowRight size={12} />
            </Link>
          )}
        </div>
        <ActivityFeed activities={activities.slice(0, 12)} loading={loadingActivity} />
      </div>
    </div>
  );
}
