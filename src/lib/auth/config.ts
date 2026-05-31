import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { ipKey, loginLimiter } from '@/lib/security/rate-limit';
import { checkMfaEnrollmentForSignIn } from './mfa-policy';
import { applyOAuthGate } from './oauth-gate';
import { verifyLoginTicket } from './passkey-ticket';
import { verifyPassword } from './password';
import { createSession, touchSession } from './session-store';
import { isTwoFactorEnabled, verifySecondFactor } from './two-factor';

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

/**
 * v0.9.6 G8b (#70) — best-effort UA/IP for the session-store row. The jwt
 * callback runs inside the Auth.js route handler on sign-in, so `next/headers`
 * resolves the live request. Outside a request context (unit tests) it throws —
 * we swallow and return nulls.
 */
async function readSignInClient(): Promise<{ ua: string | null; ip: string | null }> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const ua = h.get('user-agent');
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
    return { ua, ip };
  } catch {
    return { ua: null, ip: null };
  }
}

function buildProviders(): NextAuthConfig['providers'] {
  const providers: NextAuthConfig['providers'] = [
    Credentials({
      name: 'credentials',
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(raw, req) {
        const parsed = CredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Brute-force throttle: 5/min per ip+email. Tripping returns null (Auth.js
        // surfaces a generic CredentialsSignin error — no account enumeration).
        const headers =
          req?.headers instanceof Headers ? req.headers : new Headers(req?.headers as HeadersInit);
        const rl = loginLimiter.check(
          ipKey(new Request('http://local', { headers }), parsed.data.email.toLowerCase()),
        );
        if (!rl.allowed) return null;
        const db = getDb();
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, parsed.data.email.toLowerCase()))
          .limit(1);
        if (!user) return null;
        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        // Second factor: if this user has TOTP enabled, a valid TOTP or recovery
        // code is required before we issue a session. A missing/blank code with
        // 2FA enabled fails closed (returns null → generic CredentialsSignin).
        const enabled = await isTwoFactorEnabled(db, user.id);
        if (enabled) {
          const code = parsed.data.totp?.trim();
          if (!code) return null;
          const passed = await verifySecondFactor(db, {
            userId: user.id,
            code,
            key: env().AUTH_SECRET,
          });
          if (!passed) return null;
        }
        // v0.9.0 G1 P8 — admin-enforce: block sign-in when at least one
        // member workspace's policy requires MFA and the user has no
        // enrolled method from the workspace's allow-list. Falls AFTER
        // TOTP verification so a user with TOTP enabled satisfies a
        // TOTP-permitting policy on the very same sign-in.
        const mfaCheck = await checkMfaEnrollmentForSignIn(db, { userId: user.id });
        if (!mfaCheck.ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ];

  providers.push(
    Credentials({
      id: 'passkey',
      name: 'passkey',
      // The browser completes the WebAuthn assertion via /api/webauthn/login-verify
      // and passes the returned signed ticket here. We re-verify the HMAC + expiry,
      // load the user, and run the same MFA-enrollment gate as the password path.
      // The cryptographic assertion already happened server-side, so there is no
      // password to check — a valid, unexpired ticket IS proof of possession.
      credentials: { ticket: { type: 'text' } },
      async authorize(raw) {
        const ticket =
          typeof (raw as { ticket?: unknown })?.ticket === 'string'
            ? (raw as { ticket: string }).ticket
            : null;
        if (!ticket) return null;
        const userId = verifyLoginTicket(ticket, env().AUTH_SECRET);
        if (!userId) return null;
        const db = getDb();
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        if (!user) return null;
        // Admin-enforce parity with the password path: a workspace policy may
        // require MFA from an allow-list. A passkey login satisfies a
        // WebAuthn-permitting policy by construction, but we still run the gate
        // so a TOTP-only policy can reject (fails closed).
        const mfaCheck = await checkMfaEnrollmentForSignIn(db, { userId: user.id });
        if (!mfaCheck.ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  return providers;
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: buildProviders(),
  callbacks: {
    async signIn({ user, account }) {
      // Both credentials providers (password + passkey) gate inside authorize();
      // the OAuth gate below applies only to external IdP sign-ins.
      if (!account || account.provider === 'credentials' || account.provider === 'passkey') {
        return true;
      }
      if (!user.email || !user.id) return false;
      return applyOAuthGate(getDb(), { email: user.email, userId: user.id });
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.id = user.id;
        // v0.9.6 G8b (#70) — mint a session-store row on sign-in and stamp its
        // sid into the token. This runs for BOTH credentials providers
        // (password + passkey) and OAuth, since every sign-in populates `user`.
        // UA/IP are read from the live request headers (the jwt callback runs
        // inside the Auth.js route handler on sign-in); best-effort — null when
        // no request context is available (e.g. unit tests).
        if (!token.sid) {
          const { ua, ip } = await readSignInClient();
          token.sid = await createSession(getDb(), { userId: user.id, userAgent: ua, ip });
        }
      } else if (typeof token.sid === 'string') {
        // Subsequent reads: keep last_seen_at fresh (no-op if already revoked).
        await touchSession(getDb(), token.sid);
      }
      // v0.9.0 G1 P8 — step-up assertion timestamp. Mirrored into the JWT so
      // requireStepUp can read it from the session object on subsequent
      // requests. /api/webauthn/assert sets the `cairn_stepup` cookie AND
      // calls session.update({ stepUpAt }) (client side) — either path
      // converges to the JWT carrying the claim.
      if (trigger === 'update') {
        const stepUpAt = (session as { stepUpAt?: number } | undefined)?.stepUpAt;
        if (typeof stepUpAt === 'number') {
          (token as Record<string, unknown>).stepUpAt = stepUpAt;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
      }
      // v0.9.6 G8b (#70) — surface the per-login sid so getAuthContext() can
      // reject revoked sessions and the sessions UI can flag the current device.
      if (typeof token.sid === 'string') {
        (session as { sid?: string }).sid = token.sid;
      }
      const stepUpAt = (token as Record<string, unknown>).stepUpAt;
      if (typeof stepUpAt === 'number') {
        (session as { stepUpAt?: number }).stepUpAt = stepUpAt;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
