"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Flag,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import { fetchAuthStatus } from "@/lib/auth";
import {
  flagAdminConversation,
  getAdminConversation,
  listAdminConversations,
  type AdminConversationDetail,
  type AdminConversationSummary,
  type ConversationFlag,
} from "@/lib/admin-api";

const SimpleMarkdownRenderer = dynamic(
  () => import("@/components/common/SimpleMarkdownRenderer"),
  { ssr: false },
);

const CAPABILITIES = [
  { value: "all", label: "All capabilities" },
  { value: "chat", label: "Chat" },
  { value: "quiz", label: "Quiz" },
  { value: "research", label: "Research" },
  { value: "voice", label: "Voice" },
] as const;

const FLAG_FILTERS = [
  { value: "all", label: "All" },
  { value: "flagged", label: "Flagged" },
  { value: "unflagged", label: "Unflagged" },
] as const;

const FLAG_OPTIONS = [
  { type: "harmful_content", label: "Harmful content", emoji: "🚫" },
  { type: "hallucination", label: "Possible hallucination", emoji: "🤔" },
  { type: "user_frustration", label: "User frustration", emoji: "😤" },
  { type: "policy_violation", label: "Policy violation", emoji: "⚠️" },
  { type: "wrong_answer", label: "Wrong answer", emoji: "❌" },
  { type: "abuse", label: "Abuse", emoji: "🔞" },
] as const;

function formatTimestamp(value?: number | string): string {
  if (value === undefined || value === null || value === "") return "—";
  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function flagLabel(flagType: string): string {
  return (
    FLAG_OPTIONS.find((option) => option.type === flagType)?.label ?? flagType
  );
}

function userInitials(username: string): string {
  const parts = username.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function capabilityLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("question") || normalized.includes("quiz")) return "Quiz";
  if (normalized.includes("research")) return "Research";
  if (normalized.includes("voice") || normalized.includes("live")) return "Voice";
  if (!normalized || normalized === "chat") return "Chat";
  return value.replace(/^deep_/, "").replace(/_/g, " ");
}

