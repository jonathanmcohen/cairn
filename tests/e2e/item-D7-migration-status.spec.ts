// v0.10.0 D7 — read-only migration status panel (/settings/admin/migrations +
// GET /api/admin/migrations).
//
// The route compares the bundled drizzle journal against the LIVE
// `drizzle.__drizzle_migrations` table — which, on the persistent e2e dev DB,
// is fully applied. The OK state is asserted as-is; the pending and drift
// states are produced by surgically mutating that table and restoring it in
// finally (capture exact hash + created_at before deleting; created_at is a
// bigint ms-epoch in drizzle's default table, so we write back exactly what we
// read). Every mutation is wrapped in try/finally — other specs boot against
// the same DB and a leftover mutation would crash the NEXT harness boot
// (assertNoPendingMigrations is a fail-loud boot guard).
//
// No retry button exists ON PURPOSE (v0.9.17 postmortem: in-process retry hits
// the duplicate-ALTER trap) — recovery is copy, which the panel asserts via
// the distinct pending (amber, data-state="pending") and drift (red,
// data-state="drift") blocks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type JournalEntry = { idx: number; tag: string; when: number };
type Journal = { entries: JournalEntry[] };

/** The same bundled journal the server compares against (runner cwd = repo root). */
function bundledJournal(): Journal {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'drizzle', 'migrations', 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
}

type MigrationStatus = {
  currentVersion: string | null;
  appliedCount: number;
  journalCount: number;
  applied: Array<{ idx: number; tag: string; when: number; appliedAt: string | null }>;
  pending: Array<{ idx: number; tag: string; when: number }>;
  drifted: boolean;
  driftReason?: string;
};

type PwPage = import('@playwright/test').Page;

async function getStatus(page: PwPage): Promise<MigrationStatus> {
  const res = await page.request.get('/api/admin/migrations');
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  return (await res.json()) as MigrationStatus;
}

type MigrationRow = { hash: string; created_at: string };

/** Capture the newest row of drizzle.__drizzle_migrations (exact values). */
async function captureLastRow(): Promise<MigrationRow> {
  return withSql(async (sql) => {
    const rows = await sql`
      select hash, created_at::text as created_at from drizzle.__drizzle_migrations
      order by created_at desc, id desc limit 1
    `;
    if (rows.length === 0) throw new Error('drizzle.__drizzle_migrations is empty on the dev DB');
    return rows[0] as MigrationRow;
  });
}

