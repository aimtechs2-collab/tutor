"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/Tooltip";

export interface SidebarMoreItem {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltipKey?: string;
}

interface SidebarMoreNavProps {
  items: SidebarMoreItem[];
  collapsed?: boolean;
}

export function SidebarMoreNav({ items, collapsed = false }: SidebarMoreNavProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const moreActive = items.some((item) => pathname.startsWith(item.href));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navItemClass = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
      active
        ? "bg-[var(--background)]/70 font-medium text-[var(--foreground)]"
        : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
    }`;

  if (collapsed) {
    return (
      <div ref={rootRef} className="relative w-full">
        <Tooltip label={t("More")} side="right">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={t("More")}
            className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
              moreActive || open
                ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            {(moreActive || open) && (
              <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
            )}
            <Ellipsis size={18} strokeWidth={1.6} />
          </button>
        </Tooltip>
        {open && (
          <div
            role="menu"
            className="aimtutor-profile-menu absolute left-full top-0 z-[200] ml-2 min-w-[168px] overflow-hidden rounded-xl border border-[var(--border)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          >
            {items.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={navItemClass(active)}
                >
                  <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                  <span>{t(item.label)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={navItemClass(moreActive || open)}
      >
        <Ellipsis size={16} strokeWidth={moreActive || open ? 1.9 : 1.5} />
        <span>{t("More")}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="aimtutor-profile-menu absolute left-0 right-0 top-full z-[200] mt-0.5 overflow-hidden rounded-xl border border-[var(--border)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={navItemClass(active)}
              >
                <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                <span>{t(item.label)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
