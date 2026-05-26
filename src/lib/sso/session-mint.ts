import { cookies } from 'next/headers';
import { encode } from 'next-auth/jwt';

/**
 * Mint a session cookie equivalent to the one Auth.js writes after a
 * successful credentials sign-in. The JWT payload is the minimum shape the
 * existing Auth.js JWT-strategy session callback expects: `sub` is the
 * canonical id, `email`/`name` populate the session.user object.
 *
 * Cookie naming follows Auth.js convention:
 *   - dev (HTTP):  `next-auth.session-token`
 *   - prod (HTTPS): `__Secure-next-auth.session-token`
 *
 * Determined by the `NEXTAUTH_URL` protocol: anything starting with `https://`
 * gets the secure-prefix name. Matches `next-auth`'s internal default.
 */
export async function mintSessionCookieForUser(input: {
  userId: string;
  email: string;
  name: string;
}): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET missing');
  const url = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const isSecure = url.startsWith('https://');
  const cookieName = isSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token';

  const token = await encode({
    token: {
      sub: input.userId,
      id: input.userId,
      email: input.email,
      name: input.name,
    },
    secret,
    salt: cookieName,
    maxAge: 60 * 60 * 24 * 30, // 30 days, same as Auth.js default
  });

  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 30,
  });
}
