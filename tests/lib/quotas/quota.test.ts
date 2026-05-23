import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { FileStorage } from '@/lib/files/storage';
import { storeUpload } from '@/lib/files/upload';
import { QuotaExceededError } from '@/lib/quotas/errors';
import {
  checkStorageQuota,
  decrementStorageUsed,
  ensureQuotaRow,
  incrementStorageUsed,
  reconcileQuota,
} from '@/lib/quotas/quota';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let workspaceId: string;
let userId: string;

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
  await sql`TRUNCATE workspace_quotas, files, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'u@x.com', passwordHash: 'h', name: 'U' })
    .returning();
  if (!u) throw new Error('user insert failed');
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: w.id, userId: u.id, role: 'owner' });
  workspaceId = w.id;
  userId = u.id;
});

describe('workspace storage quota', () => {
  it('lazily creates a quota row with a zero counter and no limit', async () => {
    const q = await ensureQuotaRow(db, workspaceId);
    expect(q.storageBytesUsed).toBe(0);
    expect(q.storageBytesLimit).toBeNull();
  });

  it('allows any upload when the limit is null (unlimited)', async () => {
    await ensureQuotaRow(db, workspaceId);
    await expect(
      checkStorageQuota(db, { workspaceId, incomingBytes: 10_000_000 }),
    ).resolves.toBeUndefined();
  });

  it('rejects when used + incoming would exceed the limit', async () => {
    await ensureQuotaRow(db, workspaceId);
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: 1000, storageBytesUsed: 900 })
      .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
    await expect(checkStorageQuota(db, { workspaceId, incomingBytes: 200 })).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    await expect(
      checkStorageQuota(db, { workspaceId, incomingBytes: 100 }),
    ).resolves.toBeUndefined();
  });

  it('increments and decrements the counter (never below zero)', async () => {
    await ensureQuotaRow(db, workspaceId);
    await incrementStorageUsed(db, workspaceId, 500);
    await incrementStorageUsed(db, workspaceId, 250);
    let [q] = await db
      .select()
      .from(schema.workspaceQuotas)
      .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
    expect(q?.storageBytesUsed).toBe(750);
    await decrementStorageUsed(db, workspaceId, 1000);
    [q] = await db
      .select()
      .from(schema.workspaceQuotas)
      .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
    expect(q?.storageBytesUsed).toBe(0);
  });

  it('reconciles the counter from the actual files.size sum', async () => {
    await ensureQuotaRow(db, workspaceId);
    await incrementStorageUsed(db, workspaceId, 9999);
    await db.insert(schema.files).values([
      {
        workspaceId,
        name: 'a.txt',
        mimeType: 'text/plain',
        size: 100,
        path: `${workspaceId}/a`,
        uploadedBy: userId,
      },
      {
        workspaceId,
        name: 'b.txt',
        mimeType: 'text/plain',
        size: 200,
        path: `${workspaceId}/b`,
        uploadedBy: userId,
      },
    ]);
    const used = await reconcileQuota(db, workspaceId);
    expect(used).toBe(300);
    const [q] = await db
      .select()
      .from(schema.workspaceQuotas)
      .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
    expect(q?.storageBytesUsed).toBe(300);
  });

  it('storeUpload rejects an over-limit upload and does not insert a files row', async () => {
    await ensureQuotaRow(db, workspaceId);
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: 100, storageBytesUsed: 90 })
      .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
    const storage: FileStorage = {
      put: async () => {},
      exists: async () => false,
      delete: async () => {},
      read: () => Readable.from(Buffer.alloc(0)),
    };
    await expect(
      storeUpload({
        db,
        storage,
        secret: 'test',
        workspaceId,
        uploadedBy: userId,
        filename: 'big.txt',
        mimeType: 'text/plain',
        body: Buffer.alloc(50),
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    const rows = await db
      .select()
      .from(schema.files)
      .where(eq(schema.files.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });
});
