import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { dispatchPat, mintPat } from '@/lib/auth/pat';
import { resetScopeBucketsForTests } from '@/lib/auth/pat-scope-bucket';
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
  await sql`TRUNCATE pat_quota_usage, personal_access_tokens, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  resetScopeBucketsForTests();
});

async function seed(): Promise<{ token: string; tokenId: string }> {
  const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
  const { token, row } = await mintPat(db, {
    userId: u.userId,
    workspaceId: u.workspaceId,
    name: 't',
    scopes: ['pages:read'],
    mcpTools: [],
    expiresAt: null,
  });
  return { token, tokenId: row.id };
}

describe('dispatchPat quota integration', () => {
  it('returns 429 + Retry-After Response when daily cap hit', async () => {
    const { token, tokenId } = await seed();
    await db
      .update(schema.personalAccessTokens)
      .set({ dailyRequestLimit: 1 })
      .where(eq(schema.personalAccessTokens.id, tokenId));

    const first = await dispatchPat({ db, token, scope: 'pages:read' });
    expect(first.kind).toBe('ok');

    const second = await dispatchPat({ db, token, scope: 'pages:read' });
    expect(second.kind).toBe('rate-limited');
    if (second.kind === 'rate-limited') {
      expect(second.response.status).toBe(429);
      expect(second.response.headers.get('Retry-After')).toMatch(/^\d+$/);
      const body = (await second.response.json()) as Record<string, unknown>;
      expect(body.error).toBe('rate_limited');
      // Defense-in-depth: never echo configured limits back.
      expect(JSON.stringify(body)).not.toContain('dailyRequestLimit');
      expect(JSON.stringify(body)).not.toContain('"limit"');
    }
  });

  it('passes through to ok when no quota configured', async () => {
    const { token } = await seed();
    const r = await dispatchPat({ db, token, scope: 'pages:read' });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.scopes).toContain('pages:read');
    }
  });

  it('returns invalid for unknown token', async () => {
    const fake = `cairn_pat_${'A'.repeat(43)}`;
    const r = await dispatchPat({ db, token: fake, scope: 'pages:read' });
    expect(r.kind).toBe('invalid');
  });

  it('returns invalid when token lacks the requested scope', async () => {
    const { token } = await seed();
    const r = await dispatchPat({ db, token, scope: 'pages:destructive' });
    expect(r.kind).toBe('invalid');
  });
});
