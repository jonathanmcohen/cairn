import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey, revokeKey } from '@/lib/api/keys';
import { archiveDatabase } from '@/lib/databases/delete';
import { softDeletePage } from '@/lib/pages/delete';
import { publishPage, unpublishPage } from '@/lib/pages/publish';
import { setShareSettings } from '@/lib/pages/share';
import { restoreVersion, snapshotIfChanged } from '@/lib/pages/versions';
import { saveDatabaseAsTemplate, savePageAsTemplate } from '@/lib/templates/save';
import { createWebhook, deleteWebhook } from '@/lib/webhooks/admin';
import { removeMember, setMemberRole } from '@/lib/workspaces/admin-members';
import { createInvite, revokeInvite } from '@/lib/workspaces/invites';
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
  await sql`TRUNCATE audit_log, api_keys, webhooks, templates, page_versions, invite_tokens, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function setup() {
  return createTestWorkspaceWithUser(db);
}

async function makePage(workspaceId: string, userId: string, title = 'P') {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page seed');
  return p;
}

async function rowsFor(workspaceId: string, action: string) {
  return db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.workspaceId, workspaceId), eq(schema.auditLog.action, action)));
}

describe('audit wiring (P18 T2): sensitive helpers write exactly one audit row each', () => {
  it('publishPage → page.published', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    await publishPage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'page.published');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('page');
    expect(rows[0]?.targetId).toBe(p.id);
    expect(rows[0]?.actorUserId).toBe(u.userId);
  });

  it('unpublishPage → page.unpublished', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    await publishPage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await unpublishPage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'page.unpublished');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('page');
    expect(rows[0]?.targetId).toBe(p.id);
  });

  it('setShareSettings → page.share_changed with safe metadata (no password)', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    const SECRET = 'super-secret-share-pw-9bf3c2';
    await setShareSettings(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      password: SECRET,
      expiresAt: new Date('2099-01-01'),
      allowDuplication: true,
    });
    const rows = await rowsFor(u.workspaceId, 'page.share_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('page');
    expect(rows[0]?.targetId).toBe(p.id);
    const meta = rows[0]?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ password: true, allowDuplication: true });
    // never leak the password itself
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(SECRET);
  });

  it('mintKey → api_key.created with safe metadata (no token/hash)', async () => {
    const u = await setup();
    const { token, key } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'CI',
      role: 'editor',
      createdBy: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'api_key.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('api_key');
    expect(rows[0]?.targetId).toBe(key.id);
    const meta = rows[0]?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ name: 'CI', role: 'editor' });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(token);
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(key.tokenHash);
  });

  it('revokeKey → api_key.revoked', async () => {
    const u = await setup();
    const { key } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'CI',
      role: 'editor',
      createdBy: u.userId,
    });
    await revokeKey(db, {
      workspaceId: u.workspaceId,
      keyId: key.id,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'api_key.revoked');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('api_key');
    expect(rows[0]?.targetId).toBe(key.id);
  });

  it('createWebhook / deleteWebhook → webhook.created / webhook.deleted with safe metadata (no secret)', async () => {
    const u = await setup();
    const { webhook, secret } = await createWebhook(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      url: 'https://example.com/hook',
      events: ['page.created', 'page.updated'],
    });
    const created = await rowsFor(u.workspaceId, 'webhook.created');
    expect(created).toHaveLength(1);
    expect(created[0]?.targetType).toBe('webhook');
    expect(created[0]?.targetId).toBe(webhook.id);
    const cm = created[0]?.metadata as Record<string, unknown>;
    expect(cm).toMatchObject({ url: 'https://example.com/hook' });
    expect(cm.events).toEqual(['page.created', 'page.updated']);
    expect(JSON.stringify(created[0]?.metadata)).not.toContain(secret);

    await deleteWebhook(db, {
      workspaceId: u.workspaceId,
      webhookId: webhook.id,
      actorUserId: u.userId,
    });
    const deleted = await rowsFor(u.workspaceId, 'webhook.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.targetType).toBe('webhook');
    expect(deleted[0]?.targetId).toBe(webhook.id);
  });

  it('softDeletePage → page.deleted', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'page.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('page');
    expect(rows[0]?.targetId).toBe(p.id);
  });

  it('archiveDatabase → database.deleted', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: p.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('db');
    await archiveDatabase(db, {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'database.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('database');
    expect(rows[0]?.targetId).toBe(d.id);
  });

  it('setMemberRole → member.role_changed with before/after metadata', async () => {
    const u = await setup();
    const ed = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: u.workspaceId, userId: ed.userId, role: 'editor' });

    await setMemberRole(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      targetUserId: ed.userId,
      role: 'admin',
    });
    const rows = await rowsFor(u.workspaceId, 'member.role_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('member');
    expect(rows[0]?.targetId).toBe(ed.userId);
    expect(rows[0]?.metadata).toMatchObject({
      before: { role: 'editor' },
      after: { role: 'admin' },
    });
  });

  it('removeMember → member.removed with role-of-target metadata', async () => {
    const u = await setup();
    const ed = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: u.workspaceId, userId: ed.userId, role: 'editor' });
    await removeMember(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      targetUserId: ed.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'member.removed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('member');
    expect(rows[0]?.targetId).toBe(ed.userId);
    expect(rows[0]?.metadata).toMatchObject({ role: 'editor' });
  });

  it('createInvite → invite.created with email+role (no token)', async () => {
    const u = await setup();
    const { invite, token } = await createInvite(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      email: 'pending@example.com',
      role: 'editor',
      expiresInDays: 7,
    });
    const rows = await rowsFor(u.workspaceId, 'invite.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('invite');
    expect(rows[0]?.targetId).toBe(invite.id);
    expect(rows[0]?.metadata).toMatchObject({ email: 'pending@example.com', role: 'editor' });
    // never leak the raw token
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(token);
  });

  it('revokeInvite → invite.revoked (no token in metadata)', async () => {
    const u = await setup();
    const { invite, token } = await createInvite(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      email: 'pending@example.com',
      role: 'editor',
      expiresInDays: 7,
    });
    await revokeInvite(db, {
      workspaceId: u.workspaceId,
      inviteId: invite.id,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'invite.revoked');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('invite');
    expect(rows[0]?.targetId).toBe(invite.id);
    expect(rows[0]?.metadata).toMatchObject({ email: 'pending@example.com', role: 'editor' });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(token);
  });

  it('savePageAsTemplate → template.created (kind: page)', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId, 'Root');
    const tpl = await savePageAsTemplate(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      rootPageId: p.id,
      name: 'My Template',
    });
    const rows = await rowsFor(u.workspaceId, 'template.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('template');
    expect(rows[0]?.targetId).toBe(tpl.id);
    expect(rows[0]?.metadata).toMatchObject({ name: 'My Template', kind: 'page' });
  });

  it('saveDatabaseAsTemplate → template.created (kind: database)', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId, 'DB page');
    const [d] = await db
      .insert(schema.databases)
      .values({ workspaceId: u.workspaceId, pageId: p.id, createdBy: u.userId })
      .returning();
    if (!d) throw new Error('db');
    const tpl = await saveDatabaseAsTemplate(db, {
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      databaseId: d.id,
      name: 'DB Template',
    });
    const rows = await rowsFor(u.workspaceId, 'template.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(tpl.id);
    expect(rows[0]?.metadata).toMatchObject({ name: 'DB Template', kind: 'database' });
  });

  it('restoreVersion → page.version_restored with the source versionId', async () => {
    const u = await setup();
    const p = await makePage(u.workspaceId, u.userId);
    const v1 = await snapshotIfChanged(db, {
      pageId: p.id,
      content: { type: 'doc', content: [{ type: 'paragraph', text: 'first' }] },
      authorId: u.userId,
    });
    if (!v1) throw new Error('seed v1');
    await restoreVersion(db, {
      versionId: v1.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const rows = await rowsFor(u.workspaceId, 'page.version_restored');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('page');
    expect(rows[0]?.targetId).toBe(p.id);
    expect(rows[0]?.metadata).toMatchObject({ versionId: v1.id });
  });
});
