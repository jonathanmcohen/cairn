import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { hashScimToken, mintScimToken, verifyScimToken } from '@/lib/sso/scim-token';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

describe('scim-token', () => {
  it('mintScimToken returns matching raw/hash, raw has cairn_scim_ prefix', () => {
    const { raw, hash } = mintScimToken();
    expect(raw).toMatch(/^cairn_scim_[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashScimToken(raw)).toBe(hash);
  });

  it('hashScimToken is deterministic', () => {
    expect(hashScimToken('cairn_scim_abc')).toBe(hashScimToken('cairn_scim_abc'));
    expect(hashScimToken('cairn_scim_abc')).not.toBe(hashScimToken('cairn_scim_xyz'));
  });

  it('verifyScimToken returns the row + updates last_used_at on match', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'a@x', name: 'A', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2, 10)}` })
      .returning({ id: schema.workspaces.id });
    const { raw, hash } = mintScimToken();
    const [tok] = await db
      .insert(schema.scimTokens)
      .values({
        workspaceId: ws!.id,
        tokenHash: hash,
        name: 't',
        scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
        createdBy: user!.id,
      })
      .returning({ id: schema.scimTokens.id });

    const verified = await verifyScimToken(db, raw);
    expect(verified).not.toBeNull();
    expect(verified!.workspaceId).toBe(ws!.id);
    expect(verified!.scopes).toContain('users:read');
    expect(verified!.tokenId).toBe(tok!.id);

    const [reloaded] = await db
      .select()
      .from(schema.scimTokens)
      .where(eq(schema.scimTokens.id, tok!.id));
    expect(reloaded!.lastUsedAt).not.toBeNull();
  });

  it('verifyScimToken returns null on bad token (no DB row updated)', async () => {
    const result = await verifyScimToken(db, 'cairn_scim_doesnotexist');
    expect(result).toBeNull();
  });
});
