import { apiFetch, apiUrl } from "@/lib/api";

export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
  messages?: TicketMessage[];
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export async function fetchMyTickets(): Promise<SupportTicket[]> {
  const res = await apiFetch(apiUrl("/api/v1/support/tickets"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load tickets"));
  const data = await res.json();
  return data.tickets ?? [];
}

export async function fetchMyTicket(ticketId: string): Promise<SupportTicket> {
  const res = await apiFetch(apiUrl(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load ticket"));
  const data = await res.json();
  return data.ticket;
}

export async function createTicket(payload: {
  subject: string;
  body: string;
  category?: string;
  priority?: string;
}): Promise<SupportTicket> {
  const res = await apiFetch(apiUrl("/api/v1/support/tickets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create ticket"));
  const data = await res.json();
  return data.ticket;
}

export async function replyToTicket(ticketId: string, body: string): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/reply`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to send reply"));
  const data = await res.json();
  return data.ticket;
}

export async function fetchAdminTickets(filters?: {
  status?: string;
  priority?: string;
}): Promise<SupportTicket[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.priority) params.set("priority", filters.priority);
  const qs = params.toString();
  const res = await apiFetch(apiUrl(`/api/v1/admin/support/tickets${qs ? `?${qs}` : ""}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load tickets"));
  const data = await res.json();
  return data.tickets ?? [];
}

export async function fetchAdminTicket(ticketId: string): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}`),
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to load ticket"));
  const data = await res.json();
  return data.ticket;
}

export async function adminReplyToTicket(
  ticketId: string,
  payload: { body: string; is_internal?: boolean },
): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/reply`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to send reply"));
  const data = await res.json();
  return data.ticket;
}

export async function updateTicketStatus(ticketId: string, status: string): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/status`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to update status"));
  const data = await res.json();
  return data.ticket;
}

export async function assignTicket(
  ticketId: string,
  assignedTo: string | null,
): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/assign`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to: assignedTo }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to assign ticket"));
  const data = await res.json();
  return data.ticket;
}

export async function updateTicketPriority(
  ticketId: string,
  priority: string,
): Promise<SupportTicket> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/priority`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to update priority"));
  const data = await res.json();
  return data.ticket;
}

export async function aiSuggestReply(
  ticketId: string,
  context?: string,
): Promise<string> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/support/tickets/${encodeURIComponent(ticketId)}/ai-suggest`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: context ?? "" }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "AI suggest failed"));
  const data = await res.json();
  return String(data.suggestion ?? "");
}

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export function priorityColor(priority: string): string {
  switch (priority) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "medium":
      return "bg-yellow-500";
    default:
      return "bg-gray-400";
  }
}
