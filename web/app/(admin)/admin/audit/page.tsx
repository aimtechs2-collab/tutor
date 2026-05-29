"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";

interface AuditEntry {
  ts: string;
  action: string;
  user_id?: string;
  admin_id?: string;
  summary?: Record<string, unknown>;
}

function relTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ACTION_COLORS: Record<string, string> = {
  space_assign: "#6366f1",
  grant_update: "#f59e0b",
  user_delete: "#ef4444",
  role_change: "#f97316",
  gemini_live_voice: "#14b8a6",
};

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(apiUrl("/api/v1/multi-user/admin/audit?limit=200"))
      .then((r) => r.json())
      .then((d: AuditEntry[]) => { setEntries(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleExport = () => {
    const lines = ["Timestamp,Action,User,Admin,Summary"];
    entries.forEach((e) => {
      lines.push([
        e.ts,
        e.action,
        e.user_id || "",
        e.admin_id || "",
        JSON.stringify(e.summary || {}).replace(/,/g, ";"),
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>Audit Log</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            {entries.length} entries — admin actions and system events
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={!entries.length}
          className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          Export CSV
        </button>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              {["Time", "Action", "User", "Admin", "Details"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
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
                      <div className="h-3 animate-pulse rounded" style={{ background: "var(--muted)", width: j === 4 ? "80%" : "50%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
                  No audit entries yet
                </td>
              </tr>
            ) : entries.map((e, i) => (
              <tr key={i} className="transition-colors hover:bg-[var(--accent)]" style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--muted-foreground)" }}>
                  {relTime(e.ts)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      background: `${ACTION_COLORS[e.action] ?? "#6b7280"}18`,
                      color: ACTION_COLORS[e.action] ?? "var(--muted-foreground)",
                    }}
                  >
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--foreground)" }}>
                  {e.user_id ? e.user_id.slice(0, 12) + "…" : "—"}
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>
                  {e.admin_id ? e.admin_id.slice(0, 12) + "…" : "—"}
                </td>
                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: "var(--muted-foreground)" }}>
                  {e.summary ? JSON.stringify(e.summary) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
