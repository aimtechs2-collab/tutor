"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LifeBuoy, Loader2, Send, Sparkles, CheckCircle2 } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  adminReplyToTicket,
  aiSuggestReply,
  fetchAdminTicket,
  fetchAdminTickets,
  priorityColor,
  updateTicketPriority,
  updateTicketStatus,
  type SupportTicket,
} from "@/lib/support-api";

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [replying, setReplying] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminTickets({
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
      });
      setTickets(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTicket(null);
      return;
    }
    setLoadingThread(true);
    fetchAdminTicket(selectedId)
      .then(setSelectedTicket)
      .catch((e) => notify(e instanceof Error ? e.message : "Failed to load ticket", { tone: "error" }))
      .finally(() => setLoadingThread(false));
  }, [selectedId]);

  const selectedSummary = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  async function handleReply() {
    if (!selectedId || !replyBody.trim()) return;
    setReplying(true);
    try {
      const ticket = await adminReplyToTicket(selectedId, {
        body: replyBody.trim(),
        is_internal: isInternal,
      });
      setSelectedTicket(ticket);
      setReplyBody("");
      setIsInternal(false);
      await loadTickets();
      notify(isInternal ? "Internal note added" : "Reply sent", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Reply failed", { tone: "error" });
    } finally {
      setReplying(false);
    }
  }

  async function handleAiSuggest() {
    if (!selectedId) return;
    setSuggesting(true);
    try {
      const suggestion = await aiSuggestReply(selectedId);
      setReplyBody(suggestion);
      setIsInternal(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : "AI suggest failed", { tone: "error" });
    } finally {
      setSuggesting(false);
    }
  }

  async function handleResolve() {
    if (!selectedId) return;
    setWorking(true);
    try {
      await updateTicketStatus(selectedId, "resolved");
      await loadTickets();
      const ticket = await fetchAdminTicket(selectedId);
      setSelectedTicket(ticket);
      notify("Ticket resolved", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Update failed", { tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function handlePriorityChange(priority: string) {
    if (!selectedId) return;
    try {
      await updateTicketPriority(selectedId, priority);
      await loadTickets();
      const ticket = await fetchAdminTicket(selectedId);
      setSelectedTicket(ticket);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Priority update failed", { tone: "error" });
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col bg-[var(--background)]">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <div className="flex items-center gap-2">
          <LifeBuoy size={20} className="text-[var(--primary)]" />
          <div>
            <h1 className="text-lg font-semibold text-[var(--foreground)]">Support Queue</h1>
            <p className="text-xs text-[var(--muted-foreground)]">Manage customer tickets</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Left panel — ticket list */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]">
          <div className="space-y-2 border-b border-[var(--border)] p-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
            >
              <option value="">All statuses</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
            >
              <option value="">All priorities</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={22} className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">No tickets</p>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setSelectedId(ticket.id)}
                  className={`block w-full border-b border-[var(--border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--background)] ${
                    selectedId === ticket.id ? "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityColor(ticket.priority)}`}
                      title={ticket.priority}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--foreground)]">
                        {ticket.subject}
                      </div>
                      <div className="truncate text-xs text-[var(--muted-foreground)]">
                        {ticket.last_message || "No messages"}
                      </div>
                      <div className="mt-0.5 text-[10px] capitalize text-[var(--muted-foreground)]">
                        {ticket.status.replace("_", " ")} · {ticket.user_id.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right panel — thread */}
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
              Select a ticket from the list
            </div>
          ) : loadingThread || !selectedTicket ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                <div>
                  <h2 className="font-medium text-[var(--foreground)]">{selectedTicket.subject}</h2>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    User {selectedTicket.user_id} · {selectedTicket.category}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTicket.priority}
                    onChange={(e) => void handlePriorityChange(e.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs capitalize"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={working || selectedTicket.status === "resolved"}
                    onClick={() => void handleResolve()}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} />
                    Resolve
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {(selectedTicket.messages ?? []).map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      msg.is_internal
                        ? "border border-amber-200 bg-amber-50 text-amber-950"
                        : msg.author_role === "user"
                          ? "ml-12 bg-[var(--card)] text-[var(--foreground)]"
                          : "mr-12 bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] text-[var(--foreground)]"
                    }`}
                  >
                    {msg.is_internal ? (
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        🔒 Internal note
                      </span>
                    ) : null}
                    <p className="whitespace-pre-wrap">{msg.body}</p>
                    <p className="mt-1 text-[10px] opacity-70">
                      {msg.author_role} · {new Date(msg.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-[var(--border)] bg-[var(--card)] p-3">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={4}
                  placeholder="Write a reply or internal note..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                    />
                    Internal note (not visible to user)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={suggesting}
                      onClick={() => void handleAiSuggest()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--background)] disabled:opacity-60"
                    >
                      {suggesting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      AI Suggest
                    </button>
                    <button
                      type="button"
                      disabled={replying}
                      onClick={() => void handleReply()}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {replying ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Send
                    </button>
                  </div>
                </div>
                {selectedSummary ? (
                  <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                    Status: {selectedSummary.status.replace("_", " ")}
                    {selectedSummary.assigned_to ? ` · Assigned: ${selectedSummary.assigned_to}` : ""}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
