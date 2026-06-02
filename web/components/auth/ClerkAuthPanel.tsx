"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useClerkAppearance } from "@/components/auth/useClerkAppearance";
import { sanitizePostAuthRedirect } from "@/lib/auth-routes";

function useSanitizedRedirectUrl(): string {
  const searchParams = useSearchParams();
  const raw =
    searchParams.get("redirect_url") || searchParams.get("next") || "/chat";
  const safe = sanitizePostAuthRedirect(raw);

  useEffect(() => {
    if (!raw || safe === raw) return;
    const params = new URLSearchParams(window.location.search);
    params.set("redirect_url", safe);
    const base = window.location.pathname.startsWith("/sign-up")
      ? "/sign-up"
      : "/sign-in";
    window.history.replaceState(null, "", `${base}?${params.toString()}`);
  }, [raw, safe]);

  return safe;
}

export function ClerkSignInPanel() {
  const redirectUrl = useSanitizedRedirectUrl();
  const appearance = useClerkAppearance();
  return (
    <SignIn
      appearance={appearance}
      routing="path"
      path="/sign-in"
      signUpUrl="/sign-up"
      forceRedirectUrl={redirectUrl}
      fallbackRedirectUrl={redirectUrl}
    />
  );
}

export function ClerkSignUpPanel() {
  const redirectUrl = useSanitizedRedirectUrl();
  const appearance = useClerkAppearance();
  return (
    <SignUp
      appearance={appearance}
      routing="path"
      path="/sign-up"
      signInUrl="/sign-in"
      forceRedirectUrl={redirectUrl}
      fallbackRedirectUrl={redirectUrl}
    />
  );
}
