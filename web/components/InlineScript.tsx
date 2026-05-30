"use client";

/**
 * Inline script that runs before paint on hard navigations (SSR HTML parse).
 * On the client, type="text/plain" avoids React 19's inert-script warning.
 * @see https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
