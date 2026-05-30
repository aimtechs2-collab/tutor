"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardList,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareWarning,
  ShieldAlert,
  UserCircle2,
  Users,
} from "lucide-react";
import {
  canAccessSection,
  type AdminSection,
} from "@/lib/admin-sections";

const NAV_GROUPS = [
  {
    label: null,
    items: [
      {
        href: "/admin",
        label: "Overview",
        section: "overview" as AdminSection,
        icon: LayoutDashboard,
      },
      { href: "/admin/users", label: "Users", section: "users" as AdminSection, icon: Users },
      {
        href: "/admin/plans",
        label: "Plans",
        section: "billing" as AdminSection,
        icon: CreditCard,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/admin/reports",
        label: "Reports",
        section: "reports" as AdminSection,
        icon: ClipboardList,
      },
      {
        href: "/admin/audit",
        label: "Audit Log",
        section: "audit" as AdminSection,
        icon: ShieldAlert,
      },
      {
        href: "/admin/support",
        label: "Support",
        section: "support" as AdminSection,
        icon: LifeBuoy,
      },
    ],
  },
  {
    label: "AI Safety",
    items: [
      {
        href: "/admin/conversations",
        label: "Conversations",
        section: "conversations" as AdminSection,
        icon: MessageSquareWarning,
      },
      {
        href: "/admin/risk",
        label: "Risk Review",
        section: "risk" as AdminSection,
        icon: ShieldAlert,
      },
    ],
  },
  {
    label: "Tutor Ops",
    items: [
      {
        href: "/admin/courses",
        label: "Courses",
        section: "courses" as AdminSection,
        icon: BookOpen,
      },
      {
        href: "/admin/tutor-personas",
        label: "Tutor Personas",
        section: "tutor-personas" as AdminSection,
        icon: UserCircle2,
      },
    ],
  },
] as const;

type AdminSidebarProps = {
  visibleSections?: Set<AdminSection> | null;
};

export default function AdminSidebar({ visibleSections = null }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-5">
        <Link href="/" className="text-sm font-semibold text-[var(--foreground)]">
          AIMTutor Admin
        </Link>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">SaaS controls</p>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) =>
            canAccessSection(visibleSections, item.section),
          );
          if (items.length === 0) {
            return null;
          }
          return (
            <div key={group.label ?? "main"}>
              {group.label ? (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {group.label}
                </p>
              ) : null}
              <div className="flex flex-col gap-1">
                {items.map(({ href, label, icon: Icon }) => {
                  const active =
                    href === "/admin"
                      ? pathname === "/admin"
                      : pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] font-medium text-[var(--primary)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <Icon size={16} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-[var(--border)] p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
        >
          <GraduationCap size={14} />
          User dashboard
        </Link>
      </div>
    </aside>
  );
}
