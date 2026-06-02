import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ClerkSignInPanel } from "@/components/auth/ClerkAuthPanel";

function AuthLoading() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-8 py-10 text-center text-sm text-[var(--muted-foreground)]">
      Loading sign in…
    </div>
  );
}

export default function Page() {
  return (
    <AuthPageShell
      title="Welcome back"
      subtitle="Sign in to continue to your workspace"
    >
      <Suspense fallback={<AuthLoading />}>
        <ClerkSignInPanel />
      </Suspense>
    </AuthPageShell>
  );
}
