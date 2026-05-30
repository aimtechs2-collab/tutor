import { apiFetch, apiUrl } from "@/lib/api";

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  category: string;
  read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  subject: string;
  html_body: string;
  created_at: string;
  updated_at: string;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export async function fetchNotifications(options?: {
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<AppNotification[]> {
  const params = new URLSearchParams();
  if (options?.unread_only) params.set("unread_only", "true");
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  const res = await apiFetch(apiUrl(`/api/v1/notifications${qs ? `?${qs}` : ""}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load notifications"));
  const data = await res.json();
  return data.notifications ?? [];
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiFetch(apiUrl("/api/v1/notifications/unread-count"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load count"));
  const data = await res.json();
  return Number(data.count ?? 0);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to mark read"));
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiFetch(apiUrl("/api/v1/notifications/read-all"), { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to mark all read"));
  const data = await res.json();
  return Number(data.updated ?? 0);
}

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  const res = await apiFetch(apiUrl("/api/v1/admin/notifications/templates"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load templates"));
  const data = await res.json();
  return data.templates ?? [];
}

export async function createEmailTemplate(payload: {
  key: string;
  name: string;
  subject: string;
  html_body: string;
}): Promise<EmailTemplate> {
  const res = await apiFetch(apiUrl("/api/v1/admin/notifications/templates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create template"));
  const data = await res.json();
  return data.template;
}

export async function updateEmailTemplate(
  templateId: string,
  payload: Partial<{ key: string; name: string; subject: string; html_body: string }>,
): Promise<EmailTemplate> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/notifications/templates/${encodeURIComponent(templateId)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to update template"));
  const data = await res.json();
  return data.template;
}

export async function adminSendNotification(payload: {
  segment: string;
  user_ids?: string[];
  title: string;
  body?: string;
  type?: string;
  category?: string;
  send_email?: boolean;
  email_subject?: string;
  email_html?: string;
}): Promise<{ created: number; emails_sent: number }> {
  const res = await apiFetch(apiUrl("/api/v1/admin/notifications/send"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to send notification"));
  return res.json();
}

export const NOTIFICATION_SEGMENTS = [
  { value: "all", label: "All active users" },
  { value: "plan:free", label: "Free plan" },
  { value: "plan:basic", label: "Basic plan" },
  { value: "plan:pro", label: "Pro plan" },
  { value: "plan:premium", label: "Premium plan" },
] as const;

export const EMAIL_TEMPLATE_VARS = ["{{username}}", "{{user_id}}", "{{plan}}", "{{app_name}}"];
