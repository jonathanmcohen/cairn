import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp } from '@/lib/security/headers';

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
// We do NOT validate the session in the proxy (it runs lightweight cookie
// checks only). Pages re-validate via getAuthContext() in their server components.
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const hasSession = hasSessionCookie(req);

  // Per-request CSP nonce. Next/React's inline hydration scripts (the RSC
  // payload pushes + the next-themes bootstrap) would be blocked by a bare
  // `script-src 'self'`; minting a fresh nonce here and putting it on the CSP
  // lets them run WITHOUT 'unsafe-inline'. Next reads the nonce from the CSP on
  // the *request* headers and stamps it onto every framework-injected <script>.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    collabUrl: process.env.COLLAB_URL,
    isProd: process.env.NODE_ENV === 'production',
    publicPath: pathname.startsWith('/p/'),
  });

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    const res = NextResponse.redirect(url);
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }
  if (hasSession && (pathname === '/login' || pathname === '/signup')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    const res = NextResponse.redirect(url);
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }

  // Forward the nonce'd CSP on the request so the renderer can read it and apply
  // the nonce to its inline scripts, and set it on the response for the browser.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
