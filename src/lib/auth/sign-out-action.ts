'use server';

import { signOut } from '@/lib/auth/config';

/**
 * A1 (#80) — Server Action sign-out. The sidebar/security forms previously
 * posted CSRF-less to `/api/auth/signout`, which Auth.js v5 rejects (the route
 * handler only accepts the framework's own CSRF-token POST), so sign-out was
 * silently broken across ~16 releases. A Server Action invokes the exported
 * `signOut()` (config.ts) directly on the server — no client CSRF token to
 * forge — and clears the jwt session cookie, then redirects to `/login`.
 *
 * `signOut({ redirectTo })` throws a Next redirect internally; do NOT wrap it
 * in try/catch that swallows the redirect.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
