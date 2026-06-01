/** @type {import('next').NextConfig} */
// IMPORTANT: import from the JS sibling (next-headers.mjs) — NOT from
// `./src/lib/security/headers.ts`. Importing the .ts module here causes the
// Next 16 output-file tracer to follow the dependency graph into `src/**` and
// drag SOURCE .ts files into `.next/standalone/`, which then crashes at runtime
// (e.g. "Cannot find module 'next/headers'" from a .ts route). The .ts module
// re-exports from this same .mjs so callers under @/lib/security/headers are
// unaffected.
import { securityHeaders } from './next-headers.mjs';

const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Skip the in-`next build` TypeScript phase. After "Compiled successfully",
  // Next spawns a separate type-checking worker that OOMs (SIGKILL) on the
  // self-hosted CI runner. This phase is redundant: type safety is enforced by
  // the dedicated `pnpm typecheck` (tsc --noEmit) CI step and the local
  // pre-commit gate, both of which fail the build on real type errors.
  // NOTE: Cairn uses Biome (no `next lint`/ESLint), so no `eslint` override is
  // needed here — only the in-build TS worker is the OOM culprit. (Next 16 also
  // no longer accepts an `eslint` key in this config.)
  typescript: { ignoreBuildErrors: true },
  // Next 16's NFT tracer pulls source `.ts/.tsx` files (and other repo-root
  // content like CHANGELOG.md, tests/, Dockerfile) into `.next/standalone/`.
  // At runtime on Node 22+ these `.ts` files can be picked up by Node's
  // experimental TS loader and shadow the compiled `.js` outputs, crashing with
  // "Cannot find module 'next/headers' imported from .../src/.../*.ts" because
  // the runtime tries to load the source `.ts` instead of the Next-compiled JS.
  // We exclude the source tree and repo-root chaff from the standalone trace.
  // The compiled JS still lives in `.next/server/app/...` which is what server.js
  // actually requires.
  outputFileTracingExcludes: {
    '*': [
      './src/**/*.ts',
      './src/**/*.tsx',
      './tests/**/*',
      './docs/**/*',
      './*.md',
      './Dockerfile*',
      './collab/**/*.ts',
      './scripts/**/*',
      './drizzle/**/*',
      './.github/**/*',
    ],
  },
  async headers() {
    // Static, request-independent hardening headers (nosniff, frame-DENY,
    // referrer, permissions-policy, HSTS, X-Robots-Tag). The Content-Security-
    // Policy is NOT set here: it carries a per-request nonce so Next/React's
    // inline hydration scripts execute without 'unsafe-inline'. A nonce can only
    // be minted per request, which next.config.mjs headers() cannot do — so the
    // CSP is applied in src/proxy.ts instead. See src/lib/security/headers.ts.
    return [
      {
        // Public read-only render: noindex + the public hardening set.
        source: '/p/:path*',
        headers: securityHeaders({ isProd, publicPath: true }),
      },
      {
        // Everything else (app shell, editor, API).
        source: '/:path*',
        headers: securityHeaders({ isProd, publicPath: false }),
      },
    ];
  },
};

// NOTE: the PWA service worker is NOT wired through next.config here. We use
// Serwist's "configurator" mode (`@serwist/next/config` + `@serwist/cli`),
// which builds public/sw.js as a separate post-`next build` step. The init-mode
// plugin (`withSerwistInit`) injects a webpack config, which is incompatible
// with this app's Turbopack build (client-reachable `node:` imports fail under
// webpack). See serwist.config.mjs and the `build:sw` script in package.json.
export default nextConfig;
