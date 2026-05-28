"use client";

interface Stat { label: string; value: string | number; icon: string; accent: string }

export function StatsGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl p-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="mb-2 text-xl">{s.icon}</div>
          <div
            className="text-2xl font-bold tabular-nums"
            style={{ color: s.accent }}
          >
            {s.value}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
