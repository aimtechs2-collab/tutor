"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, CheckCircle } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

interface RiskFlag {
  id: string;
  session_id: string;
  user_id: string;
  username: string;
  flag_type: string;
  reason: string;
  flagged_by: string;
  resolved: boolean;
  created_at: string;
}

const FLAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  harmful:          { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", label: "Harmful content" },
  hallucination:    { bg: "rgba(245,158,11,0.12)",  text: "#f59e0b", label: "Hallucination" },
  abuse:            { bg: "rgba(220,38,38,0.12)",   text: "#dc2626", label: "Abuse" },
  policy_violation: { bg: "rgba(249,115,22,0.12)",  text: "#f97316", label: "Policy violation" },
  wrong_answer:     { bg: "rgba(139,92,246,0.12)",  text: "#8b5cf6", label: "Wrong answer" },
  user_frustration: { bg: "rgba(99,102,241,0.12)",  text: "#6366f1", label: "User frustration" },
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminRiskPage() {
  const [flags, setFlags] = useState<RiskFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch(apiUrl("/api/v1/multi-user/admin/risk/flags"))
      .then((r) => r.json())
      .then((d: RiskFlag[]) => setFlags(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleResolve = async (flagId: string) => {
    setResolvingId(flagId);
    try {
      await apiFetch(apiUrl(`/api/v1/multi-user/admin/risk/flags/${flagId}/resolve`), { method: "POST" });
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch {}
    setResolvingId(null);
  };

  const counts = flags.reduce<Record<string, number>>((acc, f) => {
    acc[f.flag_type] = (acc[f.flag_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
              Risk Review
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              {flags.length} unresolved flag{flags.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
            style={{ color: "var(--muted-foreground)" }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Summary badges */}
        {Object.keys(counts).length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {Object.entries(counts).map(([type, count]) => {
              const style = FLAG_STYLES[type] ?? { bg: "var(--muted)", text: "var(--muted-foreground)", label: type };
              return (
                <span key={type} className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{ background: style.bg, color: style.text }}>
                  {style.label}: {count}
                </span>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl"
                style={{ background: "var(--muted)" }} />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-12 text-center shadow-sm">
            <CheckCircle size={32} className="mx-auto mb-3" style={{ color: "#22c55e" }} />
            <p className="font-medium" style={{ color: "var(--foreground)" }}>No unresolved flags</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              All AI conversations are looking clean.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {flags.map((flag) => {
              const style = FLAG_STYLES[flag.flag_type] ??
                { bg: "var(--muted)", text: "var(--muted-foreground)", label: flag.flag_type };
              return (
                <div key={flag.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{ background: style.bg, color: style.text }}>
                          {style.label}
                        </span>
                        <Link href={`/admin/users/${encodeURIComponent(flag.user_id)}`}
                          className="text-sm font-medium hover:underline"
                          style={{ color: "var(--foreground)" }}>
                          {flag.username}
                        </Link>
                        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                          {relTime(flag.created_at)}
                        </span>
                      </div>
                      {flag.reason && (
                        <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
                          {flag.reason}
                        </p>
                      )}
                      <div className="mt-2 flex gap-3">
                        <Link
                          href={`/admin/conversations?session=${flag.session_id}&user=${flag.user_id}`}
                          className="text-xs underline"
                          style={{ color: "var(--primary)" }}
                        >
                          View conversation →
                        </Link>
                        <Link
                          href={`/admin/users/${encodeURIComponent(flag.user_id)}`}
                          className="text-xs underline"
                          style={{ color: "var(--primary)" }}
                        >
                          View user →
                        </Link>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResolve(flag.id)}
                      disabled={resolvingId === flag.id}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                      style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}
                    >
                      {resolvingId === flag.id ? "Resolving…" : "✓ Resolve"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
