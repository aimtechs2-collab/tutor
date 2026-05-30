import { ClerkAuthCard } from "@/components/auth/ClerkAuthCard";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <ClerkAuthCard mode="sign-up" />
    </div>
  );
}
