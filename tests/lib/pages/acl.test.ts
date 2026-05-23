import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAcl, resolveEffectivePermission } from '@/lib/pages/acl';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// requirePageAcl reads the active user via Auth.js (mocked here) and the live
// db through getDb(); set DATABASE_URL so getDb() targets the testcontainer.
vi.mock('@/lib/auth/config', () => {
  let session: { userId: string } | null = null;
  return {
    auth: async () => (session ? { user: { id: session.userId } } : null),
    __set: (s: { userId: string } | null) => {
      session = s;
    },
  };
});

async function actAs(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (s: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
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

describe('requirePageAcl - gate behavior', () => {
  it('returns {page, ctx, effectivePermission} when the user passes the min-perm gate', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await actAs(owner.userId);
    const result = await requirePageAcl(grandId, 'view');
    expect(result.page.id).toBe(grandId);
    expect(result.ctx.workspaceId).toBe(owner.workspaceId);
    expect(result.effectivePermission).toBe('owner');
  });

  it('throws HttpError(404) for a non-UUID pageId', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    await actAs(owner.userId);
    let caught: unknown = null;
    try {
      await requirePageAcl('not-a-uuid', 'view');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
  });

  it('throws HttpError(404) for a page in another workspace (no existence leak)', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'owner', email: 'a@x.com' });
    const b = await createTestWorkspaceWithUser(db, { role: 'owner', email: 'b@x.com' });
    const { grandId } = await makePageChain(a.workspaceId, a.userId);
    // ensure b is treated as a different workspace member
    expect(b.workspaceId).not.toBe(a.workspaceId);
    await actAs(b.userId);
    let caught: unknown = null;
    try {
      await requirePageAcl(grandId, 'view');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
  });

  it('throws HttpError(403) when effective permission is below min-permission', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const viewer = await addMember(owner.workspaceId, 'v@x.com', 'viewer');
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await actAs(viewer);
    let caught: unknown = null;
    try {
      await requirePageAcl(grandId, 'edit'); // viewer has 'view', not 'edit'
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(403);
  });

  it('treats "owner" effective permission as satisfying any min-permission (incl. edit)', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const { grandId } = await makePageChain(owner.workspaceId, owner.userId);
    await actAs(owner.userId);
    await expect(requirePageAcl(grandId, 'edit')).resolves.toBeDefined();
    await expect(requirePageAcl(grandId, 'comment')).resolves.toBeDefined();
  });
});
