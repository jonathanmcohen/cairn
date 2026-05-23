import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resolveEffectivePermission } from '@/lib/pages/acl';
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
  await sql`TRUNCATE page_acls, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

/** Insert a page chain: root -> child -> grandchild, return their ids. */
async function makePageChain(workspaceId: string, ownerId: string) {
  const [root] = await db
    .insert(schema.pages)
    .values({ workspaceId, createdBy: ownerId, title: 'root', content: {} })
    .returning();
  if (!root) throw new Error('root insert failed');
  const [child] = await db
    .insert(schema.pages)
    .values({ workspaceId, createdBy: ownerId, title: 'child', content: {}, parentId: root.id })
    .returning();
  if (!child) throw new Error('child insert failed');
  const [grand] = await db
    .insert(schema.pages)
    .values({ workspaceId, createdBy: ownerId, title: 'grand', content: {}, parentId: child.id })
    .returning();
  if (!grand) throw new Error('grand insert failed');
  return { rootId: root.id, childId: child.id, grandId: grand.id };
}

async function addMember(
  workspaceId: string,
  email: string,
  role: schema.MemberRole,
): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: role })
    .returning();
  if (!u) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return u.id;
}

describe('resolveEffectivePermission - ACL on the page wins', () => {
  it('returns the explicit ACL when one is set on the page itself', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const editor = await addMember(owner.workspaceId, 'e@x.com', 'editor');
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await db
      .insert(schema.pageAcls)
      .values({ pageId: grandId, userId: editor, permission: 'view' });

    const perm = await resolveEffectivePermission(db, { userId: editor, pageId: grandId });
    expect(perm).toBe('view');
  });
});

describe('resolveEffectivePermission - inheritance', () => {
  it('inherits an ACL from the nearest ancestor when the page itself has none', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const editor = await addMember(owner.workspaceId, 'e@x.com', 'editor');
    const { rootId, grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await db
      .insert(schema.pageAcls)
      .values({ pageId: rootId, userId: editor, permission: 'comment' });

    const perm = await resolveEffectivePermission(db, { userId: editor, pageId: grandId });
    expect(perm).toBe('comment');
  });

  it('an explicit child ACL OVERRIDES the parent ACL (deepest wins)', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const editor = await addMember(owner.workspaceId, 'e@x.com', 'editor');
    const { rootId, childId, grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await db.insert(schema.pageAcls).values({ pageId: rootId, userId: editor, permission: 'edit' });
    await db
      .insert(schema.pageAcls)
      .values({ pageId: childId, userId: editor, permission: 'view' });

    // grand inherits from child (the nearest ancestor with an ACL), not root.
    expect(await resolveEffectivePermission(db, { userId: editor, pageId: grandId })).toBe('view');
    expect(await resolveEffectivePermission(db, { userId: editor, pageId: childId })).toBe('view');
    expect(await resolveEffectivePermission(db, { userId: editor, pageId: rootId })).toBe('edit');
  });
});

describe('resolveEffectivePermission - role fallback', () => {
  it('falls back to workspace role when no ACL exists anywhere in the chain', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const viewer = await addMember(owner.workspaceId, 'v@x.com', 'viewer');
    const editor = await addMember(owner.workspaceId, 'e@x.com', 'editor');
    const admin = await addMember(owner.workspaceId, 'a@x.com', 'admin');
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);

    expect(await resolveEffectivePermission(db, { userId: viewer, pageId: grandId })).toBe('view');
    expect(await resolveEffectivePermission(db, { userId: editor, pageId: grandId })).toBe('edit');
    expect(await resolveEffectivePermission(db, { userId: admin, pageId: grandId })).toBe('edit');
  });

  it('returns null when the user has no membership in the workspace and no ACL', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const stranger = await addMember(owner.workspaceId, 's@x.com', 'editor');
    // Now remove the stranger's membership so they're a true outsider.
    await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, stranger));

    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    expect(await resolveEffectivePermission(db, { userId: stranger, pageId: grandId })).toBeNull();
  });
});

describe('resolveEffectivePermission - owner bypass', () => {
  it('returns "owner" for the owner role even when an explicit "view" ACL is set on the page', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    // Pathological: owner has an explicit view ACL on the page. Owner still bypasses it.
    await db
      .insert(schema.pageAcls)
      .values({ pageId: grandId, userId: owner.userId, permission: 'view' });

    expect(await resolveEffectivePermission(db, { userId: owner.userId, pageId: grandId })).toBe(
      'owner',
    );
  });
});

describe('resolveEffectivePermission - UUID hygiene', () => {
  it('returns null for a non-UUID pageId (no DB error surfaces)', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    expect(
      await resolveEffectivePermission(db, { userId: owner.userId, pageId: 'not-a-uuid' }),
    ).toBeNull();
  });

  it('returns null for an unknown UUID pageId', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const fakeId = '00000000-0000-0000-0000-000000000000';
    expect(
      await resolveEffectivePermission(db, { userId: owner.userId, pageId: fakeId }),
    ).toBeNull();
  });
});
