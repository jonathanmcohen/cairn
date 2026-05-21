import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { AcceptInviteError, acceptInvite } from '@/lib/workspaces/accept-invite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, invite_tokens RESTART IDENTITY CASCADE`;
});

async function makeUser(email: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ email: email.toLowerCase(), passwordHash: 'h', name: 'U' })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}

async function makeInvite(
  workspaceId: string,
  email: string,
  role: schema.MemberRole = 'editor',
  expiresInMs = 86_400_000,
) {
  const [t] = await db
    .insert(schema.inviteTokens)
    .values({
      workspaceId,
      email: email.toLowerCase(),
      role,
      token: `tok_${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + expiresInMs),
    })
    .returning();
  if (!t) throw new Error('invite insert failed');
  return t;
}

describe('acceptInvite', () => {
  it('matching email → joins, consumes token, returns the workspace id', async () => {
    const host = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const userId = await makeUser('newcomer@x.com');
    const invite = await makeInvite(host.workspaceId, 'newcomer@x.com', 'editor');

    const result = await acceptInvite(db, {
      token: invite.token,
      userId,
      userEmail: 'newcomer@x.com',
    });
    expect(result.workspaceId).toBe(host.workspaceId);

    const [member] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, host.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      );
    expect(member?.role).toBe('editor');

    const [used] = await db
      .select()
      .from(schema.inviteTokens)
      .where(eq(schema.inviteTokens.id, invite.id));
    expect(used?.usedAt).not.toBeNull();
  });

  it('email mismatch → EMAIL_MISMATCH, no membership', async () => {
    const host = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const userId = await makeUser('me@x.com');
    const invite = await makeInvite(host.workspaceId, 'someone-else@x.com');
    await expect(
      acceptInvite(db, { token: invite.token, userId, userEmail: 'me@x.com' }),
    ).rejects.toMatchObject({ code: 'EMAIL_MISMATCH' });
    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, userId));
    expect(members).toHaveLength(0);
  });

  it('already-used → USED', async () => {
    const host = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const userId = await makeUser('used@x.com');
    const invite = await makeInvite(host.workspaceId, 'used@x.com');
    await db
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, invite.id));
    await expect(
      acceptInvite(db, { token: invite.token, userId, userEmail: 'used@x.com' }),
    ).rejects.toMatchObject({ code: 'USED' });
  });

  it('expired → EXPIRED', async () => {
    const host = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const userId = await makeUser('late@x.com');
    const invite = await makeInvite(host.workspaceId, 'late@x.com', 'editor', -60_000);
    await expect(
      acceptInvite(db, { token: invite.token, userId, userEmail: 'late@x.com' }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });

  it('unknown token → NOT_FOUND', async () => {
    const userId = await makeUser('x@x.com');
    await expect(
      acceptInvite(db, { token: 'nope', userId, userEmail: 'x@x.com' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('idempotent on membership: accepting twice does not duplicate (second is USED)', async () => {
    const host = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const userId = await makeUser('twice@x.com');
    const invite = await makeInvite(host.workspaceId, 'twice@x.com');
    await acceptInvite(db, { token: invite.token, userId, userEmail: 'twice@x.com' });
    await expect(
      acceptInvite(db, { token: invite.token, userId, userEmail: 'twice@x.com' }),
    ).rejects.toMatchObject({ code: 'USED' });
    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, userId));
    expect(members).toHaveLength(1);
  });
});
