import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  __resetRebuildJobForTests,
  getRebuildJob,
  type RebuildJob,
  startRebuildJob,
} from '@/lib/search/rebuild-index';
import type { ReindexSummary } from '@/lib/search/reindex-cli';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// v0.10.0 D8 — route coverage for /api/admin/search/reindex: role gate
// (admin/owner only, same posture as the sibling admin routes), 202-on-start,
// the 200-debounce contract while a job is running, and GET's job shape.

let uri: string;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function asUser(role: schema.MemberRole) {
  const u = await createTestWorkspaceWithUser(db, { role });
  await setUser(u.userId);
  return u;
}

async function waitForSettled(timeoutMs = 30_000): Promise<RebuildJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getRebuildJob();
    if (job && job.state !== 'running') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('rebuild job never settled');
}

beforeEach(async () => {
  await sql`TRUNCATE workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
  __resetRebuildJobForTests();
});

describe('POST /api/admin/search/reindex', () => {
  it('401 without a session', async () => {
    const { POST } = await import('@/app/api/admin/search/reindex/route');
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('403 for an editor', async () => {
    await asUser('editor');
    const { POST } = await import('@/app/api/admin/search/reindex/route');
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('403 for a viewer', async () => {
    await asUser('viewer');
    const { POST } = await import('@/app/api/admin/search/reindex/route');
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('admin starts a job → 202 with the running job; it settles done (real passes, empty DB)', async () => {
    await asUser('admin');
    const { POST } = await import('@/app/api/admin/search/reindex/route');
    const res = await POST();
    expect(res.status).toBe(202);
    const body = (await res.json()) as { job: RebuildJob };
    expect(body.job.state).toBe('running');
    expect(typeof body.job.id).toBe('string');
    expect(body.job.startedAt).toBeTruthy();

    // The real passes run against the harness DB: zero pages → an all-zero
    // vectors summary, then a real REINDEX CONCURRENTLY. Await settle so the
    // background runner can't leak into the next test.
    const settled = await waitForSettled();
    expect(settled.id).toBe(body.job.id);
    expect(settled.state).toBe('done');
    expect(settled.vectors).toEqual({ processed: 0, embedded: 0, skipped: 0, errors: 0 });
  });

  it('a second POST while a job is running answers 200 with the SAME job (debounce)', async () => {
    await asUser('admin');
    // Pin a deterministic running job through the registry (the route consults
    // the same globalThis-backed singleton) so the debounce branch can't race
    // a fast real run.
    let release!: (value: ReindexSummary) => void;
    const hang = new Promise<ReindexSummary>((res) => {
      release = res;
    });
    const { job: runningJob } = startRebuildJob({
      connectionString: uri,
      db,
      runVectors: () => hang,
      runIndex: async () => {},
    });

    const { POST } = await import('@/app/api/admin/search/reindex/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: RebuildJob };
    expect(body.job.id).toBe(runningJob.id);
    expect(body.job.state).toBe('running');

    release({ processed: 0, embedded: 0, skipped: 0, errors: 0 });
    await waitForSettled();
  });
});

describe('GET /api/admin/search/reindex', () => {
  it('401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/search/reindex/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for an editor', async () => {
    await asUser('editor');
    const { GET } = await import('@/app/api/admin/search/reindex/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns { job: null } when nothing has ever run', async () => {
    await asUser('admin');
    const { GET } = await import('@/app/api/admin/search/reindex/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: RebuildJob | null }).job).toBeNull();
  });

  it('returns the last job after a run settles (the last-run record)', async () => {
    await asUser('admin');
    startRebuildJob({
      connectionString: uri,
      db,
      runVectors: async () => ({ processed: 2, embedded: 1, skipped: 1, errors: 0 }),
      runIndex: async () => {},
    });
    await waitForSettled();

    const { GET } = await import('@/app/api/admin/search/reindex/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: RebuildJob };
    expect(body.job.state).toBe('done');
    expect(body.job.vectors).toEqual({ processed: 2, embedded: 1, skipped: 1, errors: 0 });
    expect(body.job.finishedAt).not.toBeNull();
  });
});
