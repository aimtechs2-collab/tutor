"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { IndianRupee, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  fetchAdminBillingPayments,
  formatInr,
  refundBillingPayment,
  type AdminBillingResponse,
  type BillingPayment,
} from "@/lib/billing-api";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

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

function statusBadgeClass(status: string): string {
  switch (status) {
    case "paid":
      return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
    case "refunded":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]";
  }
}

export default function AdminBillingPage() {
  const [data, setData] = useState<AdminBillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchAdminBillingPayments());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revenueChart = useMemo(() => {
    const days = data?.summary.revenue_by_day ?? [];
    return {
      labels: days.map((item) => {
        try {
          return new Date(item.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        } catch {
          return item.day;
        }
      }),
      datasets: [
        {
          label: "Revenue (INR)",
          data: days.map((item) => item.revenue_paise / 100),
          backgroundColor: "#6366f1",
          borderRadius: 6,
        },
      ],
    };
  }, [data]);

  const planChart = useMemo(() => {
    const plans = (data?.summary.revenue_by_plan ?? []).filter((item) => item.revenue_paise > 0);
    const palette = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6"];
    return {
      labels: plans.map((item) => item.label),
      datasets: [
        {
          data: plans.map((item) => item.revenue_paise / 100),
          backgroundColor: plans.map((_, index) => palette[index % palette.length]),
          borderWidth: 0,
        },
      ],
    };
  }, [data]);

  async function handleRefund(payment: BillingPayment) {
    if (payment.status !== "paid") return;
    const confirmed = window.confirm(
      `Refund ${formatInr(payment.amount)} for ${payment.username || payment.user_id}?`,
    );
    if (!confirmed) return;
    setRefundingId(payment.id);
    try {
      await refundBillingPayment(payment.id);
      notify("Refund processed", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Refund failed", { tone: "error" });
    } finally {
      setRefundingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IndianRupee size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Billing & Revenue</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Razorpay payments, subscriptions, and refunds
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/billing/costs"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              AI costs
            </Link>
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
            Loading billing analytics…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Total revenue",
                  value: formatInr(data.summary.total_revenue_paise),
                },
                {
                  label: "Successful payments",
                  value: String(data.summary.paid_count),
                },
                {
                  label: "Active subscriptions",
                  value: String(data.summary.active_subscriptions),
                },
                {
                  label: "Refunded",
                  value: formatInr(data.summary.refunded_paise),
                },
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

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  Revenue (last 30 days)
                </h2>
                <div className="h-64">
                  <Bar
                    data={revenueChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: (value) => `₹${value}`,
                          },
                        },
                      },
                    }}
                  />
                </div>
              </section>
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  Revenue by plan
                </h2>
                <div className="mx-auto h-64 max-w-sm">
                  {planChart.labels.length > 0 ? (
                    <Doughnut
                      data={planChart}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: "bottom" },
                        },
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
                      No paid revenue yet
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">Payments</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="pb-2 pr-4 font-medium">Date</th>
                      <th className="pb-2 pr-4 font-medium">User</th>
                      <th className="pb-2 pr-4 font-medium">Plan</th>
                      <th className="pb-2 pr-4 font-medium">Amount</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Razorpay ID</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                          {formatDateTime(payment.created_at)}
                        </td>
                        <td className="py-3 pr-4">{payment.username || payment.user_id}</td>
                        <td className="py-3 pr-4">{payment.plan_display ?? payment.plan_name}</td>
                        <td className="py-3 pr-4 font-medium">{formatInr(payment.amount)}</td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(payment.status)}`}
                          >
                            {payment.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs text-[var(--muted-foreground)]">
                          {payment.razorpay_payment_id ?? payment.razorpay_order_id}
                        </td>
                        <td className="py-3 text-right">
                          {payment.status === "paid" ? (
                            <button
                              onClick={() => handleRefund(payment)}
                              disabled={refundingId === payment.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                            >
                              <RotateCcw size={12} className={refundingId === payment.id ? "animate-spin" : ""} />
                              Refund
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
