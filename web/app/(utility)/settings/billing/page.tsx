"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { QuotaBar } from "@/components/QuotaBar";
import { notify } from "@/lib/notifications";
import {
  createBillingOrder,
  fetchBillingMe,
  formatInr,
  formatPlanLimit,
  loadRazorpayCheckout,
  type BillingMeResponse,
  type BillingPlan,
  verifyBillingPayment,
} from "@/lib/billing-api";

const METRIC_LABELS: Record<string, string> = {
  chat_messages: "Chat messages",
  voice_minutes: "Voice minutes",
  quiz_generations: "Quiz generations",
  kb_uploads: "Knowledge uploads",
};

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

export default function BillingSettingsPage() {
  const [data, setData] = useState<BillingMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchBillingMe());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentPlanName = useMemo(
    () => data?.subscription?.plan_display ?? data?.usage.plan_display ?? "Free",
    [data],
  );

  async function startCheckout(plan: BillingPlan, periodMonths: 1 | 12) {
    if (!data?.razorpay_configured) {
      notify("Razorpay is not configured on the server", { tone: "error" });
      return;
    }
    const checkoutKey = `${plan.id}-${periodMonths}`;
    setCheckingOut(checkoutKey);
    try {
      const order = await createBillingOrder(plan.id, periodMonths);
      const ready = await loadRazorpayCheckout();
      if (!ready || !window.Razorpay) {
        throw new Error("Failed to load Razorpay checkout");
      }
      const amountLabel = formatInr(order.amount);
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "AIMTutor",
        description: `${plan.display_name} (${periodMonths === 12 ? "Yearly" : "Monthly"})`,
        order_id: order.order_id,
        theme: { color: "#6366f1" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await verifyBillingPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            notify(`Subscribed to ${plan.display_name} (${amountLabel})`, { tone: "success" });
            await load();
          } catch (e) {
            notify(e instanceof Error ? e.message : "Verification failed", { tone: "error" });
          } finally {
            setCheckingOut(null);
          }
        },
        modal: {
          ondismiss: () => setCheckingOut(null),
        },
      });
      rzp.open();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Checkout failed", { tone: "error" });
      setCheckingOut(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={15} />
            Dashboard
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

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            Loading billing…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : data ? (
          <>
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <CreditCard size={18} className="text-[var(--primary)]" />
                <h1 className="text-xl font-semibold text-[var(--foreground)]">Billing & Usage</h1>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Current plan</p>
                  <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{currentPlanName}</p>
                  {data.subscription ? (
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      Renews {formatDateTime(data.subscription.current_period_end)}
                      {data.subscription.cancel_at_period_end ? " (cancels at period end)" : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      Upgrade below to unlock higher limits.
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  {Object.entries(METRIC_LABELS).map(([metric, label]) => {
                    const entry = data.usage.usage[metric] ?? {
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
                        <QuotaBar
                          label={label}
                          used={entry.used}
                          limit={entry.limit}
                          unlimited={entry.unlimited}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Choose a plan</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {data.plans.map((plan) => {
                  const isCurrent =
                    data.subscription?.plan_id === plan.id ||
                    data.usage.plan_name === plan.name;
                  return (
                    <article
                      key={plan.id}
                      className={`flex flex-col rounded-2xl border p-5 shadow-sm ${
                        isCurrent
                          ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]"
                          : "border-[var(--border)] bg-[var(--card)]"
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-[var(--foreground)]">{plan.display_name}</h3>
                          <p className="text-xs text-[var(--muted-foreground)]">{plan.name}</p>
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <p className="text-2xl font-bold text-[var(--foreground)]">
                        {formatInr(Math.round(plan.price_monthly * 100))}
                        <span className="text-xs font-normal text-[var(--muted-foreground)]">/mo</span>
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        or {formatInr(Math.round(plan.price_yearly * 100))}/yr
                      </p>
                      <ul className="mt-4 flex-1 space-y-1.5 text-xs text-[var(--muted-foreground)]">
                        <li className="flex items-center gap-1.5">
                          <Check size={12} />
                          {formatPlanLimit(plan.chat_messages)} chat messages
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check size={12} />
                          {formatPlanLimit(plan.voice_minutes)} voice minutes
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check size={12} />
                          {formatPlanLimit(plan.quiz_generations)} quizzes
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check size={12} />
                          {formatPlanLimit(plan.kb_uploads)} KB uploads
                        </li>
                      </ul>
                      <div className="mt-4 space-y-2">
                        <button
                          onClick={() => startCheckout(plan, 1)}
                          disabled={
                            !data.razorpay_configured ||
                            checkingOut !== null ||
                            plan.price_monthly <= 0
                          }
                          className="w-full rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {checkingOut === `${plan.id}-1` ? "Opening…" : "Subscribe monthly"}
                        </button>
                        {plan.price_yearly > 0 ? (
                          <button
                            onClick={() => startCheckout(plan, 12)}
                            disabled={!data.razorpay_configured || checkingOut !== null}
                            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {checkingOut === `${plan.id}-12` ? "Opening…" : "Subscribe yearly"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!data.razorpay_configured ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Payments are unavailable until Razorpay keys are configured on the server.
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-[var(--foreground)]">Payment history</h2>
              {data.payments.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No payments yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium">Plan</th>
                        <th className="pb-2 pr-4 font-medium">Amount</th>
                        <th className="pb-2 pr-4 font-medium">Period</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {data.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                            {formatDateTime(payment.created_at)}
                          </td>
                          <td className="py-3 pr-4">{payment.plan_display ?? payment.plan_id}</td>
                          <td className="py-3 pr-4 font-medium">{formatInr(payment.amount)}</td>
                          <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                            {payment.period_months === 12 ? "Yearly" : "Monthly"}
                          </td>
                          <td className="py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(payment.status)}`}
                            >
                              {payment.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
