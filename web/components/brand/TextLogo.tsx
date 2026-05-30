"use client";

type TextLogoProps = {
  compact?: boolean;
  className?: string;
};

const COMPACT_PARTS = [
  { text: "A", className: "text-[#2563eb]" },
  { text: "i", className: "text-[#06143f] dark:text-[var(--foreground)]" },
];

const FULL_PARTS = [
  { text: "Aim", className: "text-[#2563eb]" },
  { text: "Tutor", className: "text-[#06143f] dark:text-[var(--foreground)]" },
  { text: ".ai", className: "text-[#2563eb]" },
];

export function TextLogo({ compact = false, className = "" }: TextLogoProps) {
  if (compact) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--background)]/70 font-sans text-[15px] font-extrabold leading-none shadow-sm ring-1 ring-[var(--border)]/45 ${className}`}
      >
        {COMPACT_PARTS.map((part) => (
          <span key={part.text} className={part.className}>
            {part.text}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-baseline whitespace-nowrap font-sans text-[22px] font-extrabold leading-none tracking-normal ${className}`}
    >
      {FULL_PARTS.map((part) => (
        <span key={part.text} className={`shrink-0 ${part.className}`}>
          {part.text}
        </span>
      ))}
    </span>
  );
}
