"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Brain, LayoutDashboard, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/QuotaBar";
import { apiFetch, apiUrl } from "@/lib/api";
import { fetchMemorySnapshot, type RawMemorySnapshot } from "@/lib/memory-graph";

type Activity = {
  id: string;
  type: string;
  title: string;
  timestamp: number;
  summary?: string;
};

type UsageMetric = {
  used: number;
  limit: number;
  unlimited: boolean;
};

type QuotaSummary = {
  plan_name: string;
  plan_display: string;
  usage: Record<string, UsageMetric>;
};

const METRIC_LABELS: Record<string, string> = {
  chat_messages: "Chat messages",
  voice_minutes: "Voice minutes",
  quiz_generations: "Quiz generations",
  kb_uploads: "Knowledge uploads",
};

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "—";
  const deltaMs = Date.now() - timestamp * 1000;
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function memoryEntityCount(snapshot: RawMemorySnapshot | null): number {
  if (!snapshot) return 0;
  return Object.values(snapshot.l1).reduce((sum, entities) => sum + entities.length, 0);
}

function memoryDocCount(snapshot: RawMemorySnapshot | null): number {
  if (!snapshot) return 0;
  const l2Count = Object.values(snapshot.l2).reduce(
    (sum, doc) => sum + (doc.entries?.length ?? 0),
    0,
  );
  const l3Count = Object.values(snapshot.l3).reduce(
    (sum, doc) => sum + (doc.entries?.length ?? 0),
    0,
  );
  return l2Count + l3Count;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [memorySnapshot, setMemorySnapshot] = useState<RawMemorySnapshot | null>(null);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [loadingMemory, setLoadingMemory] = useState(true);
  const [loadingQuota, setLoadingQuota] = useState(true);
  const [error, setError] = useState("");

  const loadActivities = useCallback(async () => {
    setLoadingActivities(true);
    try {
      const res = await apiFetch(apiUrl("/api/v1/dashboard/recent?limit=12"));
      if (!res.ok) throw new Error("Failed to load recent activity");
      const data = (await res.json()) as Activity[];
      setActivities(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoadingActivities(false);
    }
  }, []);

  const loadMemory = useCallback(async () => {
    setLoadingMemory(true);
    try {
      setMemorySnapshot(await fetchMemorySnapshot());
    } catch {
      setMemorySnapshot(null);
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  const loadQuota = useCallback(async () => {
    setLoadingQuota(true);
    try {
      const res = await apiFetch(apiUrl("/api/v1/quota/me"));
      if (!res.ok) throw new Error("Failed to load quota");
      setQuota((await res.json()) as QuotaSummary);
    } catch {
      setQuota(null);
    } finally {
      setLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    void loadActivities();
    void loadMemory();
    void loadQuota();
  }, [loadActivities, loadMemory, loadQuota]);

  const memoryStats = useMemo(
    () => ({
      entities: memoryEntityCount(memorySnapshot),
      docs: memoryDocCount(memorySnapshot),
    }),
    [memorySnapshot],
  );

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl px-6 py-10 pb-16 md:px-10">
        <div className="mb-8 flex items-start gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2.5 text-[var(--primary)]">
            <LayoutDashboard size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">
              {t("Dashboard")}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Overview of your recent learning activities")}
            </p>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                Recent activity
              </h2>
              {loadingActivities ? (
                <Loader2 size={16} className="animate-spin text-[var(--muted-foreground)]" />
              ) : null}
            </div>

            {loadingActivities ? (
              <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                Loading…
              </div>
            ) : activities.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                {t("No recent activity found")}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {activities.map((activity) => (
                  <li key={activity.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/chat/${encodeURIComponent(activity.id)}`}
                          className="truncate text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                        >
                          {activity.title || "Untitled"}
                        </Link>
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                          {activity.summary || activity.type}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain size={16} className="text-[var(--primary)]" />
                  <h2 className="text-sm font-semibold text-[var(--foreground)]">
                    Memory snapshot
                  </h2>
                </div>
                {loadingMemory ? (
                  <Loader2 size={16} className="animate-spin text-[var(--muted-foreground)]" />
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3">
                  <p className="text-xs text-[var(--muted-foreground)]">L1 entities</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                    {memoryStats.entities}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3">
                  <p className="text-xs text-[var(--muted-foreground)]">L2/L3 entries</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                    {memoryStats.docs}
                  </p>
                </div>
              </div>
              <Link
                href="/memory"
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:opacity-80"
              >
                Open memory hub
                <ArrowUpRight size={14} />
              </Link>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--foreground)]">Your Plan</h2>
                  {quota ? (
                    <span className="mt-1 inline-flex rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
                      {quota.plan_display}
                    </span>
                  ) : null}
                </div>
                {loadingQuota ? (
                  <Loader2 size={16} className="animate-spin text-[var(--muted-foreground)]" />
                ) : null}
              </div>

              {loadingQuota ? (
                <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
                  Loading usage…
                </div>
              ) : quota ? (
                <div className="space-y-1">
                  {Object.entries(METRIC_LABELS).map(([metric, label]) => {
                    const entry = quota.usage[metric] ?? {
                      used: 0,
                      limit: 0,
                      unlimited: false,
                    };
                    return (
                      <QuotaBar
                        key={metric}
                        label={label}
                        used={entry.used}
                        limit={entry.limit}
                        unlimited={entry.unlimited}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
                  Usage unavailable
                </div>
              )}

              <Link
                href="/settings/billing"
                className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
              >
                Upgrade
              </Link>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
