"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notifications-api";

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCount(await fetchUnreadCount());
    } catch {
      /* ignore polling errors */
    }
  }, []);

  const loadDropdown = useCallback(async () => {
    setLoading(true);
    try {
      const notifications = await fetchNotifications({ limit: 10 });
      setItems(notifications);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const interval = window.setInterval(() => void refreshCount(), 60_000);
    return () => window.clearInterval(interval);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    void loadDropdown();
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, loadDropdown]);

  async function handleMarkRead(notification: AppNotification) {
    if (notification.read) return;
    try {
      await markNotificationRead(notification.id);
      setItems((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, read: true, read_at: new Date().toISOString() } : item,
        ),
      );
      setCount((prev) => Math.max(0, prev - 1));
    } catch {
      /* ignore */
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((item) => ({ ...item, read: true })));
      setCount(0);
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={18} strokeWidth={1.5} />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-sm font-medium text-[var(--foreground)]">Notifications</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">No notifications</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleMarkRead(item)}
                  className={`block w-full border-b border-[var(--border)] px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-[var(--background)] ${
                    item.read ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--foreground)]">{item.title}</span>
                    {!item.read ? (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                    ) : null}
                  </div>
                  {item.body ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">{item.body}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{formatTime(item.created_at)}</p>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-[var(--border)] px-3 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--primary)] hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
