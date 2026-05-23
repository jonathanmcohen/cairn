import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { assertAuditMetadataClean, recordAudit } from '@/lib/audit/record';
import { startPostgres, stopPostgres } from '../../helpers/db';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  pg = postgres(uri);
  db = drizzle(pg, { schema });
});
afterAll(async () => {
  await pg.end();
  await stopPostgres();
});
beforeEach(async () => {
  await pg`TRUNCATE audit_log, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makeWs() {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `a-${Math.random()}@x.com`, passwordHash: 'h', name: 'A' })
    .returning();
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!u || !ws) throw new Error('seed failed');
  return { userId: u.id, workspaceId: ws.id };
}

describe('recordAudit', () => {
  it('inserts a row inside the given transaction with all fields populated', async () => {
    const { userId, workspaceId } = await makeWs();
    await db.transaction(async (tx) => {
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'workspace.ownership_transferred',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { fromUserId: userId, toUserId: userId },
        ip: '203.0.113.7',
      });
    });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('workspace.ownership_transferred');
    expect(rows[0]?.targetType).toBe('workspace');
    expect(rows[0]?.targetId).toBe(workspaceId);
    expect(rows[0]?.ip).toBe('203.0.113.7');
    expect(rows[0]?.metadata).toMatchObject({ fromUserId: userId, toUserId: userId });
  });

  it('persists absent actorUserId as null and absent ip as null', async () => {
    const { workspaceId } = await makeWs();
    await db.transaction((tx) =>
      recordAudit(tx, { workspaceId, actorUserId: null, action: 'workspace.deleted' }),
    );
    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(row?.actorUserId).toBeNull();
    expect(row?.ip).toBeNull();
    expect(row?.metadata).toEqual({});
  });

  it('round-trips nested jsonb metadata', async () => {
    const { userId, workspaceId } = await makeWs();
    const meta = { before: { role: 'editor' }, after: { role: 'admin' } };
    await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: userId,
        metadata: meta,
      }),
    );
    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(row?.metadata).toEqual(meta);
  });

  it('rolls back with its transaction (no orphan audit row on failure)', async () => {
    const { userId, workspaceId } = await makeWs();
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          workspaceId,
          actorUserId: userId,
          action: 'workspace.deleted',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('returns the inserted row (caller can assert on id/createdAt)', async () => {
    const { userId, workspaceId } = await makeWs();
    const row = await db.transaction((tx) =>
      recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        action: 'workspace.ownership_transferred',
        targetType: 'workspace',
        targetId: workspaceId,
      }),
    );
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.action).toBe('workspace.ownership_transferred');
  });

  it('calls assertAuditMetadataClean before insert → dirty metadata throws + zero rows', async () => {
    const { userId, workspaceId } = await makeWs();
    await expect(
      db.transaction((tx) =>
        recordAudit(tx, {
          workspaceId,
          actorUserId: userId,
          action: 'api_key.created',
          metadata: { token_hash: 'abc123' },
        }),
      ),
    ).rejects.toThrow(/audit metadata/i);
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });
});

describe('assertAuditMetadataClean', () => {
  it('no-ops on undefined / empty / clean metadata', () => {
    expect(() => assertAuditMetadataClean(undefined)).not.toThrow();
    expect(() => assertAuditMetadataClean({})).not.toThrow();
    expect(() => assertAuditMetadataClean({ changed: ['name', 'description'] })).not.toThrow();
    expect(() =>
      assertAuditMetadataClean({ before: { role: 'editor' }, after: { role: 'admin' } }),
    ).not.toThrow();
  });

  it('throws on forbidden substrings in keys or string values', () => {
    expect(() => assertAuditMetadataClean({ AUTH_SECRET: 'x' })).toThrow();
    expect(() => assertAuditMetadataClean({ key: 'cairn_whsec_abcdef' })).toThrow();
    expect(() => assertAuditMetadataClean({ key: 'cairn_sk_abcdef' })).toThrow();
    expect(() => assertAuditMetadataClean({ token_hash: 'abc' })).toThrow();
    expect(() => assertAuditMetadataClean({ password_hash: 'abc' })).toThrow();
    expect(() => assertAuditMetadataClean({ secret_encrypted: 'abc' })).toThrow();
  });

  it('throws when a value matches the live AUTH_SECRET env value', () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'super-secret-test-value-1234567890';
    try {
      expect(() =>
        assertAuditMetadataClean({ leaked: 'super-secret-test-value-1234567890' }),
      ).toThrow();
    } finally {
      if (original === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original;
    }
  });

  it('throws on a secret-ish key with a long base64-ish value', () => {
    expect(() =>
      assertAuditMetadataClean({ apiSecret: 'aGVsbG93b3JsZHRoaXNpc2FsbG9uZ2Jhc2U2NHN0cmluZw==' }),
    ).toThrow();
  });

  it('recurses into nested objects', () => {
    expect(() =>
      assertAuditMetadataClean({ outer: { inner: { token_hash: 'leaked' } } }),
    ).toThrow();
  });
});
