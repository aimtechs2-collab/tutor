import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const LEGACY_AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const LOGIN_PATH = "/login";
const COOKIE_NAME = "dt_token";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/login(.*)",
  "/register(.*)",
  "/api/webhooks(.*)",
  "/api/v1/gemini-live/config",
]);

const clerkProtectedMiddleware = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

function legacyMiddleware(req: NextRequest) {
  if (!LEGACY_AUTH_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith(LOGIN_PATH) ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  if (!req.cookies.get(COOKIE_NAME)?.value) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (CLERK_ENABLED) return clerkProtectedMiddleware(req, event);
  return legacyMiddleware(req);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
