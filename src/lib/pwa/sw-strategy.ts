/**
 * Pure, unit-tested caching-strategy matcher — the source of truth for which
 * Serwist runtime-caching rule applies to a request. The service worker
 * (`src/app/sw.ts`) keeps its `runtimeCaching` predicates textually parallel to
 * the branches below (same order, same conditions).
 *
 * SECURITY-CRITICAL: `network-only` is checked FIRST and exhaustively so no read
 * rule can ever shadow it. Mutations, auth, signed `/api/files/*` reads, and the
 * collab token/WS endpoint are NEVER cached.
 *
 * #143 (multi-tenant data isolation): authenticated `/api/` GET reads are scoped
 * by the active-workspace COOKIE, not the URL. A URL-keyed cache (the old `swr`
 * `api-reads` store) therefore served workspace A's response to workspace B after
 * a switch (saved searches, flashcard due-count, pins, comments, databases, …).
 * So `/api/` reads are now `network-first`: online always re-fetches for the
 * current workspace (kills the leak), and the per-URL cache is used only as an
 * offline fallback. The `swr` strategy is retired.
 */

export type SwStrategy = 'network-only' | 'network-first' | 'precache';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Static asset extensions that are safe to precache. */
const STATIC_EXT =
  /\.(?:js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp|avif|ico|json|txt|webmanifest)$/i;

export function matchStrategy(url: URL, method: string): SwStrategy {
  const { pathname, protocol } = url;

  // 1. network-only — NEVER cached. Checked first and exhaustively.
  if (
    MUTATING_METHODS.has(method.toUpperCase()) ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/files') ||
    pathname.startsWith('/api/collab') ||
    protocol === 'ws:' ||
    protocol === 'wss:'
  ) {
    return 'network-only';
  }

  // 2. precache — Next build output + static-ext assets.
  if (pathname.startsWith('/_next/static') || STATIC_EXT.test(pathname)) {
    return 'precache';
  }

  // 3. network-first — authenticated `/api/` GET reads (cookie-scoped: see the
  // #143 note above), navigations, and everything else. Online → fresh for the
  // current workspace; the per-URL cache is an offline fallback only.
  return 'network-first';
}
