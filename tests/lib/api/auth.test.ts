import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { requireApiAuth } from '@/lib/api/auth';
import { mintKey } from '@/lib/api/keys';
import { HttpError } from '@/lib/auth/require-role';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys RESTART IDENTITY CASCADE`;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/pages', { headers });
}

describe('requireApiAuth', () => {
  it('resolves a valid bearer token to an AuthContext', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const { token } = await mintKey(getDb(), {
      workspaceId: u.workspaceId,
      name: 'k',
      role: 'editor',
      createdBy: u.userId,
    });
    const ctx = await requireApiAuth(req({ authorization: `Bearer ${token}` }));
    expect(ctx).toEqual({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
  });

  it('throws 401 with no header', async () => {
    await expect(requireApiAuth(req())).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 for a non-Bearer scheme', async () => {
    await expect(requireApiAuth(req({ authorization: 'Basic abc' }))).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('throws 401 for an invalid token', async () => {
    await expect(
      requireApiAuth(req({ authorization: 'Bearer cairn_sk_nope' })),
    ).rejects.toMatchObject({ status: 401 });
  });
});
