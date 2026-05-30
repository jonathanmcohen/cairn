import { headers } from 'next/headers';

const LOCALHOST = 'http://localhost:3000';

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** True for the build-default localhost origin (Dockerfile bakes this; compose overrides at runtime). */
function isLocalhostDefault(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

/**
 * The deployed instance's public origin (scheme + host [+ port]), with no trailing slash.
 *
 * Server-only (reads the incoming request via next/headers). Resolution order:
 *  1. PUBLIC_URL                — explicit operator-declared base (dev `.env`, or a
 *                                 future compose that DOES pass it into the container).
 *  2. forwarded request host    — X-Forwarded-Host || Host, with X-Forwarded-Proto
 *                                 (https inferred for a forwarded host). This is what
 *                                 fixes #50: bare compose never passes PUBLIC_URL to
 *                                 the container, so we read the host the user reached.
 *  3. NEXTAUTH_URL              — validated runtime canonical (compose sets it = PUBLIC_URL),
 *                                 used over the request host when it is a REAL external origin.
 *  4. http://localhost:3000     — last resort (dev, no proxy, no env).
 *
 * Note: NEXTAUTH_URL is preferred over the request host ONLY when it is a real external
 * origin; when it is the localhost build-default we fall through to the request host so a
 * reverse-proxied deploy that didn't override NEXTAUTH_URL still renders the real host.
 */
export async function publicOrigin(): Promise<string> {
  const explicit = process.env.PUBLIC_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  const nextAuth = process.env.NEXTAUTH_URL?.trim();
  if (nextAuth && !isLocalhostDefault(nextAuth)) return stripTrailingSlash(nextAuth);

  const hdrs = await headers();
  const forwardedHost = hdrs.get('x-forwarded-host');
  const host = forwardedHost ?? hdrs.get('host');
  if (host) {
    const proto = hdrs.get('x-forwarded-proto') ?? (forwardedHost ? 'https' : 'http');
    return stripTrailingSlash(`${proto}://${host}`);
  }

  if (nextAuth) return stripTrailingSlash(nextAuth);
  return LOCALHOST;
}
