/**
 * Security-header builders — thin TS re-export shim over `../../../../next-headers.mjs`.
 *
 * The actual implementation lives in `next-headers.mjs` at the repo root so that
 * `next.config.mjs` can import it WITHOUT making the Next 16 output-file tracer
 * recurse into `src/**` (which produces a broken standalone build where the
 * runtime tries to `import` SOURCE .ts files; see next-headers.mjs preamble for
 * the full story).
 *
 * This module keeps the existing `@/lib/security/headers` import surface for
 * runtime callers (src/proxy.ts, src/app/layout.tsx, tests) and adds the TS
 * types they expect.
 */

import * as impl from '../../../next-headers.mjs';

export type CspOptions = {
  /** Collab WebSocket origin (env COLLAB_URL); added to connect-src. */
  collabUrl?: string;
  /** true → emit the stricter public-page policy (no inline scripts, frame-ancestors none). */
  publicPath?: boolean;
  /** true → omit HSTS (dev). HSTS only makes sense over https in prod. */
  isProd?: boolean;
  /**
   * Per-request nonce for inline scripts. When set, `script-src` becomes
   * `'self' 'nonce-<nonce>'` so Next/React's inline hydration bootstrap (and the
   * next-themes inline script) execute under the policy WITHOUT opening the gate
   * to arbitrary inline scripts (no 'unsafe-inline'). The nonce MUST be unique
   * per response and is generated in the proxy; the static next.config.mjs
   * headers() can't mint one, so the CSP is applied there with the nonce instead.
   */
  nonce?: string;
};

export const cspOrigin: (raw: string | undefined) => string | null = impl.cspOrigin;

export const cspNonce: (csp: string | null | undefined) => string | undefined = impl.cspNonce;

export const buildCsp: (opts?: CspOptions) => string = impl.buildCsp;

export const securityHeaders: (opts?: { isProd?: boolean; publicPath?: boolean }) => Array<{
  key: string;
  value: string;
}> = impl.securityHeaders;

export const headersFor: (opts: {
  collabUrl?: string;
  isProd?: boolean;
  publicPath?: boolean;
  nonce?: string;
}) => Array<{
  key: string;
  value: string;
}> = impl.headersFor;
