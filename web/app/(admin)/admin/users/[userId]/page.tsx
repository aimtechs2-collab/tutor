"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Shield, ShieldOff, Flame, MessageSquare, Mic, CheckSquare } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import { setUserRole, type UserRecord } from "@/lib/admin-api";
import { ActivityChart } from "@/components/dashboard/ActivityChart";

interface UserStats {
  user_id: string;
  username: string;
  role: string;
  created_at: string;
  disabled: boolean;
  total_sessions: number;
  quiz_sessions: number;
  voice_minutes: number;
  streak_days: number;
  last_active: string | null;
}

interface Session {
  id: string;
  title: string;
  capability: string;
  message_count: number;
  updated_at: number;
  status: string;
}

const CAP_ICONS: Record<string, string> = {
  chat: "💬", quiz: "✅", question: "✅", research: "🔍",
  visualize: "📊", book: "📖", solve: "🧠", default: "📄",
};

function relTime(ts: number) {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [memory, setMemory] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [roleUpdating, setRoleUpdating] = useState(false);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      apiFetch(apiUrl(`/api/v1/multi-user/admin/users/${userId}/stats`)).then((r) => r.json()),
      apiFetch(apiUrl(`/api/v1/multi-user/admin/users/${userId}/sessions?limit=30`)).then((r) => r.json()),
      apiFetch(apiUrl(`/api/v1/multi-user/admin/users/${userId}/memory`)).then((r) => r.json()),
    ])
      .then(([s, sess, mem]) => {
        setStats(s);
        setSessions(Array.isArray(sess) ? sess : []);
        setMemory(mem || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  const handleToggleRole = async () => {
    if (!stats) return;
    const newRole = stats.role === "admin" ? "user" : "admin";
    setRoleUpdating(true);
    try {
      await setUserRole(stats.username, newRole);
      setStats({ ...stats, role: newRole });
    } finally {
      setRoleUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: "var(--muted)" }} />
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--muted-foreground)" }}>
        User not found.{" "}
        <Link href="/admin/users" style={{ color: "var(--primary)" }}>← Back to users</Link>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      {/* Back */}
      <Link
        href="/admin/users"
        className="flex items-center gap-1.5 text-xs"
        style={{ color: "var(--muted-foreground)" }}
      >
        <ArrowLeft size={13} /> Back to users
      </Link>

      {/* Identity card */}
      <div
        className="rounded-xl p-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                {stats.username[0]?.toUpperCase()}
              </div>
              <div>
                <h1 className="text-lg font-bold" style={{ color: "var(--foreground)" }}>
                  {stats.username}
                </h1>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  ID: {stats.user_id}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  background: stats.role === "admin" ? "rgba(245,158,11,0.15)" : "var(--muted)",
                  color: stats.role === "admin" ? "#f59e0b" : "var(--muted-foreground)",
                }}
              >
                {stats.role}
              </span>
              {stats.disabled && (
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                  disabled
                </span>
              )}
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                Joined {stats.created_at ? new Date(stats.created_at).toLocaleDateString() : "—"}
              </span>
              {stats.last_active && (
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Last active {new Date(stats.last_active).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleToggleRole}
            disabled={roleUpdating}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all disabled:opacity-50"
            style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            {stats.role === "admin" ? <ShieldOff size={14} /> : <Shield size={14} />}
            {stats.role === "admin" ? "Remove admin" : "Make admin"}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Sessions", value: stats.total_sessions, icon: "💬" },
          { label: "Quiz sessions", value: stats.quiz_sessions, icon: "✅" },
          { label: "Voice mins", value: `${stats.voice_minutes}m`, icon: "🎙" },
          { label: "Day streak", value: stats.streak_days, icon: "🔥" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-xl mb-1">{s.icon}</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>{s.value}</div>
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Memory + Sessions */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Memory snapshot */}
        <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            🧠 Memory Snapshot
          </h3>
          {Object.keys(memory).length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>No memory data yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(memory).map(([surface, content]) => (
                <div key={surface}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                    {surface}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--foreground)" }}>
                    {content.slice(0, 300)}{content.length > 300 ? "…" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sessions */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Recent Sessions</h3>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {sessions.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center" style={{ color: "var(--muted-foreground)" }}>
                No sessions found.
              </p>
            ) : (
              sessions.slice(0, 10).map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--accent)] transition-colors">
                  <span className="text-base">{CAP_ICONS[s.capability] ?? CAP_ICONS.default}</span>
                  <span className="flex-1 truncate text-sm" style={{ color: "var(--foreground)" }}>{s.title}</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                    {s.message_count} msgs
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {relTime(s.updated_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
