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
  // Keep sql.js OUT of the bundle (.apkg export, src/lib/flashcards/apkg.ts).
  // Turbopack statically rewrites `require.resolve('sql.js')` — even through
  // `createRequire(import.meta.url)` — into the bundled NUMERIC module id, so
  // `path.dirname(<that number>)` throws "path argument must be of type string"
  // and the export 500s. Marking sql.js external leaves both the `import` and
  // the `require.resolve` as real Node runtime calls against
  // node_modules/sql.js, returning a real filesystem path. The sibling
  // `sql-wasm.wasm` is pinned into the standalone trace via
  // outputFileTracingIncludes below (NFT copies the JS but not the .wasm).
  serverExternalPackages: ['sql.js'],
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
  // The .apkg export route (src/app/api/flashcards/export/apkg) instantiates
  // sql.js, which loads its wasm binary (`sql-wasm.wasm`) at runtime from beside
  // the package main in node_modules. Next's NFT tracer copies the imported JS
  // but NOT the sibling `.wasm` (it's not a JS `require`), so the standalone
  // server can't find it. Force the wasm (and the JS that loads it) into the
  // route's trace. The glob covers both the hoisted path and pnpm's virtual
  // store (`.pnpm/sql.js@*/node_modules/sql.js/...`).
  outputFileTracingIncludes: {
    '/api/flashcards/export/apkg': [
      './node_modules/.pnpm/sql.js@*/node_modules/sql.js/dist/sql-wasm.wasm',
      './node_modules/.pnpm/sql.js@*/node_modules/sql.js/dist/sql-wasm.js',
      './node_modules/sql.js/dist/sql-wasm.wasm',
      './node_modules/sql.js/dist/sql-wasm.js',
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
  async redirects() {
    // Audit item B: the SSO console moved into the settings hub
    // (/admin/sso* → /settings/admin/sso*). Keep old bookmarks/deep links
    // working with a permanent (308) redirect. The wildcard rule covers
    // oidc/new, oidc/:id/edit, saml/new, saml/:id/edit; the bare rule covers
    // the index. API routes under /api/admin/sso/* are NOT redirected.
    return [
      {
        source: '/admin/sso/:path*',
        destination: '/settings/admin/sso/:path*',
        permanent: true,
      },
      {
        source: '/admin/sso',
        destination: '/settings/admin/sso',
        permanent: true,
      },
      // v0.9.9 A4 (#2/#3) — muscle-memory / stale-bookmark aliases for settings
      // pages that moved into the hub. The live source hrefs are already correct
      // (/settings/workspace/trash, /settings/developer/tokens); these 308
      // aliases make the older typed URLs resolve instead of 404-ing.
      {
        source: '/trash-retention',
        destination: '/settings/workspace/trash',
        permanent: true,
      },
      {
        source: '/access-tokens',
        destination: '/settings/developer/tokens',
        permanent: true,
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
