import { type NextRequest, NextResponse } from 'next/server';
import { getMaintenance } from '@/lib/backups/maintenance';
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
  // v0.10.0 H4d — /healthz is THE readiness probe (503s on db-down). A load
  // balancer probes it unauthenticated; behind the session gate it answered
  // 307-to-login, which LBs read as unhealthy. It exposes the same
  // status/db/version signal /api/health already serves publicly.
  '/healthz',
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
  // v0.10.0 G1 — INBOUND federated search is server-to-server: the calling
  // Cairn instance carries NO session cookie, it authenticates via the
  // HMAC-signed envelope which the route verifies itself (401 on failure).
  // Same lesson as /api/mcp above: a cookieless headless route that is its
  // own access boundary must not be bounced to /login by the cookie gate.
  '/api/search/federated/peer',
  // v0.10.3 A11Y-0 — the documented public REST API (`/api/v1/*`) is a HEADLESS
  // bearer surface: callers send `Authorization: Bearer cairn_sk_…` and carry NO
  // session cookie. Every route is wrapped in `withApiKey` (src/lib/api/rate-limit.ts),
  // which is its OWN access boundary — it returns 401 JSON on a missing/invalid
  // key. Without this entry the cookie gate 307-redirected every API call to
  // /login (HTML), making the published API unusable for any non-browser client
  // (scripts, the a11y seed exporter, CI). Same lesson as /api/mcp + /api/oauth.
  '/api/v1',
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

  // v0.10.0 C2 — app-wide read-only mode while a restore job runs. The proxy
  // shares the routes' Node process in the standalone server and the flag
  // lives on globalThis (see src/lib/backups/maintenance.ts), so the flag the
  // restore route set is visible here. Block mutating API requests so
  // concurrent writes can't race pg_restore's table drops. Exempt:
  //   - GET/HEAD/OPTIONS everywhere: navigation stays up so the restore
  //     banner renders and users see read-only content, not an outage;
  //   - /api/admin/backups/*: the admin must be able to poll job status and
  //     the restore POST itself must reach its route (a second concurrent
  //     restore is answered 409 by the route, not 503 here);
  //   - /api/auth/*: Auth.js session callbacks must keep working or polls
  //     and navigation could bounce to /login mid-restore.
  if (
    pathname.startsWith('/api/') &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    method !== 'OPTIONS' &&
    !pathname.startsWith('/api/admin/backups') &&
    !pathname.startsWith('/api/auth') &&
    getMaintenance().active
  ) {
    const res = NextResponse.json({ error: 'maintenance', reason: 'restore' }, { status: 503 });
    return record(res, start, method, pathname);
  }

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
