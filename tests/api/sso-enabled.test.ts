import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

describe('GET /api/sso/enabled', () => {
  it('lists enabled IdPs with start paths and appends a safe returnTo', async () => {
    const w = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const [idp] = await getDb()
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: w.workspaceId,
        type: 'oidc',
        name: 'Okta',
        enabled: true,
        metadata: { issuer: 'https://idp', clientId: 'c', clientSecret: 'SECRET' },
      })
      .returning();
    if (!idp) throw new Error('insert failed');

    const { GET } = await import('@/app/api/sso/enabled/route');
    const res = await GET(new Request('http://localhost/api/sso/enabled?next=%2Fdash'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: { id: string; type: string; name: string; startPath: string }[];
    };
    expect(body.providers).toEqual([
      {
        id: idp.id,
        type: 'oidc',
        name: 'Okta',
        startPath: `/api/sso/oidc/init/${idp.id}?returnTo=%2Fdash`,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  it('ignores a non-local next (open-redirect guard)', async () => {
    const w = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const [idp] = await getDb()
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: w.workspaceId,
        type: 'saml',
        name: 'OneLogin',
        enabled: true,
        metadata: {},
      })
      .returning();
    if (!idp) throw new Error('insert failed');

    const { GET } = await import('@/app/api/sso/enabled/route');
    const res = await GET(new Request('http://localhost/api/sso/enabled?next=https%3A%2F%2Fevil'));
    const body = (await res.json()) as { providers: { startPath: string }[] };
    expect(body.providers[0]?.startPath).toBe(`/api/sso/saml/init/${idp.id}`);
  });
});
