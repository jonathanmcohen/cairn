// Serwist "configurator" mode build options for `@serwist/cli build`.
//
// We deliberately avoid the init-mode plugin (`withSerwistInit` in
// next.config.mjs) because it injects a webpack config, which is incompatible
// with this app's Turbopack build (client-reachable `node:` imports fail under
// webpack). Instead, `pnpm build:sw` runs the Serwist CLI as a post-`next build`
// step: it reads the generated `.next` manifest, bundles `src/app/sw.ts` with
// esbuild, and emits `public/sw.js` (gitignored).
//
// The CLI does `(await import(configFile)).default`, so we resolve the async
// configurator here via top-level await and export the resolved options object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serwist } from '@serwist/next/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default await serwist({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Resolve the `@/` path alias (tsconfig `paths`) for the esbuild SW bundle so
  // `src/app/sw.ts` can import the unit-tested `@/lib/pwa/sw-strategy` matcher.
  esbuildOptions: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
