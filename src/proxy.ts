import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate in front of the app: unauthenticated visitors are sent to the
 * login page. Full session verification (signature, revocation, roles)
 * happens in server components and route handlers.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("lp_session");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/terminal/:path*",
    "/learn/:path*",
    "/commands/:path*",
    "/challenges/:path*",
    "/quizzes/:path*",
    "/achievements/:path*",
    "/progress/:path*",
    "/assignments/:path*",
    "/settings/:path*",
    "/teacher/:path*",
    "/admin/:path*",
  ],
};
