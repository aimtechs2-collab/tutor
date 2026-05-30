import { apiFetch, apiUrl } from "@/lib/api";

export type AnalyticsPeriod = "7d" | "30d" | "90d";

export interface KpiMetric {
  value: number;
  delta_pct: number;
  sparkline: number[];
}

export interface AnalyticsOverview {
  period: AnalyticsPeriod;
  days: number;
  kpis: {
    total_users: KpiMetric;
    active_today: KpiMetric;
    new_this_period: KpiMetric;
    churn: KpiMetric;
    mrr_inr: KpiMetric;
    arr_inr: KpiMetric;
    arpu_inr: KpiMetric;
    paid_users: KpiMetric;
    ai_cost_usd: KpiMetric;
    cost_per_user_usd: KpiMetric;
    open_tickets: KpiMetric;
    risk_flags: KpiMetric;
    period_revenue_inr?: number;
    mrr_usd?: number;
  };
  trends: {
    daily_active_users: Array<{ day: string; count: number }>;
    new_signups: Array<{ day: string; count: number }>;
    revenue_paise_by_day: Array<{ day: string; revenue_paise: number }>;
    ai_cost_usd_by_day: Array<{ day: string; cost_usd: number }>;
  };
  top_capabilities: Array<{ capability: string; cost_usd: number; calls: number }>;
  plan_distribution: Array<{ plan: string; count: number }>;
  ticket_status_distribution: Array<{ status: string; count: number }>;
  recent_signups: Array<{ id: string; username: string; created_at: string; plan: string }>;
  recent_payments: Array<{
    id: string;
    user_id: string;
    username: string;
    amount_paise: number;
    currency: string;
    status: string;
    created_at: string;
    plan: string;
  }>;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export async function fetchAnalyticsOverview(period: AnalyticsPeriod): Promise<AnalyticsOverview> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/admin/analytics/overview?period=${encodeURIComponent(period)}`),
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to load analytics"));
  return res.json();
}
