"use client";

import {
  LogOut,
  Settings,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VersionBadge } from "@/components/sidebar/VersionBadge";
import { AdminLink } from "@/components/auth/AdminLink";
import { NotificationBell } from "@/components/NotificationBell";
import { useAppShell } from "@/context/AppShellContext";
import { AUTH_ENABLED, fetchAuthStatus, logout } from "@/lib/auth";

const CLERK_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

interface UserNavProps {
  collapsed?: boolean;
}

type ProfileMenuItem = {
  key: string;
  label: string;
  icon: typeof Settings;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  hidden?: boolean;
};

function initialsFrom(name: string, email: string): string {
  const source = name.trim() || email.trim() || "U";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function ProfileMenu({
  collapsed = false,
  displayName,
  email,
  isAdmin,
  onSignOut,
}: {
  collapsed?: boolean;
  displayName: string;
  email?: string;
  isAdmin: boolean;
  onSignOut: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const items: ProfileMenuItem[] = [
    {
      key: "settings",
      label: t("Settings"),
      icon: Settings,
      href: "/settings",
    },
    {
      key: "admin",
      label: t("Admin"),
      icon: ShieldCheck,
      href: "/admin/users",
      hidden: !isAdmin,
    },
    {
      key: "sign-out",
      label: t("Sign out"),
      icon: LogOut,
      onClick: () => {
        close();
        void onSignOut();
      },
      danger: true,
    },
  ].filter((item) => !item.hidden);

  const initials = initialsFrom(displayName, email ?? "");

  return (
    <div
      ref={rootRef}
      className={`aimtutor-profile-footer relative shrink-0 border-t border-[var(--border)]/40 ${
        collapsed
          ? "z-40 flex w-full flex-col items-center overflow-visible px-1.5 py-2"
          : "z-30 px-2 py-2"
      }`}
    >
      {open && (
        <div
          role="menu"
          className={`aimtutor-profile-menu absolute z-[200] overflow-hidden rounded-xl border border-[var(--border)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ${
            collapsed
              ? "bottom-0 left-full mb-0 ml-2 w-48"
              : "bottom-full left-2 right-2 mb-1.5"
          }`}
        >
          <div className="aimtutor-profile-menu-header border-b border-[var(--border)]/50 px-3 py-2.5">
            <p className="truncate text-[13px] font-medium text-[var(--foreground)]">
              {displayName}
            </p>
            {email && (
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {email}
              </p>
            )}
          </div>
          {items.map((item) => {
            const active = item.href ? pathname.startsWith(item.href) : false;
            const className = `aimtutor-profile-menu-item flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${
              item.danger
                ? "text-[var(--muted-foreground)] hover:text-red-500"
                : active
                  ? "is-active text-[var(--foreground)]"
                  : "text-[var(--foreground)]"
            }`;

            if (item.href) {
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  onClick={close}
                  className={className}
                >
                  <item.icon size={16} strokeWidth={1.6} />
                  <span>{item.label}</span>
                </Link>
              );
            }

            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={item.onClick}
                className={className}
              >
                <item.icon size={16} strokeWidth={1.6} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex transition-colors hover:bg-[var(--accent)] ${
          collapsed
            ? "h-9 w-9 items-center justify-center rounded-xl"
            : "w-full items-center gap-2.5 rounded-lg px-2 py-2"
        }`}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-semibold text-[var(--primary)] ${
            collapsed ? "h-8 w-8" : "h-8 w-8"
          }`}
        >
          {initials}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13.5px] font-medium text-[var(--foreground)]">
              {displayName}
            </span>
            {email && (
              <span className="block truncate text-xs text-[var(--muted-foreground)]">
                {email}
              </span>
            )}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-1 px-2">
          <VersionBadge />
        </div>
      )}
      {collapsed && (
        <div className="mt-1.5">
          <VersionBadge collapsed />
        </div>
      )}
    </div>
  );
}

function ClerkUserNav({ collapsed = false }: UserNavProps) {
  const [user, setUser] = useState<{
    firstName?: string | null;
    primaryEmailAddress?: { emailAddress?: string | null } | null;
    publicMetadata?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (let i = 0; i < 100 && !window.Clerk; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await window.Clerk?.load?.();
      if (!cancelled) {
        setUser((window.Clerk as { user?: typeof user })?.user || null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const displayName = user?.firstName || email || "User";
  const isAdmin = user?.publicMetadata?.role === "admin";

  return (
    <ProfileMenu
      collapsed={collapsed}
      displayName={displayName}
      email={email || undefined}
      isAdmin={isAdmin}
      onSignOut={async () => {
        await (window.Clerk as { signOut?: () => Promise<void> })?.signOut?.();
        window.location.href = "/sign-in";
      }}
    />
  );
}

function LegacyUserNav({ collapsed = false }: UserNavProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchAuthStatus>>>(null);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    void fetchAuthStatus().then(setStatus);
  }, []);

  const displayName = status?.username || "User";
  const isAdmin = status?.role === "admin" || Boolean(status?.is_admin);

  return (
    <ProfileMenu
      collapsed={collapsed}
      displayName={displayName}
      isAdmin={isAdmin}
      onSignOut={async () => {
        await logout();
        router.replace("/login");
      }}
    />
  );
}

export function UserNav({ collapsed: collapsedProp }: UserNavProps = {}) {
  const { sidebarCollapsed } = useAppShell();
  const collapsed = collapsedProp ?? sidebarCollapsed;

  if (CLERK_ENABLED) {
    return (
      <>
        <NotificationBell />
        <AdminLink collapsed={collapsed} />
        <ClerkUserNav collapsed={collapsed} />
      </>
    );
  }
  if (AUTH_ENABLED) {
    return (
      <>
        <NotificationBell />
        <AdminLink collapsed={collapsed} />
        <LegacyUserNav collapsed={collapsed} />
      </>
    );
  }

  return (
    <div
      className={`relative shrink-0 border-t border-[var(--border)]/40 ${
        collapsed
          ? "z-40 flex w-full flex-col items-center px-1.5 py-2"
          : "px-2 py-2"
      }`}
    >
      <div
        className={`flex items-center text-[var(--muted-foreground)] ${
          collapsed ? "justify-center" : "gap-2.5 px-2 py-2"
        }`}
      >
        <UserCircle size={18} strokeWidth={1.5} />
        {!collapsed && <span className="text-[13.5px]">Guest</span>}
      </div>
      <div className={collapsed ? "mt-1.5 flex justify-center" : "mt-1 px-2"}>
        <VersionBadge collapsed={collapsed} />
      </div>
    </div>
  );
}
