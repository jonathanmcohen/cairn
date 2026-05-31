import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
    // v0.9.6 G8b (#70) — per-login session id; gate + sessions UI use it to
    // mark the current device and to reject revoked sessions.
    sid?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    sid?: string;
  }
}
