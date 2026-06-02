import { Suspense } from "react";
import Link from "next/link";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ClerkSignUpPanel } from "@/components/auth/ClerkAuthPanel";

function AuthLoading() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-8 py-10 text-center text-sm text-[var(--muted-foreground)]">
      Loading sign up…
    </div>
  );
}

export default function Page() {
  return (
    <AuthPageShell
      title="Create your account"
      subtitle="Join AIMTutor to start learning with your AI tutor"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-[var(--primary)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthLoading />}>
        <ClerkSignUpPanel />
      </Suspense>
    </AuthPageShell>
  );
}
