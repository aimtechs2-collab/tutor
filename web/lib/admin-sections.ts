export type AdminSection =
  | "overview"
  | "users"
  | "billing"
  | "courses"
  | "tutor-personas"
  | "conversations"
  | "risk"
  | "activity"
  | "support"
  | "notifications"
  | "automation"
  | "progress"
  | "reports"
  | "audit";

const ROLE_SECTIONS: Record<string, AdminSection[]> = {
  finance_admin: [
    "overview",
    "billing",
    "reports",
    "progress",
    "audit",
    "notifications",
  ],
  support_agent: [
    "overview",
    "users",
    "conversations",
    "activity",
    "support",
    "notifications",
    "automation",
  ],
  ai_safety_admin: ["overview", "users", "conversations", "risk"],
  tutor_manager: [
    "overview",
    "users",
    "courses",
    "tutor-personas",
    "notifications",
    "progress",
  ],
};

export const ADMIN_PATH_SECTIONS: Array<{ prefix: string; section: AdminSection }> = [
  { prefix: "/admin/intelligence", section: "overview" },
  { prefix: "/admin/billing/costs", section: "billing" },
  { prefix: "/admin/billing", section: "billing" },
  { prefix: "/admin/plans", section: "billing" },
  { prefix: "/admin/users", section: "users" },
  { prefix: "/admin/risk", section: "risk" },
  { prefix: "/admin/courses", section: "courses" },
  { prefix: "/admin/tutor-personas", section: "tutor-personas" },
  { prefix: "/admin/conversations", section: "conversations" },
  { prefix: "/admin/activity", section: "activity" },
  { prefix: "/admin/support", section: "support" },
  { prefix: "/admin/notifications", section: "notifications" },
  { prefix: "/admin/automation", section: "automation" },
  { prefix: "/admin/progress", section: "progress" },
  { prefix: "/admin/reports", section: "reports" },
  { prefix: "/admin/audit", section: "audit" },
  { prefix: "/admin", section: "overview" },
];

export function visibleSectionsForAdminRole(
  adminRole: string | null | undefined,
  isAdmin: boolean,
): Set<AdminSection> | null {
  if (!isAdmin) {
    return new Set();
  }
  const role = adminRole ?? "admin";
  if (role === "super_admin" || role === "admin") {
    return null;
  }
  return new Set(ROLE_SECTIONS[role] ?? ["overview"]);
}

export function canAccessSection(
  visibleSections: Set<AdminSection> | null,
  section: AdminSection,
): boolean {
  if (visibleSections === null) {
    return true;
  }
  return visibleSections.has(section);
}

export function sectionForAdminPath(pathname: string): AdminSection {
  const sorted = [...ADMIN_PATH_SECTIONS].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );
  for (const entry of sorted) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.section;
    }
  }
  return "overview";
}

export function canAccessAdminPath(
  pathname: string,
  visibleSections: Set<AdminSection> | null,
): boolean {
  return canAccessSection(visibleSections, sectionForAdminPath(pathname));
}
