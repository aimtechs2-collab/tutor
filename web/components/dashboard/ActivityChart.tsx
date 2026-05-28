"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
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

export function ActivityChart({ sevenDayActivity }: Props) {
  const labels = Object.keys(sevenDayActivity).map((d) => {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  });

  const data = {
    labels,
    datasets: [
      {
        label: "Chat",
        data: Object.values(sevenDayActivity).map((d) => d.chat),
        backgroundColor: "rgba(59,130,246,0.75)",
        borderRadius: 4,
      },
      {
        label: "Quiz",
        data: Object.values(sevenDayActivity).map((d) => d.quiz),
        backgroundColor: "rgba(245,158,11,0.75)",
        borderRadius: 4,
      },
      {
        label: "Voice",
        data: Object.values(sevenDayActivity).map((d) => d.voice),
        backgroundColor: "rgba(20,184,166,0.75)",
        borderRadius: 4,
      },
      {
        label: "Research",
        data: Object.values(sevenDayActivity).map((d) => d.research),
        backgroundColor: "rgba(168,85,247,0.75)",
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { color: "var(--muted-foreground)", boxWidth: 12, font: { size: 11 } },
      },
      tooltip: { mode: "index" as const, intersect: false },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { color: "var(--muted-foreground)", font: { size: 11 } },
        grid: { display: false },
      },
      y: {
        stacked: true,
        ticks: { color: "var(--muted-foreground)", font: { size: 11 }, stepSize: 1 },
        grid: { color: "var(--border)" },
      },
    },
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        7-Day Activity
      </h3>
      <div style={{ height: 200 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}
