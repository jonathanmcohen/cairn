import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts, audit_log, workspace_encryption_keys, user_keypairs RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setSession(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function makePage(workspaceId: string, userId: string, title: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      createdBy: userId,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      contentText: title,
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p.id;
}

describe('workspace-wide E2E enable end-to-end', () => {
  it('owner enables + sweeps three pages', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await getDb()
      .insert(schema.userKeypairs)
      .values({
        userId: owner.userId,
        publicKey: Buffer.alloc(32, 1),
        encryptedPrivateKey: Buffer.alloc(60, 2),
        kdfSalt: Buffer.alloc(16, 3),
        kdfIters: 32768,
      });

    const pageA = await makePage(owner.workspaceId, owner.userId, 'A');
    const pageB = await makePage(owner.workspaceId, owner.userId, 'B');
    const pageC = await makePage(owner.workspaceId, owner.userId, 'C');

    await setSession(owner.userId);

    // 1. Flip the workspace into workspace_wide mode.
    const { POST: enable } = await import('@/app/api/workspaces/[workspaceId]/e2e/enable/route');
    const enableRes = await enable(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wrapped: [
            { memberUserId: owner.userId, wrappedWsk: Buffer.alloc(92, 9).toString('base64') },
          ],
        }),
      }),
      { params: Promise.resolve({ workspaceId: owner.workspaceId }) },
    );
    expect(enableRes.status).toBe(200);

    // 2. Sweep each page through /encrypt-under-wsk.
    const { POST: encryptUnderWsk } = await import(
      '@/app/api/pages/[pageId]/encrypt-under-wsk/route'
    );
    for (const pid of [pageA, pageB, pageC]) {
      const r = await encryptUnderWsk(
        new Request('http://localhost/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contentEncrypted: Buffer.alloc(40, 0xaa).toString('base64'),
          }),
        }),
        { params: Promise.resolve({ pageId: pid }) },
      );
      expect(r.status).toBe(200);
    }

    // 3. Workspace mode persisted.
    const [ws] = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, owner.workspaceId));
    expect(ws?.e2eMode).toBe('workspace_wide');

    // 4. All pages encrypted, plaintext blanked.
    const pageRows = await getDb()
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, owner.workspaceId));
    expect(pageRows).toHaveLength(3);
    for (const p of pageRows) {
      expect(p.encrypted).toBe(true);
      expect(p.encryptedUnderWsk).toBe(true);
      expect(p.contentText).toBe('');
      expect(p.contentEncrypted).not.toBeNull();
    }

    // 5. Audit trail covers the lifecycle.
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, owner.workspaceId));
    const actions = audits.map((a) => a.action);
    expect(actions.filter((a) => a === 'e2e.workspace.encrypted')).toHaveLength(1);
    expect(actions.filter((a) => a === 'e2e.page.encrypted')).toHaveLength(3);
  });
});
