"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, ScanSearch, ShieldAlert } from "lucide-react";
import { notify } from "@/lib/notifications";
import { suspendUser } from "@/lib/admin-api";
import {
  fetchRiskFlags,
  fetchRiskSummary,
  formatRiskDetails,
  formatRiskType,
  reviewRiskFlag,
  startRiskScan,
  type RiskFlag,
  type RiskSummary,
} from "@/lib/risk-api";

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300";
    case "high":
      return "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300";
    case "medium":
      return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
    default:
      return "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "reviewed":
      return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
    case "dismissed":
      return "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]";
    case "actioned":
      return "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300";
    default:
      return "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]";
  }
}

export default function AdminRiskPage() {
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [flags, setFlags] = useState<RiskFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, flagData] = await Promise.all([
        fetchRiskSummary(),
        fetchRiskFlags({
          severity: severityFilter || undefined,
          risk_type: typeFilter || undefined,
          status: statusFilter || undefined,
        }),
      ]);
      setSummary(summaryData);
      setFlags(flagData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load risk data");
    } finally {
      setLoading(false);
    }
  }, [severityFilter, statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReview(flag: RiskFlag) {
    const note = window.prompt("Review note (optional):", "") ?? "";
    setWorkingId(flag.id);
    try {
      await reviewRiskFlag(flag.id, "reviewed", note);
      notify("Risk flag marked as reviewed", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Review failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDismiss(flag: RiskFlag) {
    if (!window.confirm(`Dismiss ${formatRiskType(flag.risk_type)} flag for ${flag.username || flag.user_id}?`)) {
      return;
    }
    setWorkingId(flag.id);
    try {
      await reviewRiskFlag(flag.id, "dismissed");
      notify("Risk flag dismissed", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Dismiss failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleSuspend(flag: RiskFlag) {
    const reason = window.prompt(
      `Suspend ${flag.username || flag.user_id}? Enter reason:`,
      `Risk flag: ${flag.risk_type}`,
    );
    if (!reason) return;
    setWorkingId(flag.id);
    try {
      await suspendUser(flag.user_id, reason);
      await reviewRiskFlag(flag.id, "actioned", `User suspended: ${reason}`);
      notify("User suspended", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Suspend failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      await startRiskScan();
      notify("Risk scan started in background", { tone: "success" });
      window.setTimeout(() => void load(), 3000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Scan failed", { tone: "error" });
    } finally {
      setScanning(false);
    }
  }

  const openSeverity = summary?.open_by_severity;

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Risk Flags</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Automated detection of suspicious usage, sharing, and trial abuse
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleScan()}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <ScanSearch size={14} className={scanning ? "animate-spin" : ""} />
              Run scan
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {loading && !summary ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            Loading risk flags…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Critical", value: String(openSeverity?.critical ?? 0) },
                { label: "High", value: String(openSeverity?.high ?? 0) },
                { label: "Medium", value: String(openSeverity?.medium ?? 0) },
                { label: "Unreviewed", value: String(summary?.unreviewed ?? 0) },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                >
                  <p className="text-xs text-[var(--muted-foreground)]">{kpi.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{kpi.value}</p>
                </div>
              ))}
            </div>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Severity</label>
                  <select
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
                  >
                    <option value="">All</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Risk type</label>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
                  >
                    <option value="">All</option>
                    <option value="excessive_usage">Excessive usage</option>
                    <option value="account_sharing">Account sharing</option>
                    <option value="trial_abuse">Trial abuse</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
                  >
                    <option value="">All</option>
                    <option value="open">Open</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="actioned">Actioned</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="pb-2 pr-4 font-medium">User</th>
                      <th className="pb-2 pr-4 font-medium">Risk type</th>
                      <th className="pb-2 pr-4 font-medium">Severity</th>
                      <th className="pb-2 pr-4 font-medium">Details</th>
                      <th className="pb-2 pr-4 font-medium">Time</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {flags.map((flag) => (
                      <tr key={flag.id}>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-[var(--foreground)]">
                            {flag.username || flag.user_id}
                          </div>
                          <div className="font-mono text-xs text-[var(--muted-foreground)]">{flag.user_id}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium">
                            {formatRiskType(flag.risk_type)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${severityBadgeClass(flag.severity)}`}
                          >
                            {flag.severity}
                          </span>
                        </td>
                        <td className="max-w-xs py-3 pr-4 font-mono text-xs text-[var(--muted-foreground)]">
                          {formatRiskDetails(flag.details)}
                        </td>
                        <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                          {formatDateTime(flag.created_at)}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(flag.status)}`}
                          >
                            {flag.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {flag.status === "open" ? (
                              <>
                                <button
                                  onClick={() => void handleReview(flag)}
                                  disabled={workingId === flag.id}
                                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-40"
                                >
                                  Review
                                </button>
                                <button
                                  onClick={() => void handleDismiss(flag)}
                                  disabled={workingId === flag.id}
                                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-40"
                                >
                                  Dismiss
                                </button>
                                <button
                                  onClick={() => void handleSuspend(flag)}
                                  disabled={workingId === flag.id}
                                  className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-700 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-300"
                                >
                                  Suspend user
                                </button>
                              </>
                            ) : null}
                            <Link
                              href={`/admin/users/${encodeURIComponent(flag.user_id)}`}
                              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--background)]"
                            >
                              View user
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {flags.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                    No risk flags match the current filters.
                  </div>
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
