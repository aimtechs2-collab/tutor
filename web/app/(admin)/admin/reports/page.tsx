"use client";

import { useState } from "react";
import { Download, FileDown, Loader2 } from "lucide-react";
import { notify } from "@/lib/notifications";
import { downloadReport } from "@/lib/reports-api";

type ReportKind = "users" | "revenue" | "ai-usage" | "activity";

interface ReportCardProps {
  title: string;
  description: string;
  kind: ReportKind;
  children?: React.ReactNode;
}

function ReportCard({ title, description, kind, children }: ReportCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadReport(kind, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        plan: plan || undefined,
        status: status || undefined,
        period: period || undefined,
      });
      notify("Report downloaded", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Download failed", { tone: "error" });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] p-2 text-[var(--primary)]">
          <FileDown size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-[var(--muted-foreground)]">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--muted-foreground)]">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          />
        </div>
        {kind === "users" ? (
          <>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Plan</label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
              >
                <option value="">All plans</option>
                <option value="free">Free</option>
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
              </select>
            </div>
          </>
        ) : null}
        {kind === "ai-usage" ? (
          <div className="sm:col-span-2">
            <label className="text-xs text-[var(--muted-foreground)]">Billing period (YYYY-MM)</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
            />
          </div>
        ) : null}
        {children}
      </div>
      <button
        type="button"
        disabled={downloading}
        onClick={() => void handleDownload()}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Download CSV
      </button>
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-2">
          <FileDown size={20} className="text-[var(--primary)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">Reports</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Export business data as CSV for finance and leadership
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ReportCard
            kind="users"
            title="User Report"
            description="Accounts with plan, status, sessions, quiz usage, voice minutes, and monthly AI cost."
          />
          <ReportCard
            kind="revenue"
            title="Revenue Report"
            description="Payment history with user, plan, amount, and status."
          />
          <ReportCard
            kind="ai-usage"
            title="AI Usage Report"
            description="Per-user capability and model costs with token totals."
          />
          <ReportCard
            kind="activity"
            title="Activity Report"
            description="Recent login events with IP and country for security review."
          />
        </div>
      </div>
    </div>
  );
}
