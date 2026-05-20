import { runMigrations } from '@/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await stopPostgres();
});

describe('GET /api/health', () => {
  it('returns ok + version + db ok', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = (await res.json()) as { status: string; version: string; db: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.db).toBe('ok');
  });
});
