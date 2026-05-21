import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/invite',
  '/api/auth',
  '/api/health',
  '/p/',
  '/api/public',
  // Embedded images on public pages are loaded by anonymous visitors via
  // HMAC-signed URLs. The /api/files handler verifies the signature itself
  // (401 on a bad/missing sig), so it is its own access boundary and must not
  // be gated behind a session cookie — otherwise anonymous public-page image
  // requests get redirected to /login.
  '/api/files',
];

// Auth.js v5 sets a cookie at this name when using database sessions.
// We do NOT validate the session in middleware (Edge runtime can't reach Postgres).
// Pages re-validate via getAuthContext() in their server components.
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const hasSession = hasSessionCookie(req);

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && (pathname === '/login' || pathname === '/signup')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
