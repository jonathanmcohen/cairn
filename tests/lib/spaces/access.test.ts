import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { requireSpaceAccess } from '@/lib/spaces/access';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE space_members, spaces, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed(args: { wsRole: schema.MemberRole; spaceRole?: schema.SpaceRole }) {
  const db = getDb();
  const ts = Date.now();
  const [user] = await db
    .insert(schema.users)
    .values({ email: `u${ts}-${Math.random()}@x.test`, passwordHash: 'h', name: 'u' })
    .returning();
  if (!user) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w${ts}-${Math.random()}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values({
    workspaceId: ws.id,
    userId: user.id,
    role: args.wsRole,
  });
  const [space] = await db
    .insert(schema.spaces)
    .values({ workspaceId: ws.id, name: 'Engineering', slug: 'engineering' })
    .returning();
  if (!space) throw new Error('space');
  if (args.spaceRole) {
    await db.insert(schema.spaceMembers).values({
      spaceId: space.id,
      userId: user.id,
      role: args.spaceRole,
    });
  }
  return { db, user, ws, space };
}

describe('requireSpaceAccess', () => {
  it('workspace admin sees space without explicit membership', async () => {
    const { user, space } = await seed({ wsRole: 'admin' });
    const r = await requireSpaceAccess(getDb(), {
      spaceId: space.id,
      userId: user.id,
      minRole: 'editor',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('admin');
  });

  it('workspace viewer + space editor is granted editor', async () => {
    const { user, space } = await seed({ wsRole: 'viewer', spaceRole: 'editor' });
    const r = await requireSpaceAccess(getDb(), {
      spaceId: space.id,
      userId: user.id,
      minRole: 'editor',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('editor');
  });

  it('workspace viewer + no space role → forbidden when minRole=editor', async () => {
    const { user, space } = await seed({ wsRole: 'viewer' });
    const r = await requireSpaceAccess(getDb(), {
      spaceId: space.id,
      userId: user.id,
      minRole: 'editor',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
  });

  it('cross-workspace space → not_found', async () => {
    const db = getDb();
    const [u1] = await db
      .insert(schema.users)
      .values({ email: 'a-cross@x.test', passwordHash: 'h', name: 'A' })
      .returning();
    const [u2] = await db
      .insert(schema.users)
      .values({ email: 'b-cross@x.test', passwordHash: 'h', name: 'B' })
      .returning();
    if (!u1 || !u2) throw new Error('user');
    const [ws1] = await db
      .insert(schema.workspaces)
      .values({ name: 'w1', slug: 'w1-cross' })
      .returning();
    const [ws2] = await db
      .insert(schema.workspaces)
      .values({ name: 'w2', slug: 'w2-cross' })
      .returning();
    if (!ws1 || !ws2) throw new Error('ws');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: ws1.id,
      userId: u1.id,
      role: 'owner',
    });
    await db.insert(schema.workspaceMembers).values({
      workspaceId: ws2.id,
      userId: u2.id,
      role: 'owner',
    });
    const [other] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws2.id, name: 's', slug: 's' })
      .returning();
    if (!other) throw new Error('space');
    const r = await requireSpaceAccess(getDb(), {
      spaceId: other.id,
      userId: u1.id,
      minRole: 'viewer',
      workspaceId: ws1.id,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('most-permissive wins (admin in ws beats viewer in space)', async () => {
    const { user, space } = await seed({ wsRole: 'admin', spaceRole: 'viewer' });
    const r = await requireSpaceAccess(getDb(), {
      spaceId: space.id,
      userId: user.id,
      minRole: 'editor',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('admin');
  });

  it('missing space → not_found', async () => {
    const { user } = await seed({ wsRole: 'admin' });
    const r = await requireSpaceAccess(getDb(), {
      spaceId: '00000000-0000-0000-0000-000000000000',
      userId: user.id,
      minRole: 'viewer',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});
