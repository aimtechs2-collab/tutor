"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { ClerkAuthBridge } from "@/components/auth/ClerkAuthBridge";
import { buildClerkAppearance, readAimThemeMode } from "@/components/auth/clerk-appearance";

export function ClerkAuthShell({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  const appearance =
    typeof document !== "undefined"
      ? buildClerkAppearance(readAimThemeMode())
      : buildClerkAppearance("dark");

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/chat"
      afterSignUpUrl="/chat"
      appearance={appearance}
    >
      <ClerkAuthBridge />
      {children}
    </ClerkProvider>
  );
}
