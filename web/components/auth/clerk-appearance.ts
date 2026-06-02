import { dark } from "@clerk/themes";
import type { Appearance } from "@clerk/types";

export type AimThemeMode = "light" | "dark" | "snow" | "glass";

const PALETTES: Record<
  AimThemeMode,
  {
    primary: string;
    primaryForeground: string;
    background: string;
    card: string;
    foreground: string;
    mutedForeground: string;
    border: string;
    input: string;
  }
> = {
  light: {
    primary: "#b0501e",
    primaryForeground: "#ffffff",
    background: "#fdfcf9",
    card: "#ffffff",
    foreground: "#1c1816",
    mutedForeground: "#6d645a",
    border: "#e6decc",
    input: "#fdfcf9",
  },
  dark: {
    primary: "#d4734b",
    primaryForeground: "#1a1918",
    background: "#1a1918",
    card: "#242220",
    foreground: "#e8e4de",
    mutedForeground: "#9b9590",
    border: "#3a3634",
    input: "#1a1918",
  },
  snow: {
    primary: "#1d4ed8",
    primaryForeground: "#ffffff",
    background: "#f9fbfd",
    card: "#ffffff",
    foreground: "#0e1a2e",
    mutedForeground: "#4d5d77",
    border: "#cdd9e4",
    input: "#f9fbfd",
  },
  glass: {
    primary: "#a78bfa",
    primaryForeground: "#0e0d1a",
    background: "#0e0d1a",
    card: "rgba(255, 255, 255, 0.06)",
    foreground: "#ffffff",
    mutedForeground: "rgba(255, 255, 255, 0.65)",
    border: "rgba(255, 255, 255, 0.12)",
    input: "rgba(255, 255, 255, 0.04)",
  },
};

export function readAimThemeMode(): AimThemeMode {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  if (root.classList.contains("theme-glass")) return "glass";
  if (root.classList.contains("theme-snow")) return "snow";
  if (root.classList.contains("dark")) return "dark";
  return "light";
}

export function buildClerkAppearance(mode: AimThemeMode): Appearance {
  const p = PALETTES[mode];
  const isDark = mode === "dark" || mode === "glass";

  return {
    baseTheme: isDark ? dark : undefined,
    variables: {
      colorPrimary: p.primary,
      colorDanger: "#d44a3c",
      colorSuccess: "#3d9a5f",
      colorBackground: p.card,
      colorInputBackground: p.input,
      colorInputText: p.foreground,
      colorText: p.foreground,
      colorTextSecondary: p.mutedForeground,
      colorNeutral: p.mutedForeground,
      borderRadius: "0.75rem",
      fontFamily: "var(--font-sans), system-ui, sans-serif",
      fontSize: "0.875rem",
    },
    elements: {
      rootBox: "w-full mx-auto",
      cardBox: "w-full shadow-none",
      card: "shadow-sm bg-[var(--card)] border border-[var(--border)] rounded-2xl overflow-hidden",
      // Page shell already shows title; avoid duplicate Clerk header block.
      header: "hidden",
      logoBox: "hidden",
      headerTitle: "hidden",
      headerSubtitle: "hidden",
      socialButtonsBlockButton:
        "border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors",
      socialButtonsBlockButtonText: "text-[var(--foreground)] font-medium",
      dividerLine: "bg-[var(--border)]",
      dividerText: "text-[var(--muted-foreground)] text-xs",
      formFieldLabel: "text-[var(--foreground)] text-sm font-medium",
      formFieldInput:
        "bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent",
      formFieldInput__emailAddress: {
        autoComplete: "email",
      },
      formFieldInput__password: {
        autoComplete: "current-password",
      },
      formFieldInputShowPasswordButton: "text-[var(--muted-foreground)]",
      formButtonPrimary:
        "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 shadow-none normal-case text-sm font-medium",
      formButtonReset: "text-[var(--primary)] hover:opacity-80",
      footer: "bg-[var(--card)] border-t border-[var(--border)]",
      footerAction: "bg-[var(--card)] justify-center py-4",
      footerActionText: "text-[var(--muted-foreground)] text-sm",
      footerActionLink: "text-[var(--primary)] font-medium hover:opacity-80",
      identityPreviewText: "text-[var(--foreground)]",
      identityPreviewEditButton: "text-[var(--primary)]",
      alternativeMethodsBlockButton:
        "border border-[var(--border)] text-[var(--foreground)]",
      otpCodeFieldInput:
        "bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)]",
      formResendCodeLink: "text-[var(--primary)]",
      badge: "bg-[var(--accent)] text-[var(--muted-foreground)] border border-[var(--border)]",
      // Dev instance notice — keep visible but on-brand
      developmentModeNotice:
        "bg-[var(--muted)] text-[var(--muted-foreground)] border-t border-[var(--border)] text-xs",
    },
    layout: {
      socialButtonsPlacement: "top",
      socialButtonsVariant: "blockButton",
    },
  };
}
