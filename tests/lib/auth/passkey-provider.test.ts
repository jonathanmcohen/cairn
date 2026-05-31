/**
 * v0.9.6 G8 — the `passkey` Credentials provider authorize() path.
 *
 * Real Postgres (Testcontainers) so the user lookup + MFA gate run for real;
 * the WebAuthn verify itself is already covered by webauthn-login.test.ts, so
 * here we drive authorize() directly with a valid/invalid signed ticket.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { signLoginTicket } from '@/lib/auth/passkey-ticket';
import { startPostgres, stopPostgres } from '../../helpers/db';

const SECRET = 'k'.repeat(48);

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = SECRET;
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function getPasskeyAuthorize() {
  const { authConfig } = await import('@/lib/auth/config');
  const providers = authConfig.providers as Array<{
    id?: string;
    options?: { id?: string; authorize?: (creds: unknown) => Promise<unknown> };
    authorize?: (creds: unknown) => Promise<unknown>;
  }>;
  const provider = providers.find((p) => p.options?.id === 'passkey' || p.id === 'passkey');
  // next-auth wraps the top-level `authorize` with credential-shape processing
  // that drops our `ticket` field; the function we authored is preserved on
  // `options.authorize`. Prefer that so we exercise our own logic directly.
  const fn = provider?.options?.authorize ?? provider?.authorize;
  if (!fn) throw new Error('passkey provider not found');
  return fn.bind(provider);
}

describe('passkey Credentials provider', () => {
  it('authorizes a user from a valid ticket', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'p@e.com', passwordHash: 'h', name: 'P' })
      .returning({ id: schema.users.id });
    const authorize = await getPasskeyAuthorize();
    const ticket = signLoginTicket(u!.id, SECRET, 60_000);
    const result = (await authorize({ ticket })) as { id?: string } | null;
    expect(result?.id).toBe(u!.id);
  });

  it('rejects a forged ticket', async () => {
    const authorize = await getPasskeyAuthorize();
    const result = await authorize({ ticket: 'forged.0.deadbeef' });
    expect(result).toBeNull();
  });

  it('rejects a ticket for a non-existent user', async () => {
    const authorize = await getPasskeyAuthorize();
    const ticket = signLoginTicket('00000000-0000-0000-0000-000000000000', SECRET, 60_000);
    const result = await authorize({ ticket });
    expect(result).toBeNull();
  });
});
