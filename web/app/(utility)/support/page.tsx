"use client";

import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Loader2, Plus, Send } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  createTicket,
  fetchMyTicket,
  fetchMyTickets,
  replyToTicket,
  type SupportTicket,
} from "@/lib/support-api";

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyTickets();
      setTickets(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTicket(null);
      return;
    }
    setLoadingThread(true);
    fetchMyTicket(selectedId)
      .then(setSelectedTicket)
      .catch((e) => notify(e instanceof Error ? e.message : "Failed to load ticket", { tone: "error" }))
      .finally(() => setLoadingThread(false));
  }, [selectedId]);

  async function handleCreate() {
    if (!subject.trim() || !body.trim()) {
      notify("Subject and message are required", { tone: "error" });
      return;
    }
    setCreating(true);
    try {
      const ticket = await createTicket({ subject: subject.trim(), body: body.trim() });
      notify("Ticket created", { tone: "success" });
      setShowModal(false);
      setSubject("");
      setBody("");
      await loadTickets();
      setSelectedId(ticket.id);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Create failed", { tone: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function handleReply() {
    if (!selectedId || !replyBody.trim()) return;
    setReplying(true);
    try {
      const ticket = await replyToTicket(selectedId, replyBody.trim());
      setSelectedTicket(ticket);
      setReplyBody("");
      notify("Reply sent", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Reply failed", { tone: "error" });
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LifeBuoy size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Support</h1>
              <p className="text-sm text-[var(--muted-foreground)]">Get help from our team</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus size={14} />
            New ticket
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] lg:col-span-2">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={22} className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">No tickets yet</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedId(ticket.id)}
                    className={`block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--background)] ${
                      selectedId === ticket.id ? "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]" : ""
                    }`}
                  >
                    <div className="font-medium text-sm text-[var(--foreground)]">{ticket.subject}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <span className="capitalize">{ticket.status.replace("_", " ")}</span>
                      <span>·</span>
                      <span>{new Date(ticket.updated_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] lg:col-span-3">
            {!selectedId ? (
              <p className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
                Select a ticket to view the thread
              </p>
            ) : loadingThread || !selectedTicket ? (
              <div className="flex justify-center py-12">
                <Loader2 size={22} className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : (
              <div className="flex h-full min-h-[400px] flex-col">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h2 className="font-medium text-[var(--foreground)]">{selectedTicket.subject}</h2>
                  <p className="text-xs capitalize text-[var(--muted-foreground)]">
                    {selectedTicket.status.replace("_", " ")} · {selectedTicket.priority} priority
                  </p>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {(selectedTicket.messages ?? []).map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        msg.author_role === "user"
                          ? "ml-8 bg-[var(--background)] text-[var(--foreground)]"
                          : "mr-8 bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] text-[var(--foreground)]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.body}</p>
                      <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        {new Date(msg.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                {!["closed", "resolved"].includes(selectedTicket.status) ? (
                  <div className="border-t border-[var(--border)] p-3">
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={3}
                      placeholder="Write a reply..."
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={replying}
                      onClick={() => void handleReply()}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {replying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send reply
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">New support ticket</h2>
            <div className="mt-4 space-y-3">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Describe your issue..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-[var(--muted-foreground)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
