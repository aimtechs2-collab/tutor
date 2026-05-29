"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart2, Users, Activity, LayoutDashboard, ArrowLeft, ShieldCheck, TrendingUp, ScrollText } from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/activity", label: "Activity", icon: Activity },
  { href: "/admin/grants", label: "Grants", icon: ShieldCheck },
  { href: "/admin/progress", label: "Progress", icon: TrendingUp },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="flex h-screen w-52 shrink-0 flex-col"
      style={{ background: "#0f1117", borderRight: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="px-4 py-5">
        <div className="flex items-center gap-2 mb-6">
          <BarChart2 size={16} color="#6366f1" />
          <span className="text-sm font-bold tracking-wide text-white">Admin Panel</span>
        </div>
        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                style={{
                  color: active ? "#fff" : "rgba(255,255,255,0.5)",
                  background: active ? "rgba(99,102,241,0.2)" : "transparent",
                  borderLeft: active ? "2px solid #6366f1" : "2px solid transparent",
                }}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto px-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          <ArrowLeft size={12} />
          Back to App
        </Link>
      </div>
    </aside>
  );
}
