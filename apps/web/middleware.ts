import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@course-prod/core";

/**
 * Coarse gate only. The middleware runs on the edge runtime where the HMAC
 * verify in @course-prod/core is awkward, so it checks for cookie *presence*
 * and every page/route re-verifies the signature server-side via
 * lib/session.ts. Presence alone is never treated as authentication.
 */

const PUBLIC_PATHS = ["/login", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Signed URLs carry their own HMAC and are validated in the route itself.
  if (pathname.startsWith("/api/files")) return NextResponse.next();

  if (!req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
