import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "var(--primary)",
            colorBackground: "var(--card)",
            colorText: "var(--foreground)",
            fontFamily: "inherit",
          },
          elements: {
            card: "shadow-none border border-[var(--border)] rounded-xl",
            formButtonPrimary: "bg-[var(--primary)] hover:opacity-90",
          },
        }}
      />
    </div>
  );
}
