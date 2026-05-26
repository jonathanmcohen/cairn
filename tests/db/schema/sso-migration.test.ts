import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

async function seedUserAndWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `u-${Date.now()}-${Math.random()}@example.com`,
      name: 'Test',
      passwordHash: 'x',
    })
    .returning({ id: schema.users.id });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    .returning({ id: schema.workspaces.id });
  return { userId: user!.id, workspaceId: ws!.id };
}

describe('migration 0034 — sso identity tables', () => {
  it('idp_configurations: insert + select round-trip', async () => {
    const { workspaceId } = await seedUserAndWorkspace();
    const [row] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId,
        type: 'oidc',
        name: 'Okta',
        metadata: { issuer: 'https://example.okta.com', clientId: 'abc' },
        attributeMap: { email: 'email', name: 'name' },
        enabled: true,
      })
      .returning();
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row!.type).toBe('oidc');
    expect(row!.enabled).toBe(true);

    const fetched = await db
      .select()
      .from(schema.idpConfigurations)
      .where(eq(schema.idpConfigurations.id, row!.id));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.metadata).toEqual({ issuer: 'https://example.okta.com', clientId: 'abc' });
  });

  it('idp_configurations: unique (workspace_id, name) constraint', async () => {
    const { workspaceId } = await seedUserAndWorkspace();
    await db
      .insert(schema.idpConfigurations)
      .values({ workspaceId, type: 'oidc', name: 'dup', metadata: {}, attributeMap: {} });
    await expect(
      db
        .insert(schema.idpConfigurations)
        .values({ workspaceId, type: 'saml', name: 'dup', metadata: {}, attributeMap: {} }),
    ).rejects.toThrow();
  });

  it('external_identities: insert + select round-trip', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({ workspaceId, type: 'oidc', name: 'IdP', metadata: {}, attributeMap: {} })
      .returning();
    const [row] = await db
      .insert(schema.externalIdentities)
      .values({
        userId,
        idpConfigId: idp!.id,
        externalId: 'subject-123',
        rawAttrs: { groups: ['admin'] },
      })
      .returning();
    expect(row!.externalId).toBe('subject-123');
    expect(row!.rawAttrs).toEqual({ groups: ['admin'] });
  });

  it('external_identities: unique (idp_config_id, external_id) constraint', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({ workspaceId, type: 'oidc', name: 'IdP', metadata: {}, attributeMap: {} })
      .returning();
    await db
      .insert(schema.externalIdentities)
      .values({ userId, idpConfigId: idp!.id, externalId: 'same' });
    await expect(
      db
        .insert(schema.externalIdentities)
        .values({ userId, idpConfigId: idp!.id, externalId: 'same' }),
    ).rejects.toThrow();
  });

  it('scim_tokens: insert + select round-trip with scopes array', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const [row] = await db
      .insert(schema.scimTokens)
      .values({
        workspaceId,
        tokenHash: 'a'.repeat(64),
        name: 'Okta SCIM',
        scopes: ['users:read', 'users:write', 'groups:read'],
        createdBy: userId,
      })
      .returning();
    expect(row!.scopes).toEqual(['users:read', 'users:write', 'groups:read']);
    expect(row!.lastUsedAt).toBeNull();
  });

  it('scim_tokens: unique token_hash constraint', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    await db.insert(schema.scimTokens).values({
      workspaceId,
      tokenHash: 'h'.repeat(64),
      name: 't1',
      scopes: [],
      createdBy: userId,
    });
    await expect(
      db.insert(schema.scimTokens).values({
        workspaceId,
        tokenHash: 'h'.repeat(64),
        name: 't2',
        scopes: [],
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it('cascade on workspace delete clears idp_configurations + scim_tokens', async () => {
    const { userId, workspaceId } = await seedUserAndWorkspace();
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({ workspaceId, type: 'oidc', name: 'IdP', metadata: {}, attributeMap: {} })
      .returning();
    await db.insert(schema.scimTokens).values({
      workspaceId,
      tokenHash: 'c'.repeat(64),
      name: 't',
      scopes: [],
      createdBy: userId,
    });
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    expect(
      await db
        .select()
        .from(schema.idpConfigurations)
        .where(eq(schema.idpConfigurations.id, idp!.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.scimTokens)
        .where(eq(schema.scimTokens.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });
});
