/**
 * Pure security-header builders. No Next/runtime imports so they're unit-testable
 * and reusable from next.config.mjs headers() and the smoke. All values are
 * deliberately explicit (no wildcards) per spec §3.1.
 */

export type CspOptions = {
  /** Collab WebSocket origin (env COLLAB_URL); added to connect-src. */
  collabUrl?: string;
  /** true → emit the stricter public-page policy (no inline scripts, frame-ancestors none). */
  publicPath?: boolean;
  /** true → omit HSTS (dev). HSTS only makes sense over https in prod. */
  isProd?: boolean;
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

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Next 16 + React 19 inline runtime bootstrap needs 'self'; we avoid
    // 'unsafe-inline' for scripts. 'strict-dynamic' is intentionally omitted to
    // keep the policy simple for a self-hosted single-origin app.
    'script-src': ["'self'"],
    // TipTap/ProseMirror and Tailwind set inline styles at runtime → allow
    // 'unsafe-inline' for styles only (not scripts). Documented tradeoff.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Signed file images are served same-origin from /api/files; data: covers
    // inlined icons. No remote image hosts.
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  if (opts.publicPath) {
    // Public read-only render: even tighter. No connect (no collab on /p/),
    // styles still inline for the rendered content.
    directives['connect-src'] = ["'self'"];
    directives['script-src'] = ["'self'"];
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
      }),
    },
  ];
}
