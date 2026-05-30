"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  ArrowDownRight,
  ArrowUpRight,
  LayoutDashboard,
  Loader2,
  Minus,
  RefreshCw,
} from "lucide-react";
import {
  fetchAnalyticsOverview,
  type AnalyticsOverview,
  type AnalyticsPeriod,
  type KpiMetric,
} from "@/lib/analytics-api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
);

const PERIODS: AnalyticsPeriod[] = ["7d", "30d", "90d"];

function formatNumber(value: number, decimals = 0): string {
  if (decimals > 0) return value.toFixed(decimals);
  return Math.round(value).toLocaleString();
}

function formatInr(value: number): string {
  return `₹${formatNumber(value, value < 100 ? 2 : 0)}`;
}

function formatUsd(value: number): string {
  return `$${formatNumber(value, value < 1 ? 4 : 2)}`;
}

function dayLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function Sparkline({ points, color = "#6366f1" }: { points: number[]; color?: string }) {
  const width = 72;
  const height = 28;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const coords = points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="opacity-80">
      <polyline fill="none" stroke={color} strokeWidth="2" points={coords} />
    </svg>
  );
}

function TrendBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-[var(--muted-foreground)]">
        <Minus size={12} /> 0%
      </span>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${up ? "text-green-600" : "text-red-500"}`}
    >
      <Icon size={12} />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label,
  metric,
  formatter = formatNumber,
}: {
  label: string;
  metric: KpiMetric;
  formatter?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-semibold text-[var(--foreground)]">
            {formatter(metric.value)}
          </p>
          <TrendBadge delta={metric.delta_pct} />
        </div>
        <Sparkline points={metric.sparkline} />
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchAnalyticsOverview(period));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const dauSignupChart = useMemo(() => {
    const dau = data?.trends.daily_active_users ?? [];
    const signups = data?.trends.new_signups ?? [];
    const labels = dau.length >= signups.length ? dau.map((d) => dayLabel(d.day)) : signups.map((d) => dayLabel(d.day));
    return {
      labels,
      datasets: [
        {
          label: "Daily active users",
          data: dau.map((d) => d.count),
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.1)",
          yAxisID: "y",
          tension: 0.3,
        },
        {
          label: "New signups",
          data: signups.map((d) => d.count),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.1)",
          yAxisID: "y1",
          tension: 0.3,
        },
      ],
    };
  }, [data]);

  const revenueCostChart = useMemo(() => {
    const revenue = data?.trends.revenue_paise_by_day ?? [];
    const costs = data?.trends.ai_cost_usd_by_day ?? [];
    const daySet = new Set([...revenue.map((r) => r.day), ...costs.map((c) => c.day)]);
    const labels = [...daySet].sort().map(dayLabel);
    const revMap = Object.fromEntries(revenue.map((r) => [r.day, r.revenue_paise / 100]));
    const costMap = Object.fromEntries(costs.map((c) => [c.day, c.cost_usd * 83]));
    const sortedDays = [...daySet].sort();
    return {
      labels,
      datasets: [
        {
          label: "Revenue (INR)",
          data: sortedDays.map((d) => revMap[d] ?? 0),
          backgroundColor: "#6366f1",
          stack: "stack",
        },
        {
          label: "AI cost (INR equiv.)",
          data: sortedDays.map((d) => costMap[d] ?? 0),
          backgroundColor: "#f59e0b",
          stack: "stack",
        },
      ],
    };
  }, [data]);

  const planChart = useMemo(() => {
    const plans = data?.plan_distribution ?? [];
    const palette = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6"];
    return {
      labels: plans.map((p) => p.plan),
      datasets: [
        {
          data: plans.map((p) => p.count),
          backgroundColor: plans.map((_, i) => palette[i % palette.length]),
        },
      ],
    };
  }, [data]);

  const capabilityChart = useMemo(() => {
    const caps = data?.top_capabilities ?? [];
    return {
      labels: caps.map((c) => c.capability),
      datasets: [
        {
          label: "Cost (USD)",
          data: caps.map((c) => c.cost_usd),
          backgroundColor: "#6366f1",
        },
      ],
    };
  }, [data]);

  const ticketChart = useMemo(() => {
    const tickets = data?.ticket_status_distribution ?? [];
    const palette = ["#ef4444", "#f59e0b", "#22c55e", "#94a3b8"];
    return {
      labels: tickets.map((t) => t.status.replace("_", " ")),
      datasets: [
        {
          data: tickets.map((t) => t.count),
          backgroundColor: tickets.map((_, i) => palette[i % palette.length]),
        },
      ],
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <Loader2 size={28} className="animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={22} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Analytics Overview</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Business intelligence across users, revenue, and AI operations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border)] p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    period === p
                      ? "bg-[var(--primary)] text-white"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-foreground)] hover:bg-[var(--card)]"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Total Users" metric={data.kpis.total_users} />
              <KpiCard label="Active Today" metric={data.kpis.active_today} />
              <KpiCard label="New This Period" metric={data.kpis.new_this_period} />
              <KpiCard label="Churn" metric={data.kpis.churn} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="MRR" metric={data.kpis.mrr_inr} formatter={formatInr} />
              <KpiCard label="ARR" metric={data.kpis.arr_inr} formatter={formatInr} />
              <KpiCard label="ARPU" metric={data.kpis.arpu_inr} formatter={formatInr} />
              <KpiCard label="Paid Users" metric={data.kpis.paid_users} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="AI Cost" metric={data.kpis.ai_cost_usd} formatter={formatUsd} />
              <KpiCard label="Cost / User" metric={data.kpis.cost_per_user_usd} formatter={formatUsd} />
              <KpiCard label="Open Tickets" metric={data.kpis.open_tickets} />
              <KpiCard label="Risk Flags" metric={data.kpis.risk_flags} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">
                  Daily Active Users & Signups
                </h2>
                <div className="mt-4 h-64">
                  <Line
                    data={dauSignupChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      interaction: { mode: "index", intersect: false },
                      scales: {
                        y: { type: "linear", position: "left", beginAtZero: true },
                        y1: {
                          type: "linear",
                          position: "right",
                          beginAtZero: true,
                          grid: { drawOnChartArea: false },
                        },
                      },
                    }}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Revenue vs AI Cost</h2>
                <div className="mt-4 h-64">
                  <Bar
                    data={revenueCostChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true },
                      },
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Plan Distribution</h2>
                <div className="mx-auto mt-4 h-52 max-w-xs">
                  <Doughnut data={planChart} options={{ maintainAspectRatio: false }} />
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Top Capabilities</h2>
                <div className="mt-4 h-52">
                  <Bar
                    data={capabilityChart}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                    }}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Ticket Status</h2>
                <div className="mx-auto mt-4 h-52 max-w-xs">
                  <Doughnut data={ticketChart} options={{ maintainAspectRatio: false }} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Recent Signups</h2>
                <div className="mt-3 divide-y divide-[var(--border)]">
                  {data.recent_signups.map((user) => (
                    <div key={user.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{user.username}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{user.plan}</p>
                      </div>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {dayLabel(user.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Recent Payments</h2>
                <div className="mt-3 divide-y divide-[var(--border)]">
                  {data.recent_payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {payment.username || payment.user_id.slice(0, 8)}
                        </p>
                        <p className="text-xs capitalize text-[var(--muted-foreground)]">
                          {payment.status} · {payment.plan || "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatInr(payment.amount_paise / 100)}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {dayLabel(payment.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
