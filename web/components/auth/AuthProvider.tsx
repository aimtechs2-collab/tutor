import type React from "react";
import { ClerkAuthBridge } from "@/components/auth/ClerkAuthBridge";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const CLERK_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" && Boolean(CLERK_PUBLISHABLE_KEY);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) return <>{children}</>;

  return (
    <>
      <ClerkAuthBridge publishableKey={CLERK_PUBLISHABLE_KEY} />
      {children}
    </>
  );
}
