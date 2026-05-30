"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  CreditCard,
  FileDown,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareWarning,
  ScrollText,
  ShieldAlert,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  canAccessSection,
  type AdminSection,
} from "@/lib/admin-sections";

type NavItem = {
  href: string;
  label: string;
  section: AdminSection;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Overview", section: "overview", icon: LayoutDashboard },
      { href: "/admin/intelligence", label: "Intelligence", section: "overview", icon: BrainCircuit },
    ],
  },
  {
    label: "Users",
    items: [
      { href: "/admin/users", label: "All Users", section: "users", icon: Users },
      { href: "/admin/grants", label: "Resource Grants", section: "grants", icon: KeyRound },
      { href: "/admin/risk", label: "Risk Flags", section: "risk", icon: ShieldAlert },
    ],
  },
  {
    label: "Subscriptions",
    items: [
      { href: "/admin/plans", label: "Plans", section: "billing", icon: CreditCard },
      { href: "/admin/billing", label: "Billing & Payments", section: "billing", icon: IndianRupee },
      { href: "/admin/billing/costs", label: "AI Costs", section: "billing", icon: BarChart2 },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/courses", label: "Courses", section: "courses", icon: BookOpen },
      { href: "/admin/tutor-personas", label: "AI Tutors", section: "tutor-personas", icon: Bot },
    ],
  },
  {
    label: "AI Safety",
    items: [
      {
        href: "/admin/conversations",
        label: "Conversations",
        section: "conversations",
        icon: MessageSquareWarning,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/activity", label: "Activity Feed", section: "activity", icon: Activity },
      { href: "/admin/support", label: "Support", section: "support", icon: LifeBuoy },
      { href: "/admin/notifications", label: "Notifications", section: "notifications", icon: Bell },
      { href: "/admin/automation", label: "Automation", section: "automation", icon: Zap },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/admin/progress", label: "Progress", section: "progress", icon: TrendingUp },
      { href: "/admin/reports", label: "Reports", section: "reports", icon: FileDown },
    ],
  },
  {
    label: "System",
    items: [{ href: "/admin/audit", label: "Audit Log", section: "audit", icon: ScrollText }],
  },
];

type AdminSidebarProps = {
  visibleSections?: Set<AdminSection> | null;
};

export default function AdminSidebar({ visibleSections = null }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 px-4 py-5">
        <Link href="/" className="text-sm font-semibold text-zinc-50">
          AIMTutor Admin
        </Link>
        <p className="mt-1 text-xs text-zinc-400">SaaS controls</p>
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
            <div key={group.label}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active =
                    href === "/admin"
                      ? pathname === "/admin"
                      : pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-2 border-l-2 py-2 pl-[10px] pr-3 text-sm transition-colors ${
                        active
                          ? "border-indigo-400 bg-zinc-900 font-medium text-zinc-50"
                          : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-100"
                      }`}
                    >
                      <Icon size={16} strokeWidth={1.75} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
        >
          <ArrowLeft size={14} />
          Back to App
        </Link>
      </div>
    </aside>
  );
}
