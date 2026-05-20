import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { signup } from '@/lib/auth/signup';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let uri = '';

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE workspaces, users, workspace_members, invite_tokens RESTART IDENTITY CASCADE`;
});

describe('signup', () => {
  it('first signup creates workspace and assigns owner role', async () => {
    const result = await signup(db, {
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First User',
      workspaceName: 'Acme Notes',
    });
    expect(result.role).toBe('owner');
    expect(result.workspaceId).toBeDefined();

    const [ws] = await db.select().from(schema.workspaces);
    expect(ws?.name).toBe('Acme Notes');
    expect(ws?.slug).toBe('acme-notes');
  });

  it('second signup without invite token fails', async () => {
    await signup(db, {
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });
    await expect(
      signup(db, {
        email: 'second@example.com',
        password: 'correct horse battery',
        name: 'Second',
      }),
    ).rejects.toThrow(/invite/i);
  });

  it('second signup with valid invite token succeeds with the token role', async () => {
    const first = await signup(db, {
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });

    const [token] = await db
      .insert(schema.inviteTokens)
      .values({
        workspaceId: first.workspaceId,
        email: 'second@example.com',
        role: 'editor',
        token: 'tok_abc',
        expiresAt: new Date(Date.now() + 86400_000),
      })
      .returning();
    if (!token) throw new Error('failed to insert invite token');

    const second = await signup(db, {
      email: 'second@example.com',
      password: 'correct horse battery',
      name: 'Second',
      inviteToken: 'tok_abc',
    });
    expect(second.role).toBe('editor');
    expect(second.workspaceId).toBe(first.workspaceId);

    const [used] = await db
      .select()
      .from(schema.inviteTokens)
      .where(eq(schema.inviteTokens.id, token.id));
    expect(used?.usedAt).not.toBeNull();
  });

  it('rejects expired invite tokens', async () => {
    const first = await signup(db, {
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });
    await db.insert(schema.inviteTokens).values({
      workspaceId: first.workspaceId,
      email: 'late@example.com',
      role: 'editor',
      token: 'tok_expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      signup(db, {
        email: 'late@example.com',
        password: 'correct horse battery',
        name: 'Late',
        inviteToken: 'tok_expired',
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('rejects invite token email mismatch', async () => {
    const first = await signup(db, {
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });
    await db.insert(schema.inviteTokens).values({
      workspaceId: first.workspaceId,
      email: 'intended@example.com',
      role: 'editor',
      token: 'tok_mismatch',
      expiresAt: new Date(Date.now() + 86400_000),
    });
    await expect(
      signup(db, {
        email: 'attacker@example.com',
        password: 'correct horse battery',
        name: 'Attacker',
        inviteToken: 'tok_mismatch',
      }),
    ).rejects.toThrow(/email/i);
  });
});
