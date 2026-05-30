"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { fetchAuthStatus } from "@/lib/auth";
import {
  canAccessAdminPath,
  type AdminSection,
  visibleSectionsForAdminRole,
} from "@/lib/admin-sections";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [visibleSections, setVisibleSections] = useState<Set<AdminSection> | null>(
    null,
  );

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin" && !status.is_admin) {
        router.replace("/");
        return;
      }
      setVisibleSections(
        visibleSectionsForAdminRole(status.admin_role, Boolean(status.is_admin)),
      );
      setReady(true);
    });
  }, [router]);

  useEffect(() => {
    if (!ready || !pathname.startsWith("/admin")) {
      return;
    }
    if (!canAccessAdminPath(pathname, visibleSections)) {
      router.replace("/admin");
    }
  }, [pathname, ready, router, visibleSections]);

  const shell = useMemo(() => {
    if (!ready) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm text-[var(--muted-foreground)]">
          Loading admin workspace…
        </div>
      );
    }
    if (!canAccessAdminPath(pathname, visibleSections)) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm text-[var(--muted-foreground)]">
          Redirecting…
        </div>
      );
    }
    return (
      <div className="flex min-h-screen bg-[var(--background)]">
        <AdminSidebar visibleSections={visibleSections} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }, [children, pathname, ready, visibleSections]);

  return shell;
}
