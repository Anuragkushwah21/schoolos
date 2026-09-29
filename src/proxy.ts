import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session";

/**
 * Optimistic route protection. Next 16 renamed Middleware to Proxy.
 *
 * This checks only whether a session cookie is *present* — it does not read
 * the database, does not validate the token, and grants nothing. Its job is to
 * spare signed-out visitors a pointless round-trip to a dashboard that would
 * redirect them anyway.
 *
 * Real authorization happens in `src/server/auth/current-user.ts` on every
 * request. The Next.js docs are explicit that Proxy must not be used as a
 * session or authorization layer, and a cookie's presence proves nothing: it
 * may be expired, revoked, or belong to a suspended school.
 */

const PROTECTED_PREFIXES = [
  "/super-admin",
  "/school-admin",
  "/teacher",
  "/student",
  "/parent",
  "/staff",
  "/account",
  "/api-tokens",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected) return NextResponse.next();

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip static assets and API routes; API handlers run their own checks.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
