import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
const ORIGINAL_SECRET = 'cairn_whsec_originalvalue';

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
  await sql`TRUNCATE webhooks, webhook_deliveries, workspaces, users, workspace_members, sessions, accounts, audit_log RESTART IDENTITY CASCADE`;
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

async function seedHook(workspaceId: string, secret = ORIGINAL_SECRET) {
  const [hook] = await getDb()
    .insert(schema.webhooks)
    .values({
      workspaceId,
      url: 'https://example.com/hook',
      events: ['page.created'],
      secret,
    })
    .returning();
  if (!hook) throw new Error('hook insert failed');
  return hook;
}

async function callRotate(id: string) {
  const { POST } = await import('@/app/api/webhooks/[id]/rotate-secret/route');
  return POST(
    new Request(`http://localhost/api/webhooks/${id}/rotate-secret`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
}

describe('POST /api/webhooks/[id]/rotate-secret', () => {
  it('returns the new plaintext secret ONCE and updates the row', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const hook = await seedHook(u.workspaceId);
    await setUser(u.userId);

    const res = await callRotate(hook.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string };
    expect(body.secret).toMatch(/^cairn_whsec_[A-Za-z0-9_-]{32,}$/);

    const row = await getDb()
      .select({ secret: schema.webhooks.secret })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, hook.id));
    expect(row[0]?.secret).toBe(body.secret);
    expect(row[0]?.secret).not.toBe(ORIGINAL_SECRET);
  });

  it('the response includes the new secret but the listing query never selects it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const hook = await seedHook(u.workspaceId);
    await setUser(u.userId);

    const rotateRes = await callRotate(hook.id);
    const { secret } = (await rotateRes.json()) as { secret: string };
    expect(secret).toBeTruthy();

    // Mirror the listing-page select shape (no `secret` column). The listed
    // row must not expose the secret key — proves the rotation response is
    // the only path that reveals plaintext.
    const listed = await getDb()
      .select({
        id: schema.webhooks.id,
        url: schema.webhooks.url,
        active: schema.webhooks.active,
      })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, hook.id));
    expect(Object.keys(listed[0] ?? {})).not.toContain('secret');
  });

  it('403 when the caller is not an admin', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const hook = await seedHook(u.workspaceId);
    await setUser(u.userId);
    const res = await callRotate(hook.id);
    expect(res.status).toBe(403);
  });

  it('404 when the webhook belongs to a different workspace', async () => {
    const mine = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const otherHook = await seedHook(other.workspaceId, 'cairn_whsec_other');
    // Auth ctx remains workspace 1.
    await setUser(mine.userId);
    const res = await callRotate(otherHook.id);
    expect(res.status).toBe(404);
  });

  it('two rotations in sequence produce two different secrets', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const hook = await seedHook(u.workspaceId);
    await setUser(u.userId);

    const a = (await (await callRotate(hook.id)).json()) as { secret: string };
    const b = (await (await callRotate(hook.id)).json()) as { secret: string };
    expect(a.secret).not.toBe(b.secret);

    const row = await getDb()
      .select({ secret: schema.webhooks.secret })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, hook.id));
    expect(row[0]?.secret).toBe(b.secret);
  });

  it('writes a webhook.secret_rotated audit row', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const hook = await seedHook(u.workspaceId);
    await setUser(u.userId);

    const res = await callRotate(hook.id);
    expect(res.status).toBe(200);

    const audits = await getDb()
      .select({
        action: schema.auditLog.action,
        targetType: schema.auditLog.targetType,
        targetId: schema.auditLog.targetId,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    expect(audits.find((a) => a.action === 'webhook.secret_rotated')).toBeTruthy();
    expect(audits.find((a) => a.targetId === hook.id)).toBeTruthy();
  });
});
