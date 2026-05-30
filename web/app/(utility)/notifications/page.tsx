"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notifications-api";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchNotifications({
        unread_only: filter === "unread",
        limit: 100,
      });
      setNotifications(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMarkRead(item: AppNotification) {
    if (item.read) return;
    try {
      await markNotificationRead(item.id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read: true, read_at: new Date().toISOString() } : n,
        ),
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to mark read", { tone: "error" });
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      notify("All notifications marked read", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", { tone: "error" });
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Notifications</h1>
              <p className="text-sm text-[var(--muted-foreground)]">Your in-app messages</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--card)]"
          >
            <CheckCheck size={14} />
            Mark all read
          </button>
        </div>

        <div className="flex gap-2">
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${
                filter === value
                  ? "bg-[var(--primary)] text-white"
                  : "border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--card)]"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center text-sm text-[var(--muted-foreground)]">
            No notifications
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void handleMarkRead(item)}
                className={`block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--background)] ${
                  item.read ? "opacity-70" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-[var(--foreground)]">{item.title}</span>
                  {!item.read ? (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                  ) : null}
                </div>
                {item.body ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{item.body}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {new Date(item.created_at).toLocaleString()}
                  {item.category ? ` · ${item.category}` : ""}
                </p>
              </button>
            ))}
          </div>
        )}

        <Link href="/dashboard" className="text-sm text-[var(--primary)] hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
