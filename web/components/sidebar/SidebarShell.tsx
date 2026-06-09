"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { TextLogo } from "@/components/brand/TextLogo";
import { useAppShell } from "@/context/AppShellContext";
import {
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  Library,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SessionList from "@/components/SessionList";
import { TutorBotRecent } from "@/components/sidebar/TutorBotRecent";
import type { SessionSummary } from "@/lib/session-api";
import { Tooltip } from "@/components/ui/Tooltip";

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltipKey?: string;
}

/** Top-level single links shown above the grouped section. */
const TOP_NAV: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    tooltipKey: "Dashboard",
  },
];

/** All items grouped under the collapsible "Learning Tools" section. */
const LEARNING_TOOLS_NAV: NavEntry[] = [
  {
    href: "/agents",
    label: "customTutors",
    icon: Bot,
    tooltipKey: "TutorBot tooltip",
  },
  {
    href: "/co-writer",
    label: "Co-Writer",
    icon: PenLine,
    tooltipKey: "Co-Writer tooltip",
  },
  { href: "/book", label: "Book", icon: Library, tooltipKey: "Book tooltip" },
  {
    href: "/knowledge",
    label: "Knowledge",
    icon: BookOpen,
    tooltipKey: "Knowledge tooltip",
  },
  {
    href: "/space",
    label: "Space",
    icon: LayoutGrid,
    tooltipKey: "Space tooltip",
  },
  {
    href: "/memory",
    label: "Memory",
    icon: Brain,
    tooltipKey: "Memory tooltip",
  },
];

/** All feature nav items flattened — used for collapsed icon strip. */
const ALL_FEATURE_NAV: NavEntry[] = [...TOP_NAV, ...LEARNING_TOOLS_NAV];

interface SidebarShellProps {
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  loadingSessions?: boolean;
  showSessions?: boolean;
  onNewChat?: () => void;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  footerSlot?: ReactNode;
}

