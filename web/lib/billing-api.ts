import { apiFetch, apiUrl } from "@/lib/api";

export interface BillingPlan {
  id: string;
  name: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  chat_messages: number;
  voice_minutes: number;
  quiz_generations: number;
  kb_uploads: number;
  is_active: boolean;
}

export interface BillingPayment {
  id: string;
  user_id: string;
  plan_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  period_months: number;
  created_at: string;
  updated_at: string;
  plan_name?: string;
  plan_display?: string;
  username?: string;
}

export interface BillingSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  plan_name?: string;
  plan_display?: string;
}

export interface BillingMeResponse {
  subscription: BillingSubscription | null;
  usage: {
    plan_name: string;
    plan_display: string;
    usage: Record<string, { used: number; limit: number; unlimited: boolean }>;
  };
  payments: BillingPayment[];
  plans: BillingPlan[];
  razorpay_configured: boolean;
}

export interface CreateOrderResponse {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  period_months: number;
  plan: { id: string; name: string; display_name: string };
}

export interface AdminBillingSummary {
  total_revenue_paise: number;
  paid_count: number;
  refunded_paise: number;
  refunded_count: number;
  active_subscriptions: number;
  revenue_by_day: Array<{ day: string; revenue_paise: number }>;
  revenue_by_plan: Array<{ label: string; revenue_paise: number }>;
}

export interface AdminBillingResponse {
  summary: AdminBillingSummary;
  payments: BillingPayment[];
}

export interface AiCostCapabilityBreakdown {
  capability: string;
  cost_usd: number;
  calls: number;
}

export interface AiCostPlatformSummary {
  period_key: string;
  total_cost_usd: number;
  avg_cost_per_user_usd: number;
  most_expensive_capability: string;
  revenue_paise: number;
  revenue_usd: number;
  mrr_inr: number;
  mrr_usd: number;
  mrr_vs_cost_usd: number;
  profit_usd: number;
  active_users: number;
  active_subscriptions: number;
  record_count: number;
  input_tokens: number;
  output_tokens: number;
  audio_duration_secs: number;
  by_capability: AiCostCapabilityBreakdown[];
}

export interface AiCostUserRow {
  user_id: string;
  username: string;
  cost_usd: number;
  revenue_usd: number;
  revenue_paise: number;
  profit_usd: number;
  profitable: boolean;
  input_tokens: number;
  output_tokens: number;
  record_count: number;
  plan_id: string | null;
  plan_display: string;
  plan_name: string;
}

export interface AiCostPlanProfitability {
  plan_id: string;
  display_name: string;
  name: string;
  price_monthly_inr: number;
  avg_cost_usd: number;
  avg_revenue_usd: number;
  avg_profit_usd: number;
  active_users: number;
}

export interface AdminAiCostsResponse {
  period_key: string;
  platform: AiCostPlatformSummary;
  users: AiCostUserRow[];
  plans: AiCostPlanProfitability[];
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
    return String(detail[0].msg);
  }
  return fallback;
}

export async function fetchBillingMe(): Promise<BillingMeResponse> {
  const res = await apiFetch(apiUrl("/api/v1/billing/me"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load billing"));
  return res.json();
}

export async function createBillingOrder(
  planId: string,
  periodMonths: 1 | 12,
): Promise<CreateOrderResponse> {
  const res = await apiFetch(apiUrl("/api/v1/billing/create-order"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId, period_months: periodMonths }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create order"));
  return res.json();
}

export async function verifyBillingPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean; payment: BillingPayment; subscription: BillingSubscription | null }> {
  const res = await apiFetch(apiUrl("/api/v1/billing/verify-payment"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Payment verification failed"));
  return res.json();
}

export async function fetchAdminBillingPayments(): Promise<AdminBillingResponse> {
  const res = await apiFetch(apiUrl("/api/v1/admin/billing/payments"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load admin billing"));
  return res.json();
}

export async function fetchAdminAiCosts(periodKey?: string): Promise<AdminAiCostsResponse> {
  const params = new URLSearchParams();
  if (periodKey) params.set("period_key", periodKey);
  const query = params.toString();
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/billing/ai-costs${query ? `?${query}` : ""}`),
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to load AI cost analytics"));
  return res.json();
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export async function refundBillingPayment(
  paymentId: string,
  amountPaise?: number,
): Promise<void> {
  const res = await apiFetch(apiUrl("/api/v1/admin/billing/refund"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_id: paymentId, amount_paise: amountPaise ?? null }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Refund failed"));
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function formatPlanLimit(value: number): string {
  return value === -1 ? "Unlimited" : String(value);
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
