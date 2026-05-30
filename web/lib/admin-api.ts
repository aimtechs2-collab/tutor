import { apiFetch, apiUrl } from "@/lib/api";

export interface UserRecord {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: string;
  disabled?: boolean;
  suspended_at?: string;
  suspension_reason?: string;
  banned?: boolean;
  ban_reason?: string;
  admin_role?: string | null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const res = await apiFetch(apiUrl("/api/v1/auth/users"));
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function deleteUser(username: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(username)}`),
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to delete user");
  }
}

export async function setUserRole(
  username: string,
  role: "admin" | "user",
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(username)}/role`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to update role");
  }
}

export interface CreatedUser {
  user_id: string;
  username: string;
  role: "admin" | "user";
  is_admin: boolean;
}

export async function createUser(
  username: string,
  password: string,
): Promise<CreatedUser> {
  const res = await apiFetch(apiUrl("/api/v1/auth/users"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail.length > 0 && detail[0]?.msg
          ? String(detail[0].msg)
          : "Failed to create user";
    throw new Error(message);
  }
  return (await res.json()) as CreatedUser;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const users = await listUsers();
  return users.find((user) => user.id === userId) ?? null;
}

async function postUserControl(
  userId: string,
  action: "suspend" | "unsuspend" | "ban" | "reset-password",
  body?: Record<string, unknown>,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(userId)}/${action}`),
    {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? `Failed to ${action.replace("-", " ")} user`);
  }
}

export async function suspendUser(userId: string, reason: string): Promise<void> {
  await postUserControl(userId, "suspend", { reason });
}

export async function unsuspendUser(userId: string): Promise<void> {
  await postUserControl(userId, "unsuspend");
}

export async function banUser(userId: string, reason: string): Promise<void> {
  await postUserControl(userId, "ban", { reason });
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await postUserControl(userId, "reset-password", {
    new_password: newPassword,
  });
}

export async function setAdminRole(
  userId: string,
  adminRole: string | null,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/auth/users/${encodeURIComponent(userId)}/admin-role`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_role: adminRole }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to set admin role");
  }
}

export interface UserQuotaSummary {
  plan_name: string;
  plan_display: string;
  usage: Record<string, { used: number; limit: number; unlimited: boolean }>;
}

export async function getUserQuota(userId: string): Promise<UserQuotaSummary> {
  const res = await apiFetch(
    apiUrl(`/api/v1/quota/admin/users/${encodeURIComponent(userId)}`),
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to fetch user quota"));
  return res.json();
}

export interface PlanRecord {
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
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlanWritePayload {
  name: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  chat_messages: number;
  voice_minutes: number;
  quiz_generations: number;
  kb_uploads: number;
}

export interface PlanUserRecord {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  expires_at: string | null;
  username: string;
  role: string;
  disabled: boolean;
  banned: boolean;
}

async function parseApiError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
    return String(detail[0].msg);
  }
  return fallback;
}

export async function listPlans(): Promise<PlanRecord[]> {
  const res = await apiFetch(apiUrl("/api/v1/quota/admin/plans"));
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to fetch plans"));
  return res.json();
}

export async function createPlan(payload: PlanWritePayload): Promise<PlanRecord> {
  const res = await apiFetch(apiUrl("/api/v1/quota/admin/plans"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to create plan"));
  return res.json();
}

export async function updatePlan(
  planId: string,
  payload: PlanWritePayload,
): Promise<PlanRecord> {
  const res = await apiFetch(apiUrl(`/api/v1/quota/admin/plans/${encodeURIComponent(planId)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to update plan"));
  return res.json();
}

export async function deactivatePlan(planId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/quota/admin/plans/${encodeURIComponent(planId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to deactivate plan"));
}

export async function assignPlanToUser(
  userId: string,
  planId: string,
  expiresAt?: string | null,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/quota/admin/users/${encodeURIComponent(userId)}/assign-plan`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId, expires_at: expiresAt ?? null }),
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to assign plan"));
}

export async function listPlanUsers(planId: string): Promise<PlanUserRecord[]> {
  const res = await apiFetch(
    apiUrl(`/api/v1/quota/admin/plans/${encodeURIComponent(planId)}/users`),
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to fetch plan users"));
  return res.json();
}

export interface AdminConversationSummary {
  session_id: string;
  title: string;
  capability: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  status: string;
  last_message: string;
  user_id: string;
  username: string;
  flagged: boolean;
  flags: ConversationFlag[];
}

export interface ConversationFlag {
  id: string;
  session_id: string;
  user_id: string;
  flag_type: string;
  reason: string;
  flagged_by: string;
  resolved: boolean;
  created_at: string;
}

export interface ConversationMessage {
  id?: number;
  role: string;
  content: string;
  capability?: string;
  created_at?: number;
}

export interface AdminConversationDetail {
  session: {
    session_id?: string;
    id?: string;
    title?: string;
    capability?: string;
    messages: ConversationMessage[];
    [key: string]: unknown;
  };
  user_id: string;
  username: string;
  plan_name: string;
  plan_display: string;
  flag_info: {
    flagged: boolean;
    flags: ConversationFlag[];
    unresolved: ConversationFlag[];
  };
}

export async function listAdminConversations(params: {
  user_id?: string;
  capability?: string;
  search?: string;
  flag_filter?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminConversationSummary[]> {
  const query = new URLSearchParams();
  if (params.user_id) query.set("user_id", params.user_id);
  if (params.capability && params.capability !== "all") {
    query.set("capability", params.capability);
  }
  if (params.search) query.set("search", params.search);
  if (params.flag_filter && params.flag_filter !== "all") {
    query.set("flag_filter", params.flag_filter);
  }
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/admin/conversations?${query.toString()}`),
  );
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Failed to fetch conversations"));
  }
  const data = (await res.json()) as { conversations: AdminConversationSummary[] };
  return data.conversations ?? [];
}

export async function getAdminConversation(
  sessionId: string,
  userId: string,
): Promise<AdminConversationDetail> {
  const query = new URLSearchParams({ user_id: userId });
  const res = await apiFetch(
    apiUrl(
      `/api/v1/multi-user/admin/conversations/${encodeURIComponent(sessionId)}?${query.toString()}`,
    ),
  );
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Failed to fetch conversation"));
  }
  return res.json();
}

export async function flagAdminConversation(
  sessionId: string,
  payload: { user_id: string; flag_type: string; reason?: string },
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/multi-user/admin/conversations/${encodeURIComponent(sessionId)}/flag`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Failed to flag conversation"));
  }
}
