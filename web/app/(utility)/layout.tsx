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
      <main className="flex-1 overflow-hidden bg-[var(--background)]">
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
