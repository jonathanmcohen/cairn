import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { applyOAuthGate, evaluateOAuthGate } from '@/lib/auth/oauth-gate';
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

describe('evaluateOAuthGate', () => {
  it('allows a user who already has a membership', async () => {
    const u = await createTestWorkspaceWithUser(db, { email: 'member@x.com' });
    const decision = await evaluateOAuthGate(db, 'member@x.com');
    expect(decision).toMatchObject({ kind: 'allow', userId: u.userId });
  });

  it('returns invite when no membership but a valid invite exists', async () => {
    const host = await createTestWorkspaceWithUser(db);
    const invite = await makeInvite(host.workspaceId, 'newcomer@x.com');
    const decision = await evaluateOAuthGate(db, 'newcomer@x.com');
    expect(decision).toMatchObject({ kind: 'invite', inviteId: invite.id });
  });

  it('rejects when no membership and no invite', async () => {
    const decision = await evaluateOAuthGate(db, 'stranger@x.com');
    expect(decision.kind).toBe('reject');
  });

  it('rejects an expired invite', async () => {
    const host = await createTestWorkspaceWithUser(db);
    await makeInvite(host.workspaceId, 'late@x.com', 'editor', -60_000);
    const decision = await evaluateOAuthGate(db, 'late@x.com');
    expect(decision.kind).toBe('reject');
  });

  it('ignores already-used invites', async () => {
    const host = await createTestWorkspaceWithUser(db);
    const inv = await makeInvite(host.workspaceId, 'used@x.com');
    await db
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, inv.id));
    const decision = await evaluateOAuthGate(db, 'used@x.com');
    expect(decision.kind).toBe('reject');
  });

  it('is case-insensitive on email', async () => {
    await createTestWorkspaceWithUser(db, { email: 'mixed@x.com' });
    const decision = await evaluateOAuthGate(db, 'MIXED@x.com');
    expect(decision.kind).toBe('allow');
  });
});

describe('applyOAuthGate', () => {
  it('allows an existing member without side effects', async () => {
    const u = await createTestWorkspaceWithUser(db, { email: 'm@x.com' });
    const ok = await applyOAuthGate(db, { email: 'm@x.com', userId: u.userId });
    expect(ok).toBe(true);
  });

  it('consumes the invite and adds membership for an invited user', async () => {
    const host = await createTestWorkspaceWithUser(db);
    const invite = await makeInvite(host.workspaceId, 'join@x.com', 'editor');
    const [newUser] = await db
      .insert(schema.users)
      .values({ email: 'join@x.com', passwordHash: 'oauth', name: 'Join' })
      .returning();
    if (!newUser) throw new Error('user insert failed');

    const ok = await applyOAuthGate(db, { email: 'join@x.com', userId: newUser.id });
    expect(ok).toBe(true);

    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, newUser.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.workspaceId).toBe(host.workspaceId);
    expect(members[0]?.role).toBe('editor');

    const [usedInvite] = await db
      .select()
      .from(schema.inviteTokens)
      .where(eq(schema.inviteTokens.id, invite.id));
    expect(usedInvite?.usedAt).not.toBeNull();
  });

  it('denies a stranger', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'stranger@x.com', passwordHash: 'oauth', name: 'S' })
      .returning();
    if (!u) throw new Error('user insert failed');
    const ok = await applyOAuthGate(db, { email: 'stranger@x.com', userId: u.id });
    expect(ok).toBe(false);
  });
});
