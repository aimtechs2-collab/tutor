"use client";

import type { LucideIcon } from "lucide-react";

export interface Stat {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent: string;
  loading?: boolean;
}

export function StatsGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className="group relative overflow-hidden rounded-2xl p-4 transition-colors"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.08] transition-opacity group-hover:opacity-[0.14]"
              style={{ background: s.accent }}
            />
            <div
              className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${s.accent} 14%, transparent)`, color: s.accent }}
            >
              <Icon size={17} strokeWidth={2} />
            </div>
            <div
              className={`text-[26px] font-bold leading-none tabular-nums ${s.loading ? "animate-pulse" : ""}`}
              style={{ color: "var(--foreground)" }}
            >
              {s.value}
            </div>
            <div className="mt-1.5 text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
