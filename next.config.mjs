/** @type {import('next').NextConfig} */
import { headersFor } from './src/lib/security/headers.ts';

const isProd = process.env.NODE_ENV === 'production';
const collabUrl = process.env.COLLAB_URL;

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async headers() {
    return [
      {
        // Public read-only render: stricter policy + noindex.
        source: '/p/:path*',
        headers: headersFor({ collabUrl, isProd, publicPath: true }),
      },
      {
        // Everything else (app shell, editor, API).
        source: '/:path*',
        headers: headersFor({ collabUrl, isProd, publicPath: false }),
      },
    ];
  },
};

export default nextConfig;
