/**
 * v0.9.0 G4 P24 — page approval lifecycle integration tests.
 *
 * Covers:
 *   - requestApproval flips status draft→review + writes
 *     `page.approval_requested` audit row.
 *   - decide(approved) writes a signed page_approvals row + advances status
 *     review→published + writes `page.approved` audit + the signature
 *     verifies under AUTH_SECRET.
 *   - decide(rejected) advances review→draft + writes `page.approval_rejected`
 *     audit.
 *   - decide(requested_changes) leaves status in review + writes
 *     `page.changes_requested` audit.
 *   - decide throws NoVersionSnapshotError when no version row exists yet.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { decide, NoVersionSnapshotError, requestApproval } from '@/lib/pages/approval';
import { verifyApprovalSignature } from '@/lib/pages/approval-signature';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const TEST_SECRET = 'x'.repeat(32);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE page_approvals, page_versions, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedPage(status: schema.PageStatus = 'draft'): Promise<{
  ownerId: string;
  adminId: string;
  workspaceId: string;
  pageId: string;
  versionId: string;
}> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [owner] = await db
    .insert(schema.users)
    .values({ email: `o-${stamp}@x`, name: 'Owner', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [admin] = await db
    .insert(schema.users)
    .values({ email: `a-${stamp}@x`, name: 'Admin', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `w-${stamp}` })
    .returning({ id: schema.workspaces.id });
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId: w!.id, title: 'P', status, createdBy: owner!.id })
    .returning({ id: schema.pages.id });
  const [v] = await db
    .insert(schema.pageVersions)
    .values({ pageId: p!.id, content: { type: 'doc', content: [] }, authorId: owner!.id })
    .returning({ id: schema.pageVersions.id });
  return {
    ownerId: owner!.id,
    adminId: admin!.id,
    workspaceId: w!.id,
    pageId: p!.id,
    versionId: v!.id,
  };
}

describe('requestApproval', () => {
  it('flips draft → review and emits page.approval_requested', async () => {
    const { ownerId, workspaceId, pageId } = await seedPage('draft');

    await requestApproval(db, { pageId, byUserId: ownerId, workspaceId });

    const [page] = await db
      .select({ status: schema.pages.status })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId));
    expect(page?.status).toBe('review');

    const audits = await db
      .select({ action: schema.auditLog.action, targetId: schema.auditLog.targetId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('page.status_changed');
    expect(actions).toContain('page.approval_requested');
    // Both audit rows pin to the same page.
    for (const a of audits) expect(a.targetId).toBe(pageId);
  });
});

describe('decide', () => {
  it('approved → published; row signed under AUTH_SECRET; audit emitted', async () => {
    const { adminId, workspaceId, pageId, versionId } = await seedPage('review');

    const result = await decide(db, {
      pageId,
      approverUserId: adminId,
      workspaceId,
      decision: 'approved',
      comment: 'looks good',
    });
    expect(result.signatureHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(result.versionSnapshotId).toBe(versionId);

    const [row] = await db
      .select()
      .from(schema.pageApprovals)
      .where(eq(schema.pageApprovals.pageId, pageId));
    expect(row).toBeDefined();
    expect(row!.decision).toBe('approved');
    expect(row!.comment).toBe('looks good');

    const ok = verifyApprovalSignature(
      {
        pageId,
        versionSnapshotId: row!.versionSnapshotId,
        approverUserId: adminId,
        decision: 'approved',
        approvedAtISO: row!.approvedAt.toISOString(),
      },
      row!.signatureHmac,
      TEST_SECRET,
    );
    expect(ok).toBe(true);

    const [page] = await db
      .select({ status: schema.pages.status })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId));
    expect(page?.status).toBe('published');

    const actions = (
      await db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, workspaceId))
    ).map((a) => a.action);
    expect(actions).toContain('page.approved');
    expect(actions).toContain('page.status_changed');
  });

  it('rejected → draft + page.approval_rejected audit', async () => {
    const { adminId, workspaceId, pageId } = await seedPage('review');

    await decide(db, {
      pageId,
      approverUserId: adminId,
      workspaceId,
      decision: 'rejected',
      comment: 'needs work',
    });

    const [page] = await db
      .select({ status: schema.pages.status })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId));
    expect(page?.status).toBe('draft');

    const actions = (
      await db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, workspaceId))
    ).map((a) => a.action);
    expect(actions).toContain('page.approval_rejected');
  });

  it('requested_changes leaves status in review + page.changes_requested audit', async () => {
    const { adminId, workspaceId, pageId } = await seedPage('review');

    await decide(db, {
      pageId,
      approverUserId: adminId,
      workspaceId,
      decision: 'requested_changes',
    });

    const [page] = await db
      .select({ status: schema.pages.status })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId));
    expect(page?.status).toBe('review');

    const actions = (
      await db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, workspaceId))
    ).map((a) => a.action);
    expect(actions).toContain('page.changes_requested');
  });

  it('refuses when no version snapshot exists yet', async () => {
    const { adminId, workspaceId, pageId } = await seedPage('review');
    await db.delete(schema.pageVersions).where(eq(schema.pageVersions.pageId, pageId));

    await expect(
      decide(db, { pageId, approverUserId: adminId, workspaceId, decision: 'approved' }),
    ).rejects.toBeInstanceOf(NoVersionSnapshotError);
  });
});
