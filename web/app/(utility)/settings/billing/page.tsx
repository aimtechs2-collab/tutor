"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CreditCard, Loader2 } from "lucide-react";
import { QuotaBar } from "@/components/QuotaBar";
import { apiFetch, apiUrl } from "@/lib/api";

type UsageMetric = {
  used: number;
  limit: number;
  unlimited: boolean;
};

type QuotaSummary = {
  plan_name: string;
  plan_display: string;
  usage: Record<string, UsageMetric>;
};

const METRIC_LABELS: Record<string, string> = {
  chat_messages: "Chat messages",
  voice_minutes: "Voice minutes",
  quiz_generations: "Quiz generations",
  kb_uploads: "Knowledge uploads",
};

export default function BillingSettingsPage() {
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(apiUrl("/api/v1/quota/me"));
      if (!res.ok) throw new Error("Failed to load billing details");
      setQuota(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={15} />
            Dashboard
          </Link>
        </div>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard size={18} className="text-[var(--primary)]" />
            <h1 className="text-xl font-semibold text-[var(--foreground)]">Billing & Usage</h1>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              Loading plan…
            </div>
          ) : error ? (
            <p className="text-sm text-[var(--destructive)]">{error}</p>
          ) : quota ? (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Current plan</p>
                <span className="mt-1 inline-flex rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-3 py-1 text-sm font-medium text-[var(--primary)]">
                  {quota.plan_display}
                </span>
              </div>
              <div className="space-y-3">
                {Object.entries(METRIC_LABELS).map(([metric, label]) => {
                  const entry = quota.usage[metric] ?? {
                    used: 0,
                    limit: 0,
                    unlimited: false,
                  };
                  return (
                    <div key={metric}>
                      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>{label}</span>
                        <span>
                          {entry.unlimited
                            ? "Unlimited"
                            : `${Math.round(entry.used)} / ${entry.limit}`}
                        </span>
                      </div>
                      <QuotaBar used={entry.used} limit={entry.limit} unlimited={entry.unlimited} />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Usage resets monthly. Contact your administrator to upgrade your plan.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
