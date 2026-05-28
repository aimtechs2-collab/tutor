"use client";

interface Activity {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: number;
  message_count: number;
}

const TYPE_ICONS: Record<string, string> = {
  chat: "💬", quiz: "✅", question: "✅", research: "🔍",
  visualize: "📊", book: "📖", cowriter: "✍️", solve: "🧠",
};

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts);
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

export function ActivityFeed({
  activities,
  loading,
}: {
  activities: Activity[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg"
            style={{ background: "var(--muted)" }}
          />
        ))}
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div
        className="rounded-xl py-12 text-center text-sm"
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
            {items.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-[var(--accent)]"
                style={{ border: "1px solid var(--border)" }}
              >
                <span className="mt-0.5 text-lg">{TYPE_ICONS[a.type] ?? "📄"}</span>
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
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
                    style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                  >
                    {a.message_count}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
