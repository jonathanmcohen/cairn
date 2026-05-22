import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { ipKey, loginLimiter } from '@/lib/security/rate-limit';
import { applyOAuthGate } from './oauth-gate';
import { verifyPassword } from './password';

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

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
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ];

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
      if (!account || account.provider === 'credentials') return true;
      if (!user.email || !user.id) return false;
      return applyOAuthGate(getDb(), { email: user.email, userId: user.id });
    },
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
