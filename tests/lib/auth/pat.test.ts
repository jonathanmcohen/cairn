import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { hashPat, mintPat, verifyPat, verifyPatToken } from '@/lib/auth/pat';
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
  await sql`TRUNCATE personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('mintPat', () => {
  it('returns a plaintext cairn_pat_ token and persists hash + 4-char prefix', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token, row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'CI bot',
      scopes: ['pages:read', 'pages:write'],
      mcpTools: ['pages.read', 'pages.update'],
      expiresAt: null,
    });
    expect(token.startsWith('cairn_pat_')).toBe(true);
    expect(token.length).toBeGreaterThan('cairn_pat_'.length + 32); // 32 raw bytes b64u-encoded ≈ 43 chars
    expect(row.tokenPrefix.startsWith('cairn_pat_')).toBe(true);
    expect(row.tokenPrefix.length).toBe('cairn_pat_'.length + 4);
    expect(row.tokenHash).not.toContain(token); // hash stored, not plaintext
    expect(row.scopes).toEqual(['pages:read', 'pages:write']);
    expect(row.mcpTools).toEqual(['pages.read', 'pages.update']);
    expect(row.revokedAt).toBeNull();
  });

  it('mint returns distinct tokens on repeat calls', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const a = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'a',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    const b = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'b',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    expect(a.token).not.toBe(b.token);
    expect(a.row.tokenHash).not.toBe(b.row.tokenHash);
  });
});

describe('mintPat — audit trail', () => {
  it('writes a pat.created audit row in the same transaction', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'CI bot',
      scopes: ['pages:read'],
      mcpTools: ['pages.read'],
      expiresAt: null,
    });
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, row.id))
      .limit(1);
    expect(audit?.action).toBe('pat.created');
    expect(audit?.targetType).toBe('personal_access_token');
    expect(audit?.actorUserId).toBe(u.userId);
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta.name).toBe('CI bot');
    expect(meta.scopes).toEqual(['pages:read']);
    // PAT secrets MUST NOT appear in audit metadata (defense-in-depth — Task 1
    // would have thrown anyway, but assert it didn't sneak through).
    expect(JSON.stringify(meta)).not.toContain('cairn_pat_');
  });
});

describe('hashPat + verifyPat', () => {
  it('hashPat is deterministic over the same input', () => {
    expect(hashPat('cairn_pat_abc')).toBe(hashPat('cairn_pat_abc'));
  });

  it('verifyPat is true for matching secret+hash, false otherwise', () => {
    const secret = 'cairn_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hash = hashPat(secret);
    expect(verifyPat(secret, hash)).toBe(true);
    expect(verifyPat('cairn_pat_xxx', hash)).toBe(false);
  });
});

describe('verifyPatToken (DB lookup)', () => {
  it('returns context for a valid token', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'k',
      scopes: ['pages:read'],
      mcpTools: ['pages.read'],
      expiresAt: null,
    });
    const ctx = await verifyPatToken(db, token);
    expect(ctx).not.toBeNull();
    expect(ctx?.kind).toBe('pat');
    expect(ctx?.userId).toBe(u.userId);
    expect(ctx?.workspaceId).toBe(u.workspaceId);
    expect(ctx?.scopes).toEqual(['pages:read']);
    expect(ctx?.mcpTools).toEqual(['pages.read']);
  });

  it('returns null for a token that does not start with cairn_pat_', async () => {
    expect(await verifyPatToken(db, 'cairn_sk_abc')).toBeNull();
    expect(await verifyPatToken(db, 'random-string')).toBeNull();
  });

  it('returns null for an unknown valid-shaped token', async () => {
    const fake = `cairn_pat_${'A'.repeat(43)}`;
    expect(await verifyPatToken(db, fake)).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token, row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'k',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    await sql`UPDATE personal_access_tokens SET revoked_at = now() WHERE id = ${row.id}`;
    expect(await verifyPatToken(db, token)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'k',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyPatToken(db, token)).toBeNull();
  });

  it('updates last_used_at fire-and-forget on a successful resolve', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { token, row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'k',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    expect(row.lastUsedAt).toBeNull();
    const ctx = await verifyPatToken(db, token);
    expect(ctx).not.toBeNull();
    // Fire-and-forget — give the microtask + the UPDATE a tick to flush.
    await new Promise((r) => setTimeout(r, 50));
    const [after] = await db
      .select()
      .from(schema.personalAccessTokens)
      .where(eq(schema.personalAccessTokens.id, row.id))
      .limit(1);
    expect(after?.lastUsedAt).not.toBeNull();
  });
});
