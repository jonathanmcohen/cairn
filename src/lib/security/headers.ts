/**
 * Pure security-header builders. No imports at all (not even `@/…`) so the module
 * stays loadable from next.config.mjs, which imports it OUTSIDE the tsconfig
 * path-alias resolver (`@/…` → ERR_MODULE_NOT_FOUND there). All values are
 * deliberately explicit (no wildcards) per spec §3.1.
 */

/**
 * CSP `frame-src` allowlist for the P5 embed node — the EXACT origins
 * `EMBED_FRAME_HOSTS` in `src/lib/editor/embed-allowlist.ts` resolves to. Inlined
 * (not imported) to keep this module import-free for the next.config.mjs loader; a
 * drift-guard test (tests/lib/security/headers.test.ts) asserts the two stay equal.
 */
const EMBED_FRAME_HOSTS = [
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
] as const;

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

/** Normalize a ws(s)/http(s) URL to a CSP source token (scheme + host[:port]). */
export function cspOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // ws→http, wss→https for the source token; connect-src accepts both schemes,
    // but emitting the http(s) origin is broadest-compatible. Keep ws scheme too.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Extract the script-src nonce from a CSP string (e.g. the one the proxy puts on
 * the request header). Returns undefined if none — callers pass it to next-themes
 * so its inline bootstrap script carries the matching nonce.
 */
export function cspNonce(csp: string | null | undefined): string | undefined {
  if (!csp) return undefined;
  const m = csp.match(/'nonce-([^']+)'/);
  return m ? m[1] : undefined;
}

export function buildCsp(opts: CspOptions = {}): string {
  const collab = cspOrigin(opts.collabUrl);
  // connect-src: self + collab WS (both ws and http origins) for the y-websocket
  // provider and SSR fetches. OAuth redirects are top-level navigations, not
  // fetch/connect, so they don't need a connect-src entry.
  const connect = ["'self'"];
  if (collab) {
    connect.push(collab);
    // also add the explicit ws(s) scheme origin so the WebSocket upgrade is allowed
    try {
      const u = new URL(opts.collabUrl as string);
      const wsScheme =
        u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol;
      connect.push(`${wsScheme}//${u.host}`);
    } catch {
      /* ignore */
    }
  }

  // Next 16 + React 19 stream hydration via INLINE <script> blocks (the RSC
  // payload pushes and the next-themes bootstrap). Under a bare `script-src
  // 'self'` (no 'unsafe-inline', no nonce) the browser blocks them and the app
  // never hydrates — a green build but a broken runtime. We allow them via a
  // per-request nonce (preferred — no 'unsafe-inline' gate) when one is provided.
  const scriptSrc = ["'self'"];
  if (opts.nonce) scriptSrc.push(`'nonce-${opts.nonce}'`);

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    // TipTap/ProseMirror and Tailwind set inline styles at runtime → allow
    // 'unsafe-inline' for styles only (not scripts). Documented tradeoff.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Signed file images are served same-origin from /api/files; data: covers
    // inlined icons. No remote image hosts.
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    // Allowlisted embed providers only (P5 embed node). Anything not on this exact
    // host set is refused at insert time (resolveEmbed) AND blocked by the CSP, so
    // arbitrary iframes can never load — matches the embed-allowlist threat model.
    'frame-src': ["'self'", ...EMBED_FRAME_HOSTS],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  if (opts.publicPath) {
    // Public read-only render: even tighter. No connect (no collab on /p/),
    // styles still inline for the rendered content. The public render is still a
    // Next/React page, so it carries the same inline bootstrap — keep the nonce.
    directives['connect-src'] = ["'self'"];
    directives['script-src'] = scriptSrc;
  }

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** The standard hardening headers (excluding CSP), as [name, value] pairs. */
export function securityHeaders(opts: { isProd?: boolean; publicPath?: boolean } = {}): Array<{
  key: string;
  value: string;
}> {
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
    // Public render keeps noindex (also set as a meta in the page; header is belt+braces).
    headers.push({ key: 'X-Robots-Tag', value: 'noindex' });
  }
  return headers;
}

/** Full header set for a given path class, including CSP. */
export function headersFor(opts: {
  collabUrl?: string;
  isProd?: boolean;
  publicPath?: boolean;
  nonce?: string;
}): Array<{
  key: string;
  value: string;
}> {
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
