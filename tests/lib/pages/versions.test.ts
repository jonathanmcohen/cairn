import { randomUUID } from 'node:crypto';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import {
  listVersions,
  restoreVersion,
  SNAPSHOT_DEBOUNCE_MS,
  snapshotIfChanged,
} from '@/lib/pages/versions';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let pageId: string;
let authorId: string;
let workspaceId: string;

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
  await sql`TRUNCATE page_versions, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
  const u = await createTestWorkspaceWithUser(db);
  authorId = u.userId;
  workspaceId = u.workspaceId;
  const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
  pageId = page.id;
});

const doc = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', text: s }] });

describe('snapshotIfChanged', () => {
  it('inserts the first version unconditionally', async () => {
    const v = await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    expect(v).not.toBeNull();
    expect(await listVersions(db, pageId)).toHaveLength(1);
  });

  it('skips when content is identical to the latest version', async () => {
    await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    // back-date the latest beyond the debounce window so only dedupe can block it
    await db.execute(
      drizzleSql`update page_versions set created_at = now() - interval '5 minutes'`,
    );
    const v = await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    expect(v).toBeNull();
    expect(await listVersions(db, pageId)).toHaveLength(1);
  });

  it('skips when the latest version is younger than the debounce window', async () => {
    await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    const v = await snapshotIfChanged(db, { pageId, content: doc('b'), authorId });
    expect(v).toBeNull(); // changed, but too soon
    expect(await listVersions(db, pageId)).toHaveLength(1);
  });

  it('inserts when content differs and the window has elapsed', async () => {
    await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    await db.execute(
      drizzleSql`update page_versions set created_at = now() - interval '5 minutes'`,
    );
    const v = await snapshotIfChanged(db, { pageId, content: doc('b'), authorId });
    expect(v).not.toBeNull();
    expect(await listVersions(db, pageId)).toHaveLength(2);
  });

  it('prunes beyond the most-recent 50 per page', async () => {
    // insert 55 distinct, window-spaced versions
    for (let i = 0; i < 55; i++) {
      await snapshotIfChanged(db, { pageId, content: doc(`v${i}`), authorId });
      await db.execute(
        drizzleSql`update page_versions set created_at = now() - interval '5 minutes' where created_at > now() - interval '1 minute'`,
      );
    }
    const all = await listVersions(db, pageId);
    expect(all).toHaveLength(50);
    expect(all[0]?.content).toEqual(doc('v54')); // newest retained
  });

  it('exposes a 60s debounce window', () => {
    expect(SNAPSHOT_DEBOUNCE_MS).toBe(60_000);
  });
});

describe('restoreVersion', () => {
  it('writes the chosen content back as current AND as a new version', async () => {
    const v1 = await snapshotIfChanged(db, { pageId, content: doc('first'), authorId });
    await db.execute(
      drizzleSql`update page_versions set created_at = now() - interval '5 minutes'`,
    );
    await snapshotIfChanged(db, { pageId, content: doc('second'), authorId });

    const restored = await restoreVersion(db, {
      versionId: v1!.id,
      workspaceId,
      actorUserId: authorId,
    });
    // page content is back to v1
    expect(restored.content).toEqual(doc('first'));
    const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    expect(page?.content).toEqual(doc('first'));
    // and history GREW (non-destructive): first, second, + the restore
    const all = await listVersions(db, pageId);
    expect(all).toHaveLength(3);
    expect(all[0]?.content).toEqual(doc('first')); // newest is the restore
  });

  it('throws on an unknown version id', async () => {
    await expect(
      restoreVersion(db, { versionId: randomUUID(), workspaceId, actorUserId: authorId }),
    ).rejects.toThrow();
  });
});

describe('listVersions author', () => {
  it('includes the author display name', async () => {
    await snapshotIfChanged(db, { pageId, content: doc('a'), authorId });
    const [v] = await listVersions(db, pageId);
    expect(typeof v?.authorName === 'string' || v?.authorName === null).toBe(true);
  });
});
