"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Users, BarChart2, ScrollText } from "lucide-react";
import { apiUrl } from "@/lib/api";

interface Report {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  icon: React.ElementType;
  params?: { name: string; label: string; type: string; placeholder?: string }[];
}

const REPORTS: Report[] = [
  {
    id: "users",
    title: "User Report",
    description: "All registered users with role, status, join date, and suspension details.",
    endpoint: "/api/v1/admin/reports/users",
    icon: Users,
  },
  {
    id: "plans",
    title: "Plans & Subscriptions",
    description: "All subscription plans with active user counts and pricing.",
    endpoint: "/api/v1/admin/reports/plans",
    icon: FileSpreadsheet,
  },
  {
    id: "usage",
    title: "Usage Report",
    description: "AI chat, voice, quiz, and KB upload usage per user for a given month.",
    endpoint: "/api/v1/admin/reports/usage",
    icon: BarChart2,
    params: [
      { name: "period", label: "Month (YYYY-MM)", type: "text", placeholder: new Date().toISOString().slice(0, 7) },
    ],
  },
  {
    id: "audit",
    title: "Audit Log Export",
    description: "Full history of admin actions — suspensions, plan changes, role updates.",
    endpoint: "/api/v1/admin/reports/audit",
    icon: ScrollText,
  },
];

export default function AdminReportsPage() {
  const [params, setParams] = useState<Record<string, Record<string, string>>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (report: Report) => {
    setDownloading(report.id);
    try {
      const reportParams = params[report.id] ?? {};
      const query = new URLSearchParams(
        Object.entries(reportParams).filter(([, v]) => v.trim())
      ).toString();
      const url = apiUrl(`${report.endpoint}${query ? `?${query}` : ""}`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = objectUrl;
      a.download = `${report.id}-${date}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
            Reports
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Export platform data as CSV for analysis or reporting
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {REPORTS.map((report) => {
            const Icon = report.icon;
            const isDownloading = downloading === report.id;
            return (
              <div
                key={report.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="mb-3 flex items-start gap-3">
                  <div
                    className="rounded-lg p-2"
                    style={{ background: "color-mix(in srgb, var(--primary) 12%, var(--card))" }}
                  >
                    <Icon size={16} style={{ color: "var(--primary)" }} />
                  </div>
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--foreground)" }}>
                      {report.title}
                    </h3>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {report.description}
                    </p>
                  </div>
                </div>

                {report.params && (
                  <div className="mb-3 space-y-2">
                    {report.params.map((p) => (
                      <div key={p.name}>
                        <label className="mb-1 block text-xs font-medium"
                          style={{ color: "var(--muted-foreground)" }}>
                          {p.label}
                        </label>
                        <input
                          type={p.type}
                          placeholder={p.placeholder}
                          value={params[report.id]?.[p.name] ?? ""}
                          onChange={(e) =>
                            setParams((prev) => ({
                              ...prev,
                              [report.id]: { ...prev[report.id], [p.name]: e.target.value },
                            }))
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none"
                          style={{ color: "var(--foreground)" }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => handleDownload(report)}
                  disabled={isDownloading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-50"
                  style={{
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                  }}
                >
                  <Download size={14} className={isDownloading ? "animate-bounce" : ""} />
                  {isDownloading ? "Downloading…" : "Download CSV"}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
          Reports are generated live and reflect the current state of the database.
        </p>
      </div>
    </div>
  );
}
