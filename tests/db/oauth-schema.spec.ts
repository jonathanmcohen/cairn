/**
 * Plan F (MCP OAuth) — migration 0069 schema (oauth_clients,
 * oauth_authorization_codes, oauth_tokens). Verifies the tables exist with the
 * right columns/constraints by round-tripping representative rows, exercising
 * FK enforcement, the S256 CHECK, and the token-hash unique indexes.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { getTestDb, startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

describe('OAuth schema (migration 0069)', () => {
  beforeAll(startPostgres);
  afterAll(stopPostgres);
  beforeEach(async () => {
    const db = getTestDb();
    await db.execute(
      'TRUNCATE oauth_tokens, oauth_authorization_codes, oauth_clients, workspace_members, workspaces, users RESTART IDENTITY CASCADE',
    );
  });

  it('round-trips an oauth_clients row (public client: null secret hash)', async () => {
    const db = getTestDb();
    const { userId } = await createTestWorkspaceWithUser(db);
    const [row] = await db
      .insert(schema.oauthClients)
      .values({
        clientId: 'abc123',
        clientSecretHash: null,
        clientName: 'Claude Desktop',
        redirectUris: ['http://localhost:1234/callback'],
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error('client insert returned no row');
    expect(row.clientId).toBe('abc123');
    expect(row.clientSecretHash).toBeNull();
    // grant_types default applies.
    expect(row.grantTypes).toEqual(['authorization_code', 'refresh_token']);
    expect(row.redirectUris).toEqual(['http://localhost:1234/callback']);
  });

  it('enforces unique client_id on oauth_clients', async () => {
    const db = getTestDb();
    const base = {
      clientId: 'dup-client',
      clientName: 'X',
      redirectUris: ['https://x/cb'],
    };
    await db.insert(schema.oauthClients).values(base);
    await expect(db.insert(schema.oauthClients).values(base)).rejects.toThrow();
  });

  it('round-trips an oauth_authorization_codes row; consumed_at defaults null; S256 default', async () => {
    const db = getTestDb();
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    const [row] = await db
      .insert(schema.oauthAuthorizationCodes)
      .values({
        codeHash: 'h'.repeat(64),
        clientId: 'abc123',
        userId,
        workspaceId,
        scopes: ['mcp:read', 'pages:read'],
        redirectUri: 'http://localhost:1234/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!row) throw new Error('code insert returned no row');
    expect(row.consumedAt).toBeNull();
    expect(row.codeChallengeMethod).toBe('S256');
    expect(row.scopes).toEqual(['mcp:read', 'pages:read']);
  });

  it('CHECK rejects a non-S256 code_challenge_method', async () => {
    const db = getTestDb();
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    await expect(
      db.insert(schema.oauthAuthorizationCodes).values({
        codeHash: 'g'.repeat(64),
        clientId: 'abc123',
        userId,
        workspaceId,
        scopes: ['mcp:read'],
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'c',
        codeChallengeMethod: 'plain',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it('FK to users/workspaces is enforced on oauth_authorization_codes', async () => {
    const db = getTestDb();
    await expect(
      db.insert(schema.oauthAuthorizationCodes).values({
        codeHash: 'f'.repeat(64),
        clientId: 'abc123',
        userId: '00000000-0000-0000-0000-000000000000',
        workspaceId: '00000000-0000-0000-0000-000000000000',
        scopes: ['mcp:read'],
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'c',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it('round-trips an oauth_tokens row and enforces unique access_token_hash', async () => {
    const db = getTestDb();
    const { userId, workspaceId } = await createTestWorkspaceWithUser(db);
    const [row] = await db
      .insert(schema.oauthTokens)
      .values({
        accessTokenHash: 'a'.repeat(64),
        refreshTokenHash: 'r'.repeat(64),
        clientId: 'abc123',
        userId,
        workspaceId,
        scopes: ['mcp:read', 'pages:read'],
        accessExpiresAt: new Date(Date.now() + 3_600_000),
        refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning();
    if (!row) throw new Error('token insert returned no row');
    expect(row.revokedAt).toBeNull();
    expect(row.lastUsedAt).toBeNull();

    // duplicate access_token_hash → unique violation
    await expect(
      db.insert(schema.oauthTokens).values({
        accessTokenHash: 'a'.repeat(64),
        clientId: 'abc123',
        userId,
        workspaceId,
        scopes: ['mcp:read'],
        accessExpiresAt: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toThrow();

    const found = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.id, row.id));
    expect(found).toHaveLength(1);
  });
});
