import { apiFetch, apiUrl } from "@/lib/api";

export interface AdminAgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdminAgentChatResponse {
  response: string;
  tool_calls_made: string[];
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

export async function sendAdminAgentMessage(
  message: string,
  history: AdminAgentChatMessage[],
): Promise<AdminAgentChatResponse> {
  const res = await apiFetch(apiUrl("/api/v1/admin/agent/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Admin agent request failed"));
  return res.json();
}
