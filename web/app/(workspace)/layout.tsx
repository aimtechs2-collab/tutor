import WorkspaceSidebar from "@/components/sidebar/WorkspaceSidebar";
import { NotificationBell } from "@/components/NotificationBell";
import TutorGuidanceOverlay from "@/components/gemini-live/TutorGuidanceOverlay";
import { UnifiedChatProvider } from "@/context/UnifiedChatContext";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <UnifiedChatProvider>
      <div className="flex h-screen overflow-hidden">
        <WorkspaceSidebar />
        <main className="flex-1 overflow-hidden bg-[var(--background)]">
          <div className="pointer-events-none fixed right-4 top-3 z-[120]">
            <div className="pointer-events-auto">
              <NotificationBell dropdownSide="bottom" />
            </div>
          </div>
          {children}
        </main>
      </div>
      {/* Lets the live voice tutor spotlight/navigate the app via function calls. */}
      <TutorGuidanceOverlay />
    </UnifiedChatProvider>
  );
}