test.describe('item D7 — migration status panel', () => {
  test('falsifiable core / OK state: API reports fully applied and the panel shows the OK badge', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const journal = bundledJournal();
    const lastTag = journal.entries[journal.entries.length - 1]?.tag;

    const status = await getStatus(page);
    expect(status.journalCount).toBe(journal.entries.length);
    expect(status.appliedCount).toBe(status.journalCount);
    expect(status.pending).toHaveLength(0);
    expect(status.drifted).toBe(false);
    expect(status.currentVersion).toBe(lastTag);

    await page.goto('/settings/admin/migrations');
    const badge = page.getByTestId('migrations-state-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('migrations-current-version')).toContainText(lastTag as string);
    await expect(page.getByTestId('migrations-applied-count')).toContainText(
      `${status.appliedCount} of ${status.journalCount} migrations applied`,
    );
    // Neither degraded block renders in the OK state.
    await expect(page.getByTestId('migrations-pending')).toHaveCount(0);
    await expect(page.getByTestId('migrations-drift')).toHaveCount(0);
  });

  test('pending state: deleting the last applied row surfaces the last journal tag as pending (amber block)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const journal = bundledJournal();
    const lastTag = journal.entries[journal.entries.length - 1]?.tag as string;

    // Capture the exact row BEFORE deleting so finally can restore it
    // verbatim (other specs and the next harness boot depend on it).
    const saved = await captureLastRow();
    await withSql(async (sql) => {
      await sql`
        delete from drizzle.__drizzle_migrations
        where hash = ${saved.hash} and created_at = ${saved.created_at}::bigint
      `;
    });
    try {
      const status = await getStatus(page);
      expect(status.pending).toHaveLength(1);
      expect(status.pending[0]?.tag).toBe(lastTag);
      expect(status.drifted).toBe(false);
      expect(status.appliedCount).toBe(status.journalCount - 1);

      await page.goto('/settings/admin/migrations');
      const badge = page.getByTestId('migrations-state-badge');
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute('data-state', 'pending');
      const pendingBlock = page.getByTestId('migrations-pending');
      await expect(pendingBlock).toBeVisible();
      await expect(pendingBlock).toHaveAttribute('data-state', 'pending');
      await expect(pendingBlock).toContainText(lastTag);
      // Pending is NOT drift — the red block must not render.
      await expect(page.getByTestId('migrations-drift')).toHaveCount(0);
    } finally {
      await withSql(async (sql) => {
        await sql`
          insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${saved.hash}, ${saved.created_at}::bigint)
        `;
      });
    }
  });

  test('drift state: an extra row beyond the journal surfaces drifted + reason (red block, distinct from pending)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const journal = bundledJournal();
    const fakeHash = `d7-fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    await withSql(async (sql) => {
      await sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${fakeHash}, ${Date.now()}::bigint)
      `;
    });
    try {
      const status = await getStatus(page);
      expect(status.drifted).toBe(true);
      // The reason names both counts (DB rows vs journal length).
      expect(status.driftReason).toContain(String(journal.entries.length + 1));
      expect(status.driftReason).toContain(String(journal.entries.length));
      expect(status.pending).toHaveLength(0);

      await page.goto('/settings/admin/migrations');
      const badge = page.getByTestId('migrations-state-badge');
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute('data-state', 'drift');
      const driftBlock = page.getByTestId('migrations-drift');
      await expect(driftBlock).toBeVisible();
      await expect(driftBlock).toHaveAttribute('data-state', 'drift');
      // Drift is NOT pending — the amber block must not render.
      await expect(page.getByTestId('migrations-pending')).toHaveCount(0);
    } finally {
      await withSql(async (sql) => {
        await sql`delete from drizzle.__drizzle_migrations where hash = ${fakeHash}`;
      });
    }
  });

  test('roles: editor and viewer get 403 from the API; the panel never renders for an editor', async ({
    browser,
    seeded,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required for the e2e harness');

    // Dedicated accounts (NOT the shared a11y-2 user — the dev DB is
    // persistent and another spec may have changed that user's role).
    // seedSecondUser is idempotent per email, so reruns don't accumulate rows.
    const editor = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'd7-editor@cairn.test',
      password: 'd7-editor-password-1',
      role: 'editor',
    });
    const { context, page: editorPage } = await signInSecondUser(browser, editor);
    try {
      const res = await editorPage.request.get('/api/admin/migrations');
      expect(res.status()).toBe(403);

      // The settings RSC is requireRole('admin')-gated; an editor hitting the
      // page directly must never see the panel (the settings error boundary
      // renders instead) — same role-block posture as the D4/D6 admin pages.
      await editorPage.goto('/settings/admin/migrations');
      await expect(editorPage.getByTestId('migrations-state-badge')).toHaveCount(0);
      await expect(editorPage.getByTestId('migrations-summary')).toHaveCount(0);
    } finally {
      await context.close();
    }

    const viewer = await seedSecondUser(databaseUrl, {
      workspaceId: seeded.workspaceId,
      email: 'd7-viewer@cairn.test',
      password: 'd7-viewer-password-1',
      role: 'viewer',
    });
    const { context: viewerCtx, page: viewerPage } = await signInSecondUser(browser, viewer);
    try {
      expect((await viewerPage.request.get('/api/admin/migrations')).status()).toBe(403);
    } finally {
      await viewerCtx.close();
    }
  });
});
