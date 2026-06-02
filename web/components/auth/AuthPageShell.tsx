import Image from "next/image";
import type { ReactNode } from "react";

export function AuthPageShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-4 py-10">
      <div className="mb-8 flex w-full max-w-[26rem] flex-col items-center text-center">
        <Image
          src="/logo-text.svg"
          alt="AIMTutor"
          width={168}
          height={40}
          className="h-9 w-auto dark:brightness-110"
          priority
        />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
      </div>

      <div className="cl-auth-panel w-full max-w-[26rem]">{children}</div>

      {footer ? (
        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">{footer}</p>
      ) : (
        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
          AIMTutor · Agent-native learning
        </p>
      )}
    </div>
  );
}
