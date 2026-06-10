/// <reference lib="webworker" />

import {
  type HandlerDidErrorCallbackParam,
  NetworkFirst,
  NetworkOnly,
  type RouteMatchCallbackOptions,
  type RuntimeCaching,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';
import { matchStrategy } from '@/lib/pwa/sw-strategy';

// Serwist global augmentation: `self.__SW_MANIFEST` is the injection point the
// build replaces with the precache manifest, and `__WB_DISABLE_DEV_LOGS`
// silences runtime logging.
declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: Array<{ url: string; revision: string | null }> | undefined;
    __WB_DISABLE_DEV_LOGS: boolean;
  }
}

declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

// SECURITY-CRITICAL: this runtimeCaching list is the worker mirror of the
// pure, unit-tested matcher in `src/lib/pwa/sw-strategy.ts`. The order and the
// predicates are kept textually parallel to that file (network-only first and
// exhaustive, then precache, then api-read swr, then navigation network-first)
// and each route below delegates its decision to `matchStrategy` so the two
// can never drift. Mutations, auth, signed `/api/files/*` reads, and the collab
// token/WS endpoint are NEVER cached.

const is = (o: RouteMatchCallbackOptions, strategy: string) =>
  matchStrategy(o.url, o.request.method) === strategy;

const runtimeCaching: RuntimeCaching[] = [
  {
    // 1. network-only — mutations (any path), /api/auth, /api/files, /api/collab,
    // ws/wss. Never cached. `method` is intentionally omitted so the matcher
    // (which inspects request.method itself) sees every method.
    matcher: (o) => is(o, 'network-only'),
    handler: new NetworkOnly(),
  },
  {
    // 2. precache — handled by the precache manifest, but also serve /_next/static
    // and static-ext assets from cache-first via the dedicated precache route.
    // Anything not in the manifest falls through; treat as stale-while-revalidate
    // so first-paint assets are still served fast after they are seen once.
    matcher: (o) => is(o, 'precache'),
    handler: new StaleWhileRevalidate({ cacheName: 'static-assets' }),
  },
  {
    // 3. network-first — authenticated `/api/` GET reads (cookie-scoped per
    // #143 — never URL-cache cross-workspace), navigations, and everything
    // else. Fall back to cache after a short timeout so a flaky network still
    // renders the last good shell.
    matcher: (o) => is(o, 'network-first'),
    handler: new NetworkFirst({
      cacheName: 'pages',
      networkTimeoutSeconds: 3,
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  // Offline fallback: a failed navigation serves the precached /offline shell.
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }: HandlerDidErrorCallbackParam) => request.mode === 'navigate',
      },
    ],
  },
});

serwist.addEventListeners();
