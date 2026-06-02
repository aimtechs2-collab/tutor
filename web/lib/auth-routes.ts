/** Routes where the user is signing in — never use as post-login redirect targets. */
const PUBLIC_AUTH_PREFIXES = ["/sign-in", "/sign-up", "/login", "/register"];

export function isPublicAuthPath(pathname: string): boolean {
  const path = pathname.split("?")[0] || "/";
  return PUBLIC_AUTH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Normalize redirect targets so auth pages never loop back to themselves. */
export function sanitizePostAuthRedirect(path: string): string {
  let target = path.trim() || "/chat";
  try {
    if (/^https?:\/\//i.test(target)) {
      target = new URL(target).pathname + new URL(target).search;
    }
  } catch {
    // keep target as-is
  }
  if (!target.startsWith("/")) target = `/${target}`;
  const pathname = target.split("?")[0] || "/";
  if (isPublicAuthPath(pathname)) return "/chat";
  return target;
}
