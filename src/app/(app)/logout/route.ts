import { signOut } from '@/lib/auth/config';

/**
 * A1 (#80) — muscle-memory `/logout`. A bare GET that clears the Auth.js v5
 * session and redirects to `/login`. `signOut({ redirectTo })` throws a Next
 * redirect internally, so this handler never returns a Response on the happy
 * path — the redirect is the result.
 */
export async function GET() {
  await signOut({ redirectTo: '/login' });
}