export default function AdminConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<AdminConversationSummary[]>([]);
  const [selected, setSelected] = useState<AdminConversationSummary | null>(null);
  const [detail, setDetail] = useState<AdminConversationDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [capability, setCapability] = useState("all");
  const [flagFilter, setFlagFilter] = useState("all");
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  const [flagReason, setFlagReason] = useState("");

  const unresolvedFlags = useMemo(
    () => detail?.flag_info.unresolved ?? [],
    [detail],
  );

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError("");
    try {
      const items = await listAdminConversations({
        search: search.trim() || undefined,
        capability,
        flag_filter: flagFilter,
        limit: 100,
      });
      setConversations(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
    } finally {
      setLoadingList(false);
    }
  }, [capability, flagFilter, search]);

  const loadDetail = useCallback(async (item: AdminConversationSummary) => {
    setLoadingDetail(true);
    try {
      const payload = await getAdminConversation(item.session_id, item.user_id);
      setDetail(payload);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load conversation", {
        tone: "error",
      });
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      void loadList();
    });
  }, [loadList, router]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void loadDetail(selected);
  }, [loadDetail, selected]);

  async function handleFlag(flagType: string) {
    if (!selected) return;
    setWorking(true);
    try {
      await flagAdminConversation(selected.session_id, {
        user_id: selected.user_id,
        flag_type: flagType,
        reason: flagReason.trim(),
      });
      notify("Conversation flagged", { tone: "success" });
      setShowFlagMenu(false);
      setFlagReason("");
      await loadList();
      await loadDetail(selected);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to flag conversation", {
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  }

  function renderFlagBanner(flags: ConversationFlag[]) {
    if (flags.length === 0) return null;
    const latest = flags[0];
    return (
      <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] px-4 py-3 text-sm text-[var(--foreground)]">
        <div className="font-medium">
          Flagged: {flagLabel(latest.flag_type)}
        </div>
        {latest.reason ? (
          <p className="mt-1 text-[var(--muted-foreground)]">{latest.reason}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--primary)]">
            <MessageSquare size={18} />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-[var(--foreground)]">
              AI Conversations
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Review, search, and flag conversations across all users
            </p>
          </div>
          <button
            onClick={loadList}
            disabled={loadingList}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-4 rounded-lg border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--destructive)]">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section className="flex w-[40%] min-w-[280px] flex-col border-r border-[var(--border)] bg-[var(--card)]">
          <div className="space-y-3 border-b border-[var(--border)] p-4">
            <label className="relative block">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadList();
                }}
                placeholder="Search titles…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                {CAPABILITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={flagFilter}
                onChange={(e) => setFlagFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                {FLAG_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => void loadList()}
              className="w-full rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--background)] hover:opacity-90"
            >
              Apply filters
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
                <Loader2 size={16} className="mr-2 animate-spin" />
                Loading conversations…
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-[var(--muted-foreground)]">
                No conversations match these filters.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {conversations.map((item) => {
                  const isActive =
                    selected?.session_id === item.session_id &&
                    selected?.user_id === item.user_id;
                  return (
                    <li key={`${item.user_id}:${item.session_id}`}>
                      <button
                        onClick={() => setSelected(item)}
                        className={`w-full px-4 py-3 text-left transition-colors ${
                          isActive
                            ? "bg-[color-mix(in_srgb,var(--primary)_10%,var(--background))]"
                            : "hover:bg-[var(--background)]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] text-xs font-semibold text-[var(--primary)]">
                            {userInitials(item.username)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-[var(--foreground)]">
                                {item.username}
                              </span>
                              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                                {capabilityLabel(item.capability)}
                              </span>
                              {item.flagged ? (
                                <span title="Flagged" aria-label="Flagged">
                                  🚩
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-sm text-[var(--foreground)]">
                              {item.title || "Untitled"}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                              <span>{item.message_count} messages</span>
                              <span>·</span>
                              <span>{formatTimestamp(item.updated_at)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--muted-foreground)]">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--border)] px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-[var(--foreground)]">
                    {selected.username}
                  </h2>
                  <span className="rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
                    {detail?.plan_display ?? "Free"}
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                    {capabilityLabel(selected.capability)}
                  </span>
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setShowFlagMenu((open) => !open)}
                      disabled={working}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-40"
                    >
                      <Flag size={14} />
                      Flag
                      <ChevronDown size={14} />
                    </button>
                    {showFlagMenu ? (
                      <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl">
                        <textarea
                          value={flagReason}
                          onChange={(e) => setFlagReason(e.target.value)}
                          rows={3}
                          placeholder="Optional reason…"
                          className="mb-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                        />
                        {FLAG_OPTIONS.map((option) => (
                          <button
                            key={option.type}
                            onClick={() => void handleFlag(option.type)}
                            disabled={working}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--background)] disabled:opacity-40"
                          >
                            <span>{option.emoji}</span>
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {selected.title || "Untitled conversation"}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Loading thread…
                  </div>
                ) : detail ? (
                  <>
                    {renderFlagBanner(unresolvedFlags)}
                    <div className="space-y-4">
                      {(detail.session.messages ?? []).map((message, index) => {
                        const isUser = message.role === "user";
                        return (
                          <div
                            key={`${message.id ?? index}`}
                            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                                isUser
                                  ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-[var(--foreground)]"
                                  : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
                              }`}
                            >
                              <div className="prose prose-sm max-w-none dark:prose-invert">
                                <SimpleMarkdownRenderer
                                  content={message.content || ""}
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                                <span>{formatTimestamp(message.created_at)}</span>
                                {message.capability ? (
                                  <>
                                    <span>·</span>
                                    <span>{capabilityLabel(message.capability)}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
                    Conversation unavailable
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
