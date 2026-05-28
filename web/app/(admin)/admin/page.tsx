"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUrl } from "@/lib/api";

interface AdminStats {
  total_users: number;
  new_this_week: number;
  admins: number;
  total_including_disabled: number;
}

interface Activity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
}

const TYPE_ICONS: Record<string, string> = {
  chat: "💬", quiz: "✅", question: "✅", research: "🔍",
  visualize: "📊", book: "📖", solve: "🧠",
};

function relTime(ts: number) {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);

  useEffect(() => {
    apiFetch(apiUrl("/api/v1/multi-user/admin/stats"))
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    apiFetch(apiUrl("/api/v1/dashboard/recent?limit=20"))
      .then((r) => r.json())
      .then(setRecentActivity)
      .catch(() => {});
  }, []);

  const statCards = [
    { label: "Total Users", value: stats?.total_users ?? "—", icon: "👥" },
    { label: "New This Week", value: stats?.new_this_week ?? "—", icon: "🆕" },
    { label: "Admins", value: stats?.admins ?? "—", icon: "🛡" },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
          Overview
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Platform-wide summary
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {statCards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl p-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="text-2xl mb-2">{c.icon}</div>
            <div className="text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
              {c.value}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            Recent Platform Activity
          </h2>
          <Link
            href="/admin/activity"
            className="text-xs"
            style={{ color: "var(--primary)" }}
          >
            View all →
          </Link>
        </div>

        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                {["Type", "Title", "Messages", "Time"].map((h) => (
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
              {recentActivity.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
                    No activity yet
                  </td>
                </tr>
              ) : (
                recentActivity.map((a) => (
                  <tr
                    key={a.id}
                    className="transition-colors hover:bg-[var(--accent)]"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td className="px-4 py-3">
                      <span className="mr-1.5">{TYPE_ICONS[a.type] ?? "📄"}</span>
                      <span className="text-xs capitalize" style={{ color: "var(--muted-foreground)" }}>
                        {a.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" style={{ color: "var(--foreground)" }}>
                      {a.title}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                      {a.message_count}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {relTime(a.timestamp)}
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
