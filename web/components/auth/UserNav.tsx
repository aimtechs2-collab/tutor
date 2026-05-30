"use client";

import { LogOut, ShieldCheck, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminLink } from "@/components/auth/AdminLink";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { NotificationBell } from "@/components/NotificationBell";

const CLERK_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

interface UserNavProps {
  collapsed?: boolean;
}

type ClerkUser = {
  firstName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  publicMetadata?: Record<string, unknown>;
};

function ClerkUserNav({ collapsed = false }: UserNavProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<ClerkUser | null>(null);
  const isAdmin = user?.publicMetadata?.role === "admin";
  const adminActive = pathname.startsWith("/admin");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (let i = 0; i < 100 && !window.Clerk; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await window.Clerk?.load?.();
      if (!cancelled) {
        setUser((window.Clerk as any)?.user || null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await (window.Clerk as any)?.signOut?.();
    window.location.href = "/sign-in";
  };

  if (collapsed) {
    return (
      <>
        <NotificationBell />
        {isAdmin && (
          <Link
            href="/admin/users"
            className={`rounded-lg p-2 transition-colors ${
              adminActive
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
            }`}
            aria-label="Admin"
            title="Admin"
          >
            <ShieldCheck size={16} strokeWidth={1.5} />
          </Link>
        )}
        <button
          onClick={signOut}
          className="rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/50 hover:text-red-500"
          aria-label="Sign out"
          title="Sign out"
        >
          <UserCircle size={18} strokeWidth={1.5} />
        </button>
      </>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end px-1">
        <NotificationBell />
      </div>
      {isAdmin && (
        <Link
          href="/admin/users"
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
            adminActive
              ? "bg-[var(--primary)]/10 text-[var(--primary)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
          }`}
        >
          <ShieldCheck size={16} strokeWidth={1.5} />
          <span>Admin</span>
        </Link>
      )}
      <div className="flex items-center gap-2 rounded-lg px-3 py-2">
        <UserCircle size={18} strokeWidth={1.5} className="shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] text-[var(--foreground)]">
            {user?.firstName || user?.primaryEmailAddress?.emailAddress || "User"}
          </div>
          {user?.primaryEmailAddress?.emailAddress && (
            <div className="truncate text-xs text-[var(--muted-foreground)]">
              {user.primaryEmailAddress.emailAddress}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={signOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/50 hover:text-red-500"
      >
        <LogOut size={16} strokeWidth={1.5} />
        <span>Sign out</span>
      </button>
    </div>
  );
}

export function UserNav({ collapsed = false }: UserNavProps) {
  if (CLERK_ENABLED) return <ClerkUserNav collapsed={collapsed} />;
  return (
    <>
      <NotificationBell />
      <AdminLink collapsed={collapsed} />
      <LogoutButton collapsed={collapsed} />
    </>
  );
}
