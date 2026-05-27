/**
 * Pure security-header builders, JS-only sibling of src/lib/security/headers.ts.
 *
 * Why this exists: next.config.mjs imports `securityHeaders` at config-load
 * time. Importing `src/lib/security/headers.ts` from next.config.mjs causes the
 * Next 16 output-file tracer to follow the dependency graph into `src/**` and
 * include SOURCE `.ts` files in the standalone build, where Node then tries to
 * `import` them at runtime and fails (e.g. on `next/headers` resolution). By
 * keeping the next.config dependency entirely in `.mjs` files outside `src/`,
 * the tracer never recurses into the app source from the config side.
 *
 * The TypeScript module (src/lib/security/headers.ts) re-exports from here so
 * that runtime callers (src/proxy.ts, src/app/layout.tsx, tests) keep their
 * existing `@/lib/security/headers` imports.
 */

/**
 * CSP `frame-src` allowlist for the P5 embed node. Kept inlined (not imported
 * from src/lib/editor/embed-allowlist.ts) so this module is import-free.
 * A drift-guard test asserts the two stay equal.
 */
export const EMBED_FRAME_HOSTS = /** @type {const} */ ([
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://www.figma.com',
  'https://gist.github.com',
  'https://codesandbox.io',
  'https://www.loom.com',
  'https://codepen.io',
  'https://open.spotify.com',
  'https://vimeo.com',
  'https://excalidraw.com',
  // v0.9.0 G3 P15 — drawio viewer-only iframe.
  'https://viewer.diagrams.net',
]);

/** Normalize a ws(s)/http(s) URL to a CSP source token (scheme + host[:port]). */
export function cspOrigin(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Extract the script-src nonce from a CSP string.
 * @param {string | null | undefined} csp
 * @returns {string | undefined}
 */
export function cspNonce(csp) {
  if (!csp) return undefined;
  const m = csp.match(/'nonce-([^']+)'/);
  return m ? m[1] : undefined;
}

/**
 * @param {{ collabUrl?: string; publicPath?: boolean; isProd?: boolean; nonce?: string }} [opts]
 * @returns {string}
 */
export function buildCsp(opts = {}) {
  const collab = cspOrigin(opts.collabUrl);
  const connect = ["'self'"];
  if (collab) {
    connect.push(collab);
    try {
      const u = new URL(opts.collabUrl);
      const wsScheme =
        u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol;
      connect.push(`${wsScheme}//${u.host}`);
    } catch {
      /* ignore */
    }
  }

  const scriptSrc = ["'self'"];
  if (opts.nonce) scriptSrc.push(`'nonce-${opts.nonce}'`);

  /** @type {Record<string, string[]>} */
  const directives = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-src': ["'self'", ...EMBED_FRAME_HOSTS],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  if (opts.publicPath) {
    directives['connect-src'] = ["'self'"];
    directives['script-src'] = scriptSrc;
  }

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/**
 * @param {{ isProd?: boolean; publicPath?: boolean }} [opts]
 * @returns {Array<{ key: string; value: string }>}
 */
export function securityHeaders(opts = {}) {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
  if (opts.isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }
  if (opts.publicPath) {
    headers.push({ key: 'X-Robots-Tag', value: 'noindex' });
  }
  return headers;
}

/**
 * @param {{ collabUrl?: string; isProd?: boolean; publicPath?: boolean; nonce?: string }} opts
 * @returns {Array<{ key: string; value: string }>}
 */
export function headersFor(opts) {
  return [
    ...securityHeaders({ isProd: opts.isProd, publicPath: opts.publicPath }),
    {
      key: 'Content-Security-Policy',
      value: buildCsp({
        collabUrl: opts.collabUrl,
        isProd: opts.isProd,
        publicPath: opts.publicPath,
        nonce: opts.nonce,
      }),
    },
  ];
}