export function SidebarShell({
  sessions = [],
  activeSessionId = null,
  loadingSessions = false,
  showSessions = false,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  footerSlot,
}: SidebarShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } =
    useAppShell();

  // Auto-open the Learning Tools section when the active page is inside it.
  const learningToolsActive = LEARNING_TOOLS_NAV.some((item) =>
    pathname.startsWith(item.href)
  );
  const [learningToolsOpen, setLearningToolsOpen] = useState(
    () => learningToolsActive
  );

  const chatActive = pathname.startsWith("/chat");
  const showRecents =
    showSessions && onSelectSession && onRenameSession && onDeleteSession;

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
      return;
    }
    router.push("/chat");
  };

  /* ---- Collapsed state ---- */
  if (collapsed) {
    return (
      <aside className="group/sb relative flex h-screen w-[60px] shrink-0 flex-col items-center bg-[var(--secondary)] py-3 transition-all duration-200">
        {/* Header: logo + collapse toggle (toggle replaces logo on hover) */}
        <div className="relative mb-2 flex h-9 w-9 items-center justify-center">
          <Link
            href="/"
            aria-label={t("AIMTutor")}
            className="flex items-center justify-center transition-opacity duration-150 group-hover/sb:opacity-0"
          >
            <TextLogo compact />
          </Link>
          <button
            onClick={() => setCollapsed(false)}
            className="absolute inset-0 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all duration-150 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] group-hover/sb:opacity-100"
            aria-label={t("Expand sidebar")}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>

        {/* New chat — visually distinct circular button */}
        <button
          onClick={handleNewChat}
          title={t("New Chat") as string}
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)]/50 bg-[var(--background)]/40 text-[var(--foreground)] shadow-sm transition-all duration-150 hover:border-[var(--border)] hover:bg-[var(--background)]/80"
          aria-label={t("New Chat")}
        >
          <Plus size={16} strokeWidth={2.2} />
        </button>

        {/* Subtle divider */}
        <div className="my-1.5 h-px w-7 bg-[var(--border)]/40" />

        {/* Feature nav */}
        <nav className="relative flex w-full flex-col items-center gap-1 px-1.5">
          <Tooltip label={t("Chat")} side="right">
            <Link
              href="/chat"
              aria-label={t("Chat")}
              className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                chatActive
                  ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
              }`}
            >
              {chatActive && (
                <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
              )}
              <MessageSquare size={18} strokeWidth={chatActive ? 2 : 1.6} />
            </Link>
          </Tooltip>
          {/* Dashboard */}
          {TOP_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Tooltip key={item.href} label={t(item.label)} side="right">
                <Link
                  href={item.href}
                  aria-label={t(item.label)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                    active
                      ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
                  )}
                  <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
                </Link>
              </Tooltip>
            );
          })}

          {/* Learning Tools icon (collapsed — shows all items as a popover on click) */}
          <Tooltip label={t("Learning Tools")} side="right">
            <button
              onClick={() => setLearningToolsOpen((v) => !v)}
              aria-label={t("Learning Tools")}
              className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                learningToolsActive || learningToolsOpen
                  ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
              }`}
            >
              {(learningToolsActive || learningToolsOpen) && (
                <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
              )}
              <GraduationCap size={18} strokeWidth={learningToolsActive ? 2 : 1.6} />
            </button>
          </Tooltip>
          {learningToolsOpen && (
            <div className="absolute left-full top-0 z-[200] ml-2 min-w-[168px] overflow-hidden rounded-xl border border-[var(--border)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)] aimtutor-profile-menu">
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/70">
                {t("Learning Tools")}
              </p>
              {LEARNING_TOOLS_NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setLearningToolsOpen(false)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                      active
                        ? "bg-[var(--background)]/70 font-medium text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
                    }`}
                  >
                    <item.icon size={15} strokeWidth={active ? 1.9 : 1.5} />
                    <span>{t(item.label)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <div className="flex-1" />

        <div className="relative z-40 w-full shrink-0">{footerSlot}</div>
      </aside>
    );
  }

  /* ---- Expanded state ---- */
  return (
    <aside className="flex h-screen min-h-0 w-[220px] shrink-0 flex-col bg-[var(--secondary)] transition-all duration-200">
      {/* Header: logo + collapse toggle */}
      <div className="flex h-14 items-center justify-between px-4">
        <Link
          href="/"
          aria-label={t("AIMTutor")}
          className="group flex items-center"
        >
          <TextLogo className="transition-transform duration-200 group-hover:scale-[1.02]" />
        </Link>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          aria-label={t("Collapse sidebar")}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* New chat + feature links (ChatGPT-style top section) */}
      <div className="shrink-0 px-2 pt-1">
        <button
          onClick={handleNewChat}
          className="mb-1 flex w-full items-center gap-2.5 rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/35 px-3 py-2 text-[13.5px] font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--background)]/60"
        >
          <Plus size={16} strokeWidth={2.2} />
          <span>{t("New Chat")}</span>
        </button>

        <nav className="pb-2">
          {/* Chat */}
          <Link
            href="/chat"
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              chatActive
                ? "bg-[var(--background)]/70 font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <MessageSquare size={16} strokeWidth={chatActive ? 1.9 : 1.5} />
            <span>{t("Chat")}</span>
          </Link>

          {/* Top-level items (Dashboard) */}
          {TOP_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  active
                    ? "bg-[var(--background)]/70 font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                <span>{t(item.label)}</span>
              </Link>
            );
          })}

          {/* Collapsible Learning Tools section */}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setLearningToolsOpen((v) => !v)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                learningToolsActive
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              <GraduationCap
                size={16}
                strokeWidth={learningToolsActive ? 1.9 : 1.5}
                className={learningToolsActive ? "text-[var(--foreground)]" : ""}
              />
              <span className="flex-1 text-left font-medium">{t("Learning Tools")}</span>
              <ChevronDown
                size={13}
                strokeWidth={2}
                className={`shrink-0 transition-transform duration-200 ${
                  learningToolsOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {learningToolsOpen && (
              <div className="ml-2 mt-0.5 border-l border-[var(--border)]/40 pl-2">
                {LEARNING_TOOLS_NAV.map((item) => {
                  const active = pathname.startsWith(item.href);
                  const hasBots = item.href === "/agents";
                  return (
                    <div key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                          active
                            ? "bg-[var(--background)]/70 font-medium text-[var(--foreground)]"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
                        }`}
                      >
                        <item.icon size={15} strokeWidth={active ? 1.9 : 1.5} />
                        <span>{t(item.label)}</span>
                      </Link>
                      {hasBots && <TutorBotRecent />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Recents — scrollable chat history */}
      {showRecents && (
        <div className="flex min-h-0 flex-1 flex-col pb-2">
          <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            {t("Recents")}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              loading={loadingSessions}
              onSelect={onSelectSession}
              onRename={onRenameSession}
              onDelete={onDeleteSession}
              compact
            />
          </div>
        </div>
      )}

      {!showRecents && <div className="flex-1" />}

      {footerSlot}
    </aside>
  );
}
