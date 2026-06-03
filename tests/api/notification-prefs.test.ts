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
  await sql`TRUNCATE notification_email_prefs, notifications, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
  emailIsEnabled = true;
});

// Auth mock — mirrors tests/api/notifications.test.ts.
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

// Deterministic transport — emailEnabled() follows this toggle.
let emailIsEnabled = true;
vi.mock('@/lib/email/transport', () => ({
  emailEnabled: () => emailIsEnabled,
}));

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function getPrefs() {
  const { GET } = await import('@/app/api/notifications/prefs/route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function putPref(body: unknown) {
  const { PUT } = await import('@/app/api/notifications/prefs/route');
  const res = await PUT(
    new Request('http://localhost/api/notifications/prefs', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

type PrefsBody = {
  prefs: { notificationType: string; emailEnabled: boolean; digestOnly: boolean }[];
  emailEnabled: boolean;
};

describe('GET /api/notifications/prefs', () => {
  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await getPrefs();
    expect(r.status).toBe(401);
  });

  it('returns the full type list with opt-in defaults + the transport emailEnabled flag', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await getPrefs();
    expect(r.status).toBe(200);
    const body = r.body as PrefsBody;
    expect(body.emailEnabled).toBe(true);
    const types = body.prefs.map((p) => p.notificationType).sort();
    // v0.9.9 Plan I (#195) — five emailable types now.
    expect(types).toEqual([
      'comment_reply',
      'mention',
      'page_approval',
      'page_lock',
      'page_status',
    ]);
    for (const p of body.prefs) {
      expect(p.emailEnabled).toBe(false);
      expect(p.digestOnly).toBe(false);
    }
  });

  it('emailEnabled reflects the mocked transport when SMTP is unset', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    emailIsEnabled = false;
    await setUser(me.userId);
    const r = await getPrefs();
    expect(r.status).toBe(200);
    expect((r.body as PrefsBody).emailEnabled).toBe(false);
  });
});

describe('PUT /api/notifications/prefs', () => {
  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await putPref({ notificationType: 'mention', emailEnabled: true, digestOnly: false });
    expect(r.status).toBe(401);
  });

  it('upserts a pref and a follow-up GET reflects it', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const put = await putPref({
      notificationType: 'mention',
      emailEnabled: true,
      digestOnly: false,
    });
    expect(put.status).toBe(200);
    expect((put.body as { ok: boolean }).ok).toBe(true);

    const r = await getPrefs();
    const mention = (r.body as PrefsBody).prefs.find((p) => p.notificationType === 'mention');
    expect(mention?.emailEnabled).toBe(true);
    expect(mention?.digestOnly).toBe(false);
  });

  it('rejects an unknown notificationType with 400', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setUser(me.userId);
    const r = await putPref({ notificationType: 'bogus', emailEnabled: true, digestOnly: false });
    expect(r.status).toBe(400);
  });

  it("does not leak a user's change to another user", async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });

    await setUser(me.userId);
    await putPref({ notificationType: 'mention', emailEnabled: true, digestOnly: true });

    await setUser(other.userId);
    const r = await getPrefs();
    const mention = (r.body as PrefsBody).prefs.find((p) => p.notificationType === 'mention');
    expect(mention?.emailEnabled).toBe(false);
    expect(mention?.digestOnly).toBe(false);
  });
});
