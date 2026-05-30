import { apiFetch, apiUrl } from "@/lib/api";

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  last_run_at: string | null;
  run_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationLog {
  id: string;
  rule_id: string;
  user_id: string | null;
  triggered: boolean;
  actions: Array<Record<string, unknown>>;
  success: boolean;
  error: string;
  created_at: string;
  rule_name: string;
  username: string;
}

export const AUTOMATION_TRIGGERS = [
  { type: "user.inactive_days", label: "User inactive (days)", paramKey: "days", defaultValue: 14 },
  { type: "user.trial_ending_days", label: "Trial ending (days)", paramKey: "days", defaultValue: 3 },
  { type: "user.quota_percent", label: "Quota usage (%)", paramKey: "percent", defaultValue: 90, metricKey: "metric", metricDefault: "chat_messages" },
  { type: "user.failed_payment", label: "Failed payment (hours)", paramKey: "within_hours", defaultValue: 24 },
  { type: "schedule.daily", label: "Daily schedule", paramKey: "hour_utc", defaultValue: 9 },
] as const;

export const AUTOMATION_ACTIONS = [
  { type: "send_in_app_notification", label: "Send in-app notification" },
  { type: "suspend_user", label: "Suspend user" },
  { type: "add_quota_bonus", label: "Add quota bonus" },
  { type: "create_risk_flag", label: "Create risk flag" },
  { type: "notify_admin", label: "Notify admin" },
  { type: "log_event", label: "Log event" },
] as const;

export const AUTOMATION_TEMPLATES = [
  {
    name: "Re-engage inactive users",
    description: "Notify users inactive for 14+ days",
    trigger: { type: "user.inactive_days", days: 14 },
    actions: [{ type: "send_in_app_notification", title: "We miss you", message: "Hi {username}, come back to AIMTutor!" }],
  },
  {
    name: "Suspend long-inactive accounts",
    description: "Suspend users inactive 30+ days",
    trigger: { type: "user.inactive_days", days: 30 },
    actions: [{ type: "suspend_user", reason: "Inactive for 30+ days (automation)" }],
  },
  {
    name: "Trial ending reminder",
    description: "Notify users 3 days before trial ends",
    trigger: { type: "user.trial_ending_days", days: 3 },
    actions: [{ type: "send_in_app_notification", title: "Trial ending soon", message: "Hi {username}, your trial ends in 3 days." }],
  },
  {
    name: "Quota nearly exhausted",
    description: "Notify at 90% chat quota",
    trigger: { type: "user.quota_percent", metric: "chat_messages", percent: 90 },
    actions: [{ type: "send_in_app_notification", title: "Quota alert", message: "Hi {username}, you are nearing your chat limit." }],
  },
  {
    name: "Failed payment follow-up",
    description: "Alert admins on recent failed payments",
    trigger: { type: "user.failed_payment", within_hours: 24 },
    actions: [
      { type: "notify_admin", message: "Failed payment for user {username} ({user_id})" },
      { type: "send_in_app_notification", title: "Payment failed", message: "Hi {username}, please update your billing details." },
    ],
  },
  {
    name: "Daily admin digest",
    description: "Run once per day and log summary",
    trigger: { type: "schedule.daily", hour_utc: 9 },
    actions: [{ type: "log_event", message: "Daily automation digest executed for rule {rule_id}" }],
  },
] as const;

export function triggerParamFromTrigger(
  trigger: Record<string, unknown>,
  fallback: number,
): number {
  const raw =
    trigger.days ??
    trigger.percent ??
    trigger.within_hours ??
    trigger.hour_utc ??
    fallback;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
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

export async function fetchAutomationRules(): Promise<AutomationRule[]> {
  const res = await apiFetch(apiUrl("/api/v1/admin/automation/rules"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load automation rules"));
  const data = await res.json();
  return data.rules ?? [];
}

export async function createAutomationRule(payload: {
  name: string;
  description: string;
  enabled: boolean;
  trigger: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
}): Promise<AutomationRule> {
  const res = await apiFetch(apiUrl("/api/v1/admin/automation/rules"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create rule"));
  const data = await res.json();
  return data.rule;
}

export async function updateAutomationRule(
  ruleId: string,
  payload: {
    name: string;
    description: string;
    enabled: boolean;
    trigger: Record<string, unknown>;
    actions: Array<Record<string, unknown>>;
  },
): Promise<AutomationRule> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/automation/rules/${encodeURIComponent(ruleId)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update rule"));
  const data = await res.json();
  return data.rule;
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/automation/rules/${encodeURIComponent(ruleId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete rule"));
}

export async function toggleAutomationRule(ruleId: string): Promise<AutomationRule> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/automation/rules/${encodeURIComponent(ruleId)}/toggle`), {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to toggle rule"));
  const data = await res.json();
  return data.rule;
}

export async function runAutomationRuleNow(ruleId: string): Promise<number> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/automation/rules/${encodeURIComponent(ruleId)}/run-now`), {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to run rule"));
  const data = await res.json();
  return Number(data.actions_taken ?? 0);
}

export async function fetchAutomationLogs(ruleId?: string): Promise<AutomationLog[]> {
  const params = new URLSearchParams();
  if (ruleId) params.set("rule_id", ruleId);
  const query = params.toString();
  const res = await apiFetch(apiUrl(`/api/v1/admin/automation/logs${query ? `?${query}` : ""}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load automation logs"));
  const data = await res.json();
  return data.logs ?? [];
}

export function formatTriggerLabel(trigger: Record<string, unknown>): string {
  const type = String(trigger.type ?? "unknown");
  const base = AUTOMATION_TRIGGERS.find((item) => item.type === type)?.label ?? type;
  const param = trigger.days ?? trigger.percent ?? trigger.within_hours ?? trigger.hour_utc;
  if (param !== undefined) {
    return `${base}: ${param}`;
  }
  return base;
}
