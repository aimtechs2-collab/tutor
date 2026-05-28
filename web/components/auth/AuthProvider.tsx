import { ClerkProvider } from "@clerk/nextjs";
import type React from "react";
import { ClerkAuthBridge } from "@/components/auth/ClerkAuthBridge";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) return <>{children}</>;

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ClerkAuthBridge />
      {children}
    </ClerkProvider>
  );
}
