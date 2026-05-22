/** @type {import('next').NextConfig} */
import { securityHeaders } from './src/lib/security/headers.ts';

const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
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

export default nextConfig;
