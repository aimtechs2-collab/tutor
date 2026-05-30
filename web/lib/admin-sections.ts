export type AdminSection =
  | "overview"
  | "billing"
  | "reports"
  | "audit"
  | "users"
  | "conversations"
  | "support"
  | "risk"
  | "courses"
  | "tutor-personas";

const ROLE_SECTIONS: Record<string, AdminSection[]> = {
  finance_admin: ["overview", "billing", "reports", "audit"],
  support_agent: ["overview", "users", "conversations", "support"],
  ai_safety_admin: ["overview", "users", "conversations", "risk"],
  tutor_manager: ["overview", "users", "courses", "tutor-personas"],
};

export const ADMIN_PATH_SECTIONS: Array<{ prefix: string; section: AdminSection }> = [
  { prefix: "/admin/users", section: "users" },
  { prefix: "/admin/plans", section: "billing" },
  { prefix: "/admin/conversations", section: "conversations" },
  { prefix: "/admin/reports", section: "reports" },
  { prefix: "/admin/audit", section: "audit" },
  { prefix: "/admin/support", section: "support" },
  { prefix: "/admin/risk", section: "risk" },
  { prefix: "/admin/courses", section: "courses" },
  { prefix: "/admin/tutor-personas", section: "tutor-personas" },
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
