import { type NextRequest, NextResponse } from 'next/server';
import { observeHttp } from '@/lib/observability/metrics';
import { routeTemplate } from '@/lib/observability/route-template';
import { buildCsp } from '@/lib/security/headers';
import { resolveSettingsRedirect } from '@/lib/settings/redirects';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/invite',
  '/api/auth',
  '/api/health',
  '/p/',
  '/s/',
  '/api/public',
  // Embedded images on public pages are loaded by anonymous visitors via
  // HMAC-signed URLs. The /api/files handler verifies the signature itself
  // (401 on a bad/missing sig), so it is its own access boundary and must not
  // be gated behind a session cookie — otherwise anonymous public-page image
  // requests get redirected to /login.
  '/api/files',
  // OAuth 2.1 + MCP are consumed by HEADLESS clients that carry NO session
  // cookie — they authenticate via PKCE/bearer tokens, not the browser session.
  // Each of these routes is its own access boundary, so the cookie gate must
  // not bounce them to /login (which broke the entire live MCP/OAuth flow):
  //   - /.well-known/oauth-* : public discovery metadata by RFC 8414 / 9728.
  //   - /api/oauth/*         : authorize self-redirects to /login when there is
  //                            no session; token/register/revoke are token- and
  //                            PKCE-authenticated, never cookie-authenticated.
  //   - /api/mcp             : authenticates the Authorization: Bearer token and
  //                            returns 401 + WWW-Authenticate itself.
  '/.well-known/oauth-',
  '/api/oauth',
  '/api/mcp',
];

// Auth.js v5 sets a cookie at this name when using database sessions.
// We do NOT validate the session in the proxy (it runs lightweight cookie
// checks only). Pages re-validate via getAuthContext() in their server components.
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

function record(
  res: NextResponse | Response,
  start: number,
  method: string,
  pathname: string,
): NextResponse | Response {
  observeHttp({
    method,
    route: routeTemplate(pathname),
    status: res.status ?? 307,
    durationSec: (performance.now() - start) / 1000,
  });
  return res;
}

export function proxy(req: NextRequest) {
  const start = performance.now();
  const { pathname } = req.nextUrl;
  const method = req.method;
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

  // v0.8.0 G4 P12 — settings hub restructure. Legacy paths redirect to the new
  // sectioned home; non-settings paths pass through. Runs BEFORE the auth gate
  // so logged-out hits get the new path baked into `?next=`.
  //
  // v0.9.19 A5 (#5) — 307 (temporary), NOT 308. A 308 is cacheable-permanent by
  // default: when /settings/admin used to 308 → /settings/workspace/members
  // (removed in item #5), browsers cached that hop forever and never re-asked
  // the server, so the new /settings/admin landing page stayed unreachable for
  // them. 307 + `Cache-Control: no-store` makes every settings redirect
  // non-cacheable so this class cannot recur. (Already-poisoned browsers still
  // need a hard reload / clear-site-data — documented in docs/operations.md.)
  const settingsRedirect = resolveSettingsRedirect(pathname);
  if (settingsRedirect) {
    const dest = req.nextUrl.clone();
    dest.pathname = settingsRedirect;
    const res = NextResponse.redirect(dest, 307);
    res.headers.set('Content-Security-Policy', csp);
    res.headers.set('Cache-Control', 'no-store, must-revalidate');
    return record(res, start, method, pathname);
  }

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    const res = NextResponse.redirect(url);
    res.headers.set('Content-Security-Policy', csp);
    return record(res, start, method, pathname);
  }
  if (hasSession && (pathname === '/login' || pathname === '/signup')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    const res = NextResponse.redirect(url);
    res.headers.set('Content-Security-Policy', csp);
    return record(res, start, method, pathname);
  }

  // Forward the nonce'd CSP on the request so the renderer can read it and apply
  // the nonce to its inline scripts, and set it on the response for the browser.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  // Forward the request pathname so server components / layouts can apply
  // path-aware gates (e.g. the (app)/layout require_2fa enrollment gate) without
  // re-implementing routing — proxy.ts owns the lightweight URL view of every
  // request.
  requestHeaders.set('x-pathname', pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  // v0.9.19 A5 (#5) — never let the bare /settings/admin landing page be cached
  // as anything (it was a 308 in a prior version). no-store guarantees a fresh
  // server hit so the real index always renders, even after future route moves.
  if (pathname === '/settings/admin') {
    res.headers.set('Cache-Control', 'no-store, must-revalidate');
  }
  return record(res, start, method, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
