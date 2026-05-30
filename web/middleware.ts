import { NextRequest, NextResponse } from "next/server";

const CLERK_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const LEGACY_AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
const LOGIN_PATH = "/login";
const COOKIE_NAME = "dt_token";

const PUBLIC_PREFIXES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/login",
  "/register",
  "/api/webhooks",
  "/api/v1/gemini-live/config",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => prefix !== "/" && pathname.startsWith(prefix));
}

function hasClerkSession(req: NextRequest): boolean {
  return req.cookies.has("__session") || req.cookies.has("__client_uat");
}

function clerkFrontendApi(): string {
  const encoded = CLERK_PUBLISHABLE_KEY.split("_").slice(2).join("_");
  try {
    return atob(encoded).replace(/\$$/, "");
  } catch {
    return "";
  }
}

function clerkAssetUrl(asset: "clerk" | "ui"): string {
  const frontendApi = clerkFrontendApi();
  const packagePath =
    asset === "ui"
      ? "@clerk/ui@1/dist/ui.browser.js"
      : "@clerk/clerk-js@6/dist/clerk.browser.js";
  return frontendApi
    ? `https://${frontendApi}/npm/${packagePath}`
    : `https://cdn.jsdelivr.net/npm/${packagePath}`;
}

function clerkUiChunkUrl(filename: string): string {
  const frontendApi = clerkFrontendApi();
  return frontendApi
    ? `https://${frontendApi}/npm/@clerk/ui@1/dist/${filename}`
    : `https://cdn.jsdelivr.net/npm/@clerk/ui@1/dist/${filename}`;
}

async function clerkScriptResponse(assetOrUrl: "clerk" | "ui" | string): Promise<NextResponse> {
  const url =
    assetOrUrl === "clerk" || assetOrUrl === "ui"
      ? clerkAssetUrl(assetOrUrl)
      : assetOrUrl;
  const upstream = await fetch(url, { cache: "force-cache" });
  if (!upstream.ok) {
    return new NextResponse("console.error('Failed to load ClerkJS');", {
      status: 502,
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }
  return new NextResponse(await upstream.text(), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/javascript; charset=utf-8",
    },
  });
}

async function clerkMiddleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/__clerk/clerk.browser.js") return clerkScriptResponse("clerk");
  if (pathname === "/__clerk/ui.browser.js") return clerkScriptResponse("ui");
  if (pathname.startsWith("/__clerk/")) {
    return clerkScriptResponse(clerkUiChunkUrl(pathname.replace("/__clerk/", "")));
  }
  if (pathname.startsWith(LOGIN_PATH)) {
    const signInUrl = req.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.search = search;
    return NextResponse.redirect(signInUrl);
  }
  if (pathname.startsWith("/register")) {
    const signUpUrl = req.nextUrl.clone();
    signUpUrl.pathname = "/sign-up";
    signUpUrl.search = search;
    return NextResponse.redirect(signUpUrl);
  }
  if (!isPublicPath(pathname) && !hasClerkSession(req)) {
    const signInUrl = req.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("redirect_url", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

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

export default async function middleware(req: NextRequest) {
  if (CLERK_ENABLED) return clerkMiddleware(req);
  return legacyMiddleware(req);
}

export const config = {
  matcher: [
    "/__clerk/:path*",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
