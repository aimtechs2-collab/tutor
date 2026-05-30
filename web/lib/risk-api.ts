import { apiFetch, apiUrl } from "@/lib/api";

export interface RiskFlag {
  id: string;
  user_id: string;
  username: string;
  risk_type: string;
  severity: string;
  details: Record<string, unknown>;
  status: string;
  reviewed_by: string | null;
  review_note: string;
  created_at: string;
  updated_at: string;
}

export interface RiskSummary {
  unreviewed: number;
  open_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  by_severity_status: Array<{ severity: string; status: string; count: number }>;
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

export async function fetchRiskSummary(): Promise<RiskSummary> {
  const res = await apiFetch(apiUrl("/api/v1/admin/risk/summary"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load risk summary"));
  return res.json();
}

export async function fetchRiskFlags(params?: {
  severity?: string;
  risk_type?: string;
  status?: string;
}): Promise<RiskFlag[]> {
  const search = new URLSearchParams();
  if (params?.severity) search.set("severity", params.severity);
  if (params?.risk_type) search.set("risk_type", params.risk_type);
  if (params?.status) search.set("status", params.status);
  const query = search.toString();
  const res = await apiFetch(apiUrl(`/api/v1/admin/risk/flags${query ? `?${query}` : ""}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load risk flags"));
  const data = await res.json();
  return data.flags ?? [];
}

export async function reviewRiskFlag(
  flagId: string,
  status: "reviewed" | "dismissed" | "actioned",
  note = "",
): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/risk/flags/${encodeURIComponent(flagId)}/review`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update risk flag"));
}

export async function startRiskScan(): Promise<void> {
  const res = await apiFetch(apiUrl("/api/v1/admin/risk/scan"), { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to start risk scan"));
}

export function formatRiskType(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatRiskDetails(details: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return "—";
  try {
    return JSON.stringify(details, null, 0).slice(0, 180);
  } catch {
    return "—";
  }
}
