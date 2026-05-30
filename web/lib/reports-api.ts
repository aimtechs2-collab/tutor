import { apiFetch, apiUrl } from "@/lib/api";

export type ReportFormat = "csv" | "json";

export interface ReportFilters {
  date_from?: string;
  date_to?: string;
  plan?: string;
  status?: string;
  period?: string;
  format?: ReportFormat;
}

function buildQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.format) params.set("format", filters.format);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  if (filters.plan) params.set("plan", filters.plan);
  if (filters.status) params.set("status", filters.status);
  if (filters.period) params.set("period", filters.period);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function downloadReport(
  kind: "users" | "revenue" | "ai-usage" | "activity",
  filters: ReportFilters = {},
): Promise<void> {
  const path = `/api/v1/admin/reports/${kind}${buildQuery({ ...filters, format: "csv" })}`;
  const res = await apiFetch(apiUrl(path));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.detail === "string" ? data.detail : "Download failed");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? `${kind}-report.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
