"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { ArrowLeft, Cpu, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  fetchAdminAiCosts,
  formatInr,
  formatUsd,
  type AdminAiCostsResponse,
  type AiCostUserRow,
} from "@/lib/billing-api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function currentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function profitClass(profitUsd: number): string {
  if (profitUsd >= 0) {
    return "text-green-700 dark:text-green-300";
  }
  return "text-red-700 dark:text-red-300";
}

function profitBadgeClass(profitable: boolean): string {
  return profitable
    ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
}

export default function AdminAiCostsPage() {
  const [periodKey, setPeriodKey] = useState(currentMonthKey);
  const [data, setData] = useState<AdminAiCostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchAdminAiCosts(periodKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI cost analytics");
    } finally {
      setLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const capabilityChart = useMemo(() => {
    const rows = data?.platform.by_capability ?? [];
    const palette = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6"];
    return {
      labels: rows.map((row) => row.capability),
      datasets: [
        {
          label: "Cost (USD)",
          data: rows.map((row) => row.cost_usd),
          backgroundColor: rows.map((_, index) => palette[index % palette.length]),
          borderRadius: 6,
        },
      ],
    };
  }, [data]);

  const platform = data?.platform;

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/billing"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft size={14} />
              Billing
            </Link>
            <div className="flex items-center gap-2">
              <Cpu size={20} className="text-[var(--primary)]" />
              <div>
                <h1 className="text-xl font-semibold text-[var(--foreground)]">AI Cost Analytics</h1>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Per-user API spend and profit analysis
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted-foreground)]" htmlFor="period-key">
              Period
            </label>
            <input
              id="period-key"
              type="month"
              value={periodKey}
              onChange={(event) => setPeriodKey(event.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--foreground)]"
            />
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            Loading AI cost analytics…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : platform ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Total AI cost",
                  value: formatUsd(platform.total_cost_usd),
                  sub: `${platform.record_count} records · ${platform.active_users} users`,
                },
                {
                  label: "Avg per user",
                  value: formatUsd(platform.avg_cost_per_user_usd),
                  sub: `${platform.input_tokens.toLocaleString()} in / ${platform.output_tokens.toLocaleString()} out tokens`,
                },
                {
                  label: "Most expensive feature",
                  value: platform.most_expensive_capability,
                  sub: `${Math.round(platform.audio_duration_secs / 60)} voice min tracked`,
                },
                {
                  label: "MRR vs cost",
                  value: formatUsd(platform.mrr_vs_cost_usd),
                  sub: `MRR ${formatInr(Math.round(platform.mrr_inr * 100))} · cost ${formatUsd(platform.total_cost_usd)}`,
                  positive: platform.mrr_vs_cost_usd >= 0,
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                >
                  <p className="text-xs text-[var(--muted-foreground)]">{kpi.label}</p>
                  <p
                    className={`mt-2 text-2xl font-semibold ${
                      kpi.positive === undefined
                        ? "text-[var(--foreground)]"
                        : kpi.positive
                          ? "text-green-700 dark:text-green-300"
                          : "text-red-700 dark:text-red-300"
                    }`}
                  >
                    {kpi.value}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{kpi.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  Cost by capability
                </h2>
                <div className="h-72">
                  {capabilityChart.labels.length > 0 ? (
                    <Bar
                      data={capabilityChart}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: "y" as const,
                        plugins: { legend: { display: false } },
                        scales: {
                          x: {
                            beginAtZero: true,
                            ticks: {
                              callback: (value) => `$${value}`,
                            },
                          },
                        },
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
                      No AI usage recorded for this period
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  Plan profitability
                </h2>
                <div className="space-y-3">
                  {(data?.plans ?? []).length > 0 ? (
                    data?.plans.map((plan) => (
                      <div
                        key={plan.plan_id}
                        className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--foreground)]">{plan.display_name}</p>
                            <p className="text-xs text-[var(--muted-foreground)]">
                              {plan.active_users} active users · list {formatInr(Math.round(plan.price_monthly_inr * 100))}/mo
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${profitBadgeClass(plan.avg_profit_usd >= 0)}`}
                          >
                            {plan.avg_profit_usd >= 0 ? (
                              <TrendingUp size={12} />
                            ) : (
                              <TrendingDown size={12} />
                            )}
                            {formatUsd(plan.avg_profit_usd)}/user
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-[var(--muted-foreground)]">Avg revenue</p>
                            <p className="font-medium text-[var(--foreground)]">
                              {formatUsd(plan.avg_revenue_usd)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[var(--muted-foreground)]">Avg AI cost</p>
                            <p className="font-medium text-[var(--foreground)]">
                              {formatUsd(plan.avg_cost_usd)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
                      No plan data available
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                Cost per user
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="pb-2 pr-4 font-medium">User</th>
                      <th className="pb-2 pr-4 font-medium">Plan</th>
                      <th className="pb-2 pr-4 font-medium">AI cost</th>
                      <th className="pb-2 pr-4 font-medium">Revenue</th>
                      <th className="pb-2 pr-4 font-medium">Profit</th>
                      <th className="pb-2 pr-4 font-medium">Tokens</th>
                      <th className="pb-2 font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {(data?.users ?? []).map((row: AiCostUserRow) => (
                      <tr key={row.user_id}>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-[var(--foreground)]">
                            {row.username || row.user_id}
                          </div>
                          <div className="font-mono text-xs text-[var(--muted-foreground)]">
                            {row.user_id}
                          </div>
                        </td>
                        <td className="py-3 pr-4">{row.plan_display}</td>
                        <td className="py-3 pr-4 font-medium">{formatUsd(row.cost_usd)}</td>
                        <td className="py-3 pr-4">
                          {row.revenue_paise > 0 ? formatInr(row.revenue_paise) : "—"}
                        </td>
                        <td className={`py-3 pr-4 font-semibold ${profitClass(row.profit_usd)}`}>
                          {formatUsd(row.profit_usd)}
                        </td>
                        <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                          {row.input_tokens.toLocaleString()} / {row.output_tokens.toLocaleString()}
                        </td>
                        <td className="py-3 text-[var(--muted-foreground)]">{row.record_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(data?.users ?? []).length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                    No per-user AI costs for {periodKey}
                  </div>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
