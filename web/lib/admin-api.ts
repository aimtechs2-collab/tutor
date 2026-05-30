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
