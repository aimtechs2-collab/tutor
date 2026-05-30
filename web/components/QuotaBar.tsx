"use client";

interface QuotaBarProps {
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
}

export function QuotaBar({ label, used, limit, unlimited }: QuotaBarProps) {
  if (unlimited) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {label}
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--primary)" }}>
          Unlimited
        </span>
      </div>
    );
  }
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {label}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--foreground)" }}>
          {Math.round(used)} / {limit}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--muted)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
