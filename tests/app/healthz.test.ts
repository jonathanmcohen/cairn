import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
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

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('@/db/client');
});

describe('GET /healthz', () => {
  it('returns 200 with status:ok when the DB is reachable', async () => {
    const { GET } = await import('@/app/healthz/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      version: string;
      db: string;
      uptime_seconds: number;
    };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime_seconds).toBe('number');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('exposes the package.json version', async () => {
    const { GET } = await import('@/app/healthz/route');
    const body = (await (await GET()).json()) as { version: string };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('uptime_seconds monotonically increases between calls', async () => {
    const { GET } = await import('@/app/healthz/route');
    const a = (await (await GET()).json()) as { uptime_seconds: number };
    // Wait a tick.
    await new Promise((r) => setTimeout(r, 50));
    const b = (await (await GET()).json()) as { uptime_seconds: number };
    expect(b.uptime_seconds).toBeGreaterThanOrEqual(a.uptime_seconds);
  });

  it('returns 503 with status:degraded when the DB is unreachable', async () => {
    vi.resetModules();
    vi.doMock('@/db/client', () => ({
      getDb: () => ({
        execute: async () => {
          throw new Error('connection refused');
        },
      }),
    }));
    const { GET } = await import('@/app/healthz/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('unreachable');
    vi.doUnmock('@/db/client');
    vi.resetModules();
  });

  it('does NOT require authentication (always open)', async () => {
    const { GET } = await import('@/app/healthz/route');
    // No headers — the route must still respond 200.
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
