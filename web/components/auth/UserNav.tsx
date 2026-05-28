"use client";

import { SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AdminLink } from "@/components/auth/AdminLink";
import { LogoutButton } from "@/components/auth/LogoutButton";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

interface UserNavProps {
  collapsed?: boolean;
}

function ClerkUserNav({ collapsed = false }: UserNavProps) {
  const { user } = useUser();
  const pathname = usePathname();
  const isAdmin = user?.publicMetadata?.role === "admin";
  const adminActive = pathname.startsWith("/admin");

  if (collapsed) {
    return (
      <>
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
        <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
      </>
    );
  }

  return (
    <div className="space-y-1">
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
      <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
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
        <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
      </div>
      <SignOutButton redirectUrl="/sign-in">
        <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/50 hover:text-red-500">
          <LogOut size={16} strokeWidth={1.5} />
          <span>Sign out</span>
        </button>
      </SignOutButton>
    </div>
  );
}

export function UserNav({ collapsed = false }: UserNavProps) {
  if (CLERK_ENABLED) return <ClerkUserNav collapsed={collapsed} />;
  return (
    <>
      <AdminLink collapsed={collapsed} />
      <LogoutButton collapsed={collapsed} />
    </>
  );
}
