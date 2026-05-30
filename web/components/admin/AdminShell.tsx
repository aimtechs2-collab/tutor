"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { fetchAuthStatus, signInRedirectPath } from "@/lib/auth";
import {
  canAccessAdminPath,
  type AdminSection,
  visibleSectionsForAdminRole,
} from "@/lib/admin-sections";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState("");
  const [visibleSections, setVisibleSections] = useState<Set<AdminSection> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const status = await fetchAuthStatus({ waitForClerk: true });
      if (cancelled) return;

      if (status === null) {
        setGateError("Could not reach the server. Check that the backend is running on port 8001.");
        return;
      }

      if (!status.authenticated) {
        router.replace(signInRedirectPath(pathname || "/admin"));
        return;
      }

      if (status.role !== "admin" && !status.is_admin) {
        setGateError("Your account does not have admin access. Ask a super admin to set role: admin in Clerk publicMetadata.");
        return;
      }

      setVisibleSections(
        visibleSectionsForAdminRole(status.admin_role, Boolean(status.is_admin)),
      );
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  useEffect(() => {
    if (!ready || !pathname.startsWith("/admin")) {
      return;
    }
    if (!canAccessAdminPath(pathname, visibleSections)) {
      router.replace("/admin");
    }
  }, [pathname, ready, router, visibleSections]);

  const shell = useMemo(() => {
    if (gateError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
          <div className="max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--foreground)]">
            <p className="font-medium">Admin access unavailable</p>
            <p className="mt-2 text-[var(--muted-foreground)]">{gateError}</p>
          </div>
        </div>
      );
    }
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
  }, [children, gateError, pathname, ready, visibleSections]);

  return shell;
}
