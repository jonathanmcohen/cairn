import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';

let uri = '';
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/auth/signup/route');
  const res = await POST(
    new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/auth/signup', () => {
  it('creates the first user and returns 201', async () => {
    const r = await call({
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ role: 'owner' });
  });

  it('rejects unparseable input with 400', async () => {
    const r = await call({ email: 'not-an-email', password: 'x', name: '' });
    expect(r.status).toBe(400);
  });

  it('rejects second signup without invite with 403', async () => {
    await call({
      email: 'first@example.com',
      password: 'correct horse battery',
      name: 'First',
      workspaceName: 'Acme',
    });
    const r = await call({
      email: 'second@example.com',
      password: 'correct horse battery',
      name: 'Second',
    });
    expect(r.status).toBe(403);
  });
});
