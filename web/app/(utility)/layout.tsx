import UtilitySidebar from "@/components/sidebar/UtilitySidebar";
import { NotificationBell } from "@/components/NotificationBell";

export default function UtilityLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-screen overflow-hidden">
      <UtilitySidebar />
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--background)] [scrollbar-gutter:stable]">
        <div className="pointer-events-none fixed right-4 top-3 z-[120]">
          <div className="pointer-events-auto">
            <NotificationBell dropdownSide="bottom" />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
