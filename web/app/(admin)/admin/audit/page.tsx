"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface AuditEntry {
  ts: string;
  action: string;
  admin_id?: string;
  target_user_id?: string;
  summary?: Record<string, unknown>;
}

const ACTION_COLORS: Record<string, string> = {
  suspend_user:   "#f59e0b",
  unsuspend_user: "#22c55e",
  ban_user:       "#ef4444",
  reset_password: "#6366f1",
  assign_plan:    "#0ea5e9",
  create_plan:    "#10b981",
  update_plan:    "#10b981",
  deactivate_plan:"#f97316",
  quota_adjust:   "#8b5cf6",
  set_admin_role: "#ec4899",
  flag_conversation: "#f59e0b",
  resolve_flag:   "#22c55e",
};

const ALL_ACTIONS = Object.keys(ACTION_COLORS);

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    const params = filter !== "all" ? `?action=${filter}` : "";
    apiFetch(apiUrl(`/api/v1/multi-user/admin/audit${params}`))
      .then((r) => r.json())
      .then((d: AuditEntry[]) => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const handleExport = () => {
    const link = document.createElement("a");
    link.href = apiUrl("/api/v1/admin/reports/audit");
    link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const filtered = entries.filter((e) => {
    if (!search) return true;
    return (
      e.action?.includes(search) ||
      e.admin_id?.includes(search) ||
      e.target_user_id?.includes(search) ||
      JSON.stringify(e.summary ?? {}).includes(search)
    );
  });

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
              Audit Log
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              {filtered.length} entries — every admin action is recorded here
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              style={{ color: "var(--muted-foreground)" }}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              style={{ color: "var(--foreground)" }}
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-5 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions, users…"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
            style={{ color: "var(--foreground)", minWidth: 200 }}
          />
          <div className="flex flex-wrap gap-1.5">
            {["all", ...ALL_ACTIONS].map((a) => (
              <button
                key={a}
                onClick={() => setFilter(a)}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-all"
                style={{
                  background: filter === a ? (ACTION_COLORS[a] ?? "var(--primary)") + "22" : "var(--muted)",
                  color: filter === a ? (ACTION_COLORS[a] ?? "var(--primary)") : "var(--muted-foreground)",
                  border: `1px solid ${filter === a ? (ACTION_COLORS[a] ?? "var(--primary)") + "44" : "transparent"}`,
                }}
              >
                {a.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                {["Time", "Action", "Admin", "Target User", "Details"].map((h) => (
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
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 animate-pulse rounded"
                          style={{ background: "var(--muted)", width: j === 4 ? "80%" : "50%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm"
                    style={{ color: "var(--muted-foreground)" }}>
                    No audit entries found
                  </td>
                </tr>
              ) : (
                filtered.map((e, i) => (
                  <tr key={i} className="hover:bg-[var(--accent)] transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap"
                      style={{ color: "var(--muted-foreground)" }}>
                      {e.ts ? relTime(e.ts) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
                        style={{
                          background: `${ACTION_COLORS[e.action] ?? "#6b7280"}18`,
                          color: ACTION_COLORS[e.action] ?? "var(--muted-foreground)",
                        }}
                      >
                        {e.action?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs"
                      style={{ color: "var(--muted-foreground)" }}>
                      {e.admin_id ? e.admin_id.slice(0, 10) + "…" : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs"
                      style={{ color: "var(--foreground)" }}>
                      {e.target_user_id ? e.target_user_id.slice(0, 10) + "…" : "—"}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-xs"
                      style={{ color: "var(--muted-foreground)" }}>
                      {e.summary ? JSON.stringify(e.summary).slice(0, 80) : "—"}
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
