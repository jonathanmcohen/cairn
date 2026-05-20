import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { verifyPassword } from './password';

// Our users table is a variant of the adapter's default shape (no emailVerified/image,
// added passwordHash/avatarUrl). The adapter works at runtime; we widen the types here.
// biome-ignore lint/suspicious/noExplicitAny: bridging Drizzle adapter's strict default schema
type AdapterTableMap = any;

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users as AdapterTableMap,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: 'database', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(raw) {
        const parsed = CredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
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
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
