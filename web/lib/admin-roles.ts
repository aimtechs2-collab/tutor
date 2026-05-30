export const ADMIN_ROLE_OPTIONS = [
  { value: "", label: "None (regular user)" },
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "support_agent", label: "Support Agent" },
  { value: "finance_admin", label: "Finance Admin" },
  { value: "ai_safety_admin", label: "AI Safety Admin" },
  { value: "tutor_manager", label: "Tutor Manager" },
] as const;

export function adminRoleLabel(role: string | null | undefined): string {
  if (!role) return "None";
  return ADMIN_ROLE_OPTIONS.find((opt) => opt.value === role)?.label ?? role;
}

export function adminRoleBadgeClass(role: string | null | undefined): string {
  switch (role) {
    case "super_admin":
      return "border-purple-500/30 bg-purple-500/12 text-purple-700 dark:text-purple-300";
    case "admin":
      return "border-indigo-500/30 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300";
    case "support_agent":
      return "border-blue-500/30 bg-blue-500/12 text-blue-700 dark:text-blue-300";
    case "finance_admin":
      return "border-green-500/30 bg-green-500/12 text-green-700 dark:text-green-300";
    case "ai_safety_admin":
      return "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300";
    case "tutor_manager":
      return "border-teal-500/30 bg-teal-500/12 text-teal-700 dark:text-teal-300";
    default:
      return "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]";
  }
}

export function canManagePlans(adminRole: string | null | undefined): boolean {
  const role = adminRole ?? "admin";
  return role === "super_admin" || role === "admin" || role === "finance_admin";
}
