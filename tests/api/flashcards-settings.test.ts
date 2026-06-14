import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
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
  await sql`TRUNCATE workspace_flashcard_settings, flashcard_decks, audit_log, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

// Mock @/lib/auth/config so we can control the authenticated user.
// This matches the pattern used in trash-settings.test.ts.
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

describe('GET /api/flashcards/settings', () => {
  it('returns defaults when no settings row exists', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { GET } = await import('@/app/api/flashcards/settings/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.newPerDay).toBe(20);
    expect(body.reviewLimit).toBe(200);
    expect(body.easeStart).toBeCloseTo(2.5);
    expect(body.leechThreshold).toBe(8);
    expect(body.reminderHour).toBeNull();
    expect(body.defaultDeckId).toBeNull();
  });

  it('returns persisted values after a PATCH', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { GET, PATCH } = await import('@/app/api/flashcards/settings/route');
    await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: 10, reminderHour: 7 }),
      }),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.newPerDay).toBe(10);
    expect(body.reminderHour).toBe(7);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await setUser(null);
    const { GET } = await import('@/app/api/flashcards/settings/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/flashcards/settings', () => {
  it('allows admin to update settings', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: 30, reviewLimit: 150, reminderHour: 9 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.newPerDay).toBe(30);
    expect(body.reviewLimit).toBe(150);
    expect(body.reminderHour).toBe(9);
  });

  it('allows owner to update settings', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: 5 }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects editor with 403', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: 5 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects viewer with 403', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: 5 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects reminderHour out of range → 400', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const r1 = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reminderHour: 24 }),
      }),
    );
    expect(r1.status).toBe(400);

    const r2 = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reminderHour: -1 }),
      }),
    );
    expect(r2.status).toBe(400);
  });

  it('rejects easeStart below 1.3 → 400', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ easeStart: 1.0 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects negative newPerDay → 400', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPerDay: -5 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('round-trips a full settings patch', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { GET, PATCH } = await import('@/app/api/flashcards/settings/route');

    const patch = {
      newPerDay: 15,
      reviewLimit: 100,
      easeStart: 2.0,
      leechThreshold: 5,
      reminderHour: 8,
    };
    const patchRes = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
    expect(patchRes.status).toBe(200);

    const getRes = await GET();
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body.newPerDay).toBe(15);
    expect(body.reviewLimit).toBe(100);
    expect(body.easeStart).toBeCloseTo(2.0);
    expect(body.leechThreshold).toBe(5);
    expect(body.reminderHour).toBe(8);
  });

  it('accepts reminderHour: null to disable reminders', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    await setUser(u.userId);
    const { PATCH } = await import('@/app/api/flashcards/settings/route');

    // Set then clear.
    await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reminderHour: 10 }),
      }),
    );
    const res = await PATCH(
      new Request('http://localhost/api/flashcards/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reminderHour: null }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.reminderHour).toBeNull();
  });
});
