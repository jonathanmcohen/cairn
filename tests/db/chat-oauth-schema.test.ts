import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { getTestDb, resetDb, startPostgres, stopPostgres } from '../helpers/db';

describe('chat_oauth_installs schema (migration 0060)', () => {
  beforeAll(startPostgres);
  afterAll(stopPostgres);
  beforeEach(resetDb);

  it('round-trips an install row with encrypted bot token + scopes array', async () => {
    const db = getTestDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: 'ws-oauth' })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'admin@example.com', name: 'Admin', passwordHash: 'x' })
      .returning();
    if (!ws || !user) throw new Error('seed insert returned no rows');

    const [row] = await db
      .insert(schema.chatOauthInstalls)
      .values({
        workspaceId: ws.id,
        platform: 'slack',
        externalTeamId: 'T123',
        botTokenEncrypted: Buffer.from('sealed-bytes'),
        scopes: ['chat:write', 'channels:read'],
        installedBy: user.id,
      })
      .returning();
    if (!row) throw new Error('install insert returned no row');

    expect(row.platform).toBe('slack');
    expect(row.externalTeamId).toBe('T123');
    expect(row.scopes).toEqual(['chat:write', 'channels:read']);
    expect(row.revokedAt).toBeNull();
    expect(Buffer.isBuffer(row.botTokenEncrypted)).toBe(true);

    const found = await db
      .select()
      .from(schema.chatOauthInstalls)
      .where(eq(schema.chatOauthInstalls.id, row.id));
    expect(found).toHaveLength(1);
  });

  it('enforces unique (workspace_id, platform, external_team_id)', async () => {
    const db = getTestDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'WS', slug: 'ws-uniq' })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'u@example.com', name: 'U', passwordHash: 'x' })
      .returning();
    if (!ws || !user) throw new Error('seed insert returned no rows');
    const base = {
      workspaceId: ws.id,
      platform: 'discord' as const,
      externalTeamId: 'G999',
      botTokenEncrypted: Buffer.from('s'),
      scopes: ['bot'],
      installedBy: user.id,
    };
    await db.insert(schema.chatOauthInstalls).values(base);
    await expect(db.insert(schema.chatOauthInstalls).values(base)).rejects.toThrow();
  });
});
