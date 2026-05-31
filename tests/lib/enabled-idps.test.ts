import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listEnabledIdps } from '@/lib/sso/enabled-idps';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE idp_configurations, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('listEnabledIdps', () => {
  it('returns only enabled IdPs with start paths, never metadata', async () => {
    const w = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const [oidc] = await getDb()
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: w.workspaceId,
        type: 'oidc',
        name: 'Okta',
        enabled: true,
        metadata: { issuer: 'https://idp', clientId: 'c', clientSecret: 'SECRET' },
      })
      .returning();
    await getDb().insert(schema.idpConfigurations).values({
      workspaceId: w.workspaceId,
      type: 'saml',
      name: 'OneLogin',
      enabled: false,
      metadata: {},
    });
    if (!oidc) throw new Error('insert failed');

    const list = await listEnabledIdps(getDb());
    expect(list).toEqual([
      { id: oidc.id, type: 'oidc', name: 'Okta', startPath: `/api/sso/oidc/init/${oidc.id}` },
    ]);
    expect(JSON.stringify(list)).not.toContain('SECRET');
  });
});
