"use client";

import Link from "next/link";
import {
  BookOpen,
  Bot,
  Library,
  MessageSquarePlus,
  PenLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}

const ACTIONS: QuickAction[] = [
  {
    href: "/chat",
    label: "New Chat",
    description: "Ask anything, get tutoring",
    icon: MessageSquarePlus,
    accent: "var(--primary)",
  },
  {
    href: "/agents",
    label: "TutorBot",
    description: "Custom subject tutors",
    icon: Bot,
    accent: "#3b82f6",
  },
  {
    href: "/co-writer",
    label: "Co-Writer",
    description: "Draft & edit together",
    icon: PenLine,
    accent: "#14b8a6",
  },
  {
    href: "/book",
    label: "Book",
    description: "Generate study books",
    icon: Library,
    accent: "#f59e0b",
  },
  {
    href: "/knowledge",
    label: "Knowledge",
    description: "Your saved sources",
    icon: BookOpen,
    accent: "#a855f7",
  },
  {
    href: "/space",
    label: "Space",
    description: "Notebooks & quizzes",
    icon: Sparkles,
    accent: "#ec4899",
  },
];

export function QuickActions() {
  return (
    <div>
      <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--foreground)" }}>
        Jump back in
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 rounded-2xl p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                style={{ background: `color-mix(in srgb, ${a.accent} 14%, transparent)`, color: a.accent }}
              >
                <Icon size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                  {a.label}
                </div>
                <div className="truncate text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {a.description}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
