"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, ShieldAlert, CreditCard, FileText, RefreshCw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface OverviewData {
  users: { total: number; suspended: number; banned: number; admins: number };
  risk: { unresolved_flags: number; flag_types: Record<string, number> };
  plans: { name: string; count: number }[];
  recent_audit: Array<{ ts: string; action: string; admin_id?: string; summary?: Record<string, unknown> }>;
}

const FLAG_COLORS: Record<string, string> = {
  harmful: "#ef4444",
  hallucination: "#f59e0b",
  abuse: "#dc2626",
  policy_violation: "#f97316",
  wrong_answer: "#8b5cf6",
  user_frustration: "#6366f1",
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function KpiCard({ label, value, sub, icon: Icon, href, accent }: {
  label: string; value: number | string; sub?: string;
  icon: React.ElementType; href?: string; accent?: string;
}) {
  const inner = (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <Icon size={18} style={{ color: accent ?? "var(--primary)" }} />
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
        {value}
      </div>
      <div className="mt-1 text-sm font-medium" style={{ color: "var(--foreground)" }}>{label}</div>
      {sub && <div className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{sub}</div>}
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch(apiUrl("/api/v1/multi-user/admin/overview"))
      .then((r) => r.json())
      .then((d: OverviewData) => { setData(d); setLastUpdated(new Date()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const Skeleton = () => (
    <div className="h-28 animate-pulse rounded-2xl" style={{ background: "var(--muted)" }} />
  );

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
              Platform Overview
            </h1>
            {lastUpdated && (
              <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                Updated {relTime(lastUpdated.toISOString())}
              </p>
            )}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
            style={{ color: "var(--muted-foreground)" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* KPI grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
          ) : data ? (
            <>
              <KpiCard
                label="Total Users"
                value={data.users.total}
                sub={`${data.users.admins} admin${data.users.admins !== 1 ? "s" : ""}`}
                icon={Users}
                href="/admin/users"
              />
              <KpiCard
                label="Suspended"
                value={data.users.suspended}
                sub="Temporarily blocked"
                icon={ShieldAlert}
                accent="#f59e0b"
                href="/admin/users"
              />
              <KpiCard
                label="Banned"
                value={data.users.banned}
                sub="Permanently blocked"
                icon={ShieldAlert}
                accent="#ef4444"
                href="/admin/users"
              />
              <KpiCard
                label="Risk Flags"
                value={data.risk.unresolved_flags}
                sub="Unresolved"
                icon={ShieldAlert}
                accent={data.risk.unresolved_flags > 0 ? "#ef4444" : "#22c55e"}
                href="/admin/risk"
              />
            </>
          ) : null}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Plan distribution */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Plan Distribution
              </h2>
              <Link href="/admin/plans" className="text-xs" style={{ color: "var(--primary)" }}>
                Manage plans →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-7 animate-pulse rounded" style={{ background: "var(--muted)" }} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(data?.plans ?? []).length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    No plans created yet.{" "}
                    <Link href="/admin/plans" className="underline">Create one</Link>
                  </p>
                ) : (
                  data?.plans.map((p) => {
                    const total = Math.max(data.users.total, 1);
                    const pct = Math.round((p.count / total) * 100);
                    return (
                      <div key={p.name}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span style={{ color: "var(--foreground)" }}>{p.name}</span>
                          <span style={{ color: "var(--muted-foreground)" }}>
                            {p.count} users ({pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: "var(--primary)" }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Risk flags breakdown */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Unresolved Risk Flags
              </h2>
              <Link href="/admin/risk" className="text-xs" style={{ color: "var(--primary)" }}>
                Review flags →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-7 animate-pulse rounded" style={{ background: "var(--muted)" }} />
                ))}
              </div>
            ) : Object.keys(data?.risk.flag_types ?? {}).length === 0 ? (
              <p className="text-sm" style={{ color: "#22c55e" }}>
                ✅ No unresolved flags — platform looks healthy.
              </p>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(data?.risk.flag_types ?? {}).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
                      style={{
                        background: `${FLAG_COLORS[type] ?? "#6b7280"}18`,
                        color: FLAG_COLORS[type] ?? "var(--muted-foreground)",
                      }}
                    >
                      {type.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent audit activity */}
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Recent Admin Actions
            </h2>
            <Link href="/admin/audit" className="text-xs" style={{ color: "var(--primary)" }}>
              Full audit log →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded" style={{ background: "var(--muted)" }} />
              ))}
            </div>
          ) : (data?.recent_audit ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>No admin actions recorded yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {data?.recent_audit.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                  >
                    {entry.action?.replace(/_/g, " ")}
                  </span>
                  <span className="flex-1 truncate text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {entry.summary ? JSON.stringify(entry.summary).slice(0, 60) : ""}
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {entry.ts ? relTime(entry.ts) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
