/**
 * Pure, unit-tested caching-strategy matcher — the source of truth for which
 * Serwist runtime-caching rule applies to a request. The service worker
 * (`src/app/sw.ts`) keeps its `runtimeCaching` predicates textually parallel to
 * the branches below (same order, same conditions).
 *
 * SECURITY-CRITICAL: `network-only` is checked FIRST and exhaustively so no read
 * rule can ever shadow it. Mutations, auth, signed `/api/files/*` reads, and the
 * collab token/WS endpoint are NEVER cached.
 */

export type SwStrategy = 'network-only' | 'swr' | 'network-first' | 'precache';

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

  // 3. swr — cacheable API reads (e.g. /api/pages, /api/search).
  if (pathname.startsWith('/api/')) {
    return 'swr';
  }

  // 4. network-first — navigations and everything else.
  return 'network-first';
}
