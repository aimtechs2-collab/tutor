"use client";

import { useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  BrainCog,
  CheckSquare,
  Library,
  MessageSquare,
  PenLine,
  Search,
  BarChart3,
  ChevronRight,
  FileText,
  type LucideIcon,
} from "lucide-react";

interface Activity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
}

const TYPE_META: Record<string, { icon: LucideIcon; color: string }> = {
  chat: { icon: MessageSquare, color: "var(--primary)" },
  quiz: { icon: CheckSquare, color: "#f59e0b" },
  question: { icon: CheckSquare, color: "#f59e0b" },
  research: { icon: Search, color: "#a855f7" },
  visualize: { icon: BarChart3, color: "#3b82f6" },
  book: { icon: Library, color: "#f97316" },
  cowriter: { icon: PenLine, color: "#14b8a6" },
  solve: { icon: BrainCog, color: "#ec4899" },
  agents: { icon: Bot, color: "#3b82f6" },
  knowledge: { icon: BookOpen, color: "#a855f7" },
};

function metaFor(type: string) {
  return TYPE_META[type] ?? { icon: FileText, color: "var(--muted-foreground)" };
}

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupByDate(activities: Activity[]) {
  const groups: Record<string, Activity[]> = {};
  for (const a of activities) {
    const date = new Date(a.timestamp * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let label: string;
    if (date.toDateString() === today.toDateString()) label = "Today";
    else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (!groups[label]) groups[label] = [];
    groups[label].push(a);
  }
  return groups;
}

function routeFor(a: Activity): string {
  if (a.type === "cowriter") return `/co-writer/${a.id}`;
  return `/chat/${a.id}`;
}

export function ActivityFeed({
  activities,
  loading,
}: {
  activities: Activity[];
  loading: boolean;
}) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl"
            style={{ background: "var(--muted)" }}
          />
        ))}
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div
        className="rounded-2xl py-12 text-center text-sm"
        style={{ color: "var(--muted-foreground)", border: "1px dashed var(--border)" }}
      >
        No activity yet — start a chat session to see it here.
      </div>
    );
  }

  const groups = groupByDate(activities);

  return (
    <div className="space-y-5">
      {Object.entries(groups).map(([label, items]) => (
        <div key={label}>
          <div
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted-foreground)" }}
          >
            {label}
          </div>
          <div className="space-y-2">
            {items.map((a) => {
              const { icon: Icon, color } = metaFor(a.type);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => router.push(routeFor(a))}
                  className="group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-sm font-medium"
                        style={{ color: "var(--foreground)" }}
                      >
                        {a.title}
                      </span>
                      <span
                        className="shrink-0 text-xs"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {relativeTime(a.timestamp)}
                      </span>
                    </div>
                    {a.summary && (
                      <p
                        className="mt-0.5 truncate text-xs"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {a.summary}
                      </p>
                    )}
                  </div>
                  {a.message_count > 0 && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums"
                      style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                    >
                      {a.message_count}
                    </span>
                  )}
                  <ChevronRight
                    size={16}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: "var(--muted-foreground)" }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
