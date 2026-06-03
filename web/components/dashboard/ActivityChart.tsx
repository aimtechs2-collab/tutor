"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface DayActivity {
  chat: number;
  quiz: number;
  voice: number;
  research: number;
  other: number;
}

interface Props {
  sevenDayActivity: Record<string, DayActivity>;
}

const SERIES = [
  { key: "chat" as const, label: "Chat", color: "#3b82f6" },
  { key: "quiz" as const, label: "Quiz", color: "#f59e0b" },
  { key: "voice" as const, label: "Voice", color: "#14b8a6" },
  { key: "research" as const, label: "Research", color: "#a855f7" },
];

/**
 * Chart.js cannot resolve CSS custom properties (`var(--…)`) passed as colors —
 * it just renders them as invalid/transparent. Read the real computed values
 * off the document so axis ticks, grid lines, and the legend are visible in
 * every theme, and recompute them when the theme attribute changes.
 */
function useThemeColors() {
  const [colors, setColors] = useState({
    muted: "#9b9590",
    border: "rgba(120,120,120,0.18)",
  });

  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement);
      const muted = styles.getPropertyValue("--muted-foreground").trim();
      const border = styles.getPropertyValue("--border").trim();
      setColors({
        muted: muted || "#9b9590",
        border: border || "rgba(120,120,120,0.18)",
      });
    };
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export function ActivityChart({ sevenDayActivity }: Props) {
  const { muted, border } = useThemeColors();

  const days = useMemo(() => Object.keys(sevenDayActivity), [sevenDayActivity]);

  const totalEvents = useMemo(
    () =>
      Object.values(sevenDayActivity).reduce(
        (sum, d) => sum + d.chat + d.quiz + d.voice + d.research + d.other,
        0,
      ),
    [sevenDayActivity],
  );

  const data = useMemo(() => {
    const labels = days.map((d) => {
      const date = new Date(d);
      return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    });

    return {
      labels,
      datasets: SERIES.map((s) => ({
        label: s.label,
        data: days.map((d) => sevenDayActivity[d]?.[s.key] ?? 0),
        backgroundColor: s.color,
        borderRadius: 5,
        borderSkipped: false as const,
        maxBarThickness: 28,
      })),
    };
  }, [days, sevenDayActivity]);

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: muted,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "circle",
            padding: 16,
            font: { size: 11 },
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          padding: 10,
          cornerRadius: 8,
          titleFont: { size: 12 },
          bodyFont: { size: 11 },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: muted, font: { size: 11 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: muted, font: { size: 11 }, precision: 0 },
          grid: { color: border },
          border: { display: false },
        },
      },
    }),
    [muted, border],
  );

  return (
    <div
      className="flex h-full flex-col rounded-2xl p-5"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          7-Day Activity
        </h3>
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {totalEvents} {totalEvents === 1 ? "session" : "sessions"}
        </span>
      </div>
      {totalEvents === 0 ? (
        <div
          className="flex flex-1 items-center justify-center rounded-xl text-center text-xs"
          style={{ minHeight: 200, color: "var(--muted-foreground)", border: "1px dashed var(--border)" }}
        >
          No activity in the last 7 days yet.
        </div>
      ) : (
        <div className="flex-1" style={{ minHeight: 220 }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}
