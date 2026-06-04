import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resolveEffectivePermission, setPageAcl, transferPageOwnership } from '@/lib/pages/acl';
import { listPageAcls } from '@/lib/pages/acl-list';
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
  await sql`TRUNCATE page_acls, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function addMember(
  workspaceId: string,
  email: string,
  role: schema.MemberRole,
): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!u) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return u.id;
}

async function makePage(workspaceId: string, ownerId: string): Promise<string> {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, createdBy: ownerId, title: 'p', content: {} })
    .returning();
  if (!page) throw new Error('page insert failed');
  return page.id;
}

describe('stored owner ACL tier', () => {
  it('resolves a stored owner ACL above the editor role', async () => {
    const wsOwner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const editorA = await addMember(wsOwner.workspaceId, 'a@x.io', 'editor');
    const pageId = await makePage(wsOwner.workspaceId, wsOwner.userId);

    await setPageAcl(db, {
      workspaceId: wsOwner.workspaceId,
      pageId,
      userId: editorA,
      permission: 'owner',
      actorUserId: wsOwner.userId,
    });
    expect(await resolveEffectivePermission(db, { userId: editorA, pageId })).toBe('owner');
  });
});

describe('transferPageOwnership', () => {
  it('transfers page ownership and demotes the prior owner', async () => {
    const wsOwner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const editorA = await addMember(wsOwner.workspaceId, 'a@x.io', 'editor');
    const editorB = await addMember(wsOwner.workspaceId, 'b@x.io', 'editor');
    const pageId = await makePage(wsOwner.workspaceId, wsOwner.userId);

    await setPageAcl(db, {
      workspaceId: wsOwner.workspaceId,
      pageId,
      userId: editorA,
      permission: 'owner',
      actorUserId: wsOwner.userId,
    });
    await transferPageOwnership(db, {
      workspaceId: wsOwner.workspaceId,
      pageId,
      fromUserId: editorA,
      toUserId: editorB,
      actorUserId: editorA,
    });

    expect(await resolveEffectivePermission(db, { userId: editorB, pageId })).toBe('owner');
    const acls = await listPageAcls(db, pageId);
    expect(acls.find((a) => a.userId === editorA)?.permission).toBe('edit');
    expect(acls.find((a) => a.userId === editorB)?.permission).toBe('owner');

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetType, 'page_acl'))
      .orderBy(schema.auditLog.createdAt);
    const transfer = audits.find((a) => a.action === 'page.ownership_transferred');
    expect(transfer).toBeTruthy();
    expect(transfer?.metadata).toMatchObject({ fromUserId: editorA, toUserId: editorB });
  });
});
