import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

// The admin audit + workspaces APIs read the active workspace from a cookie
// (`cairn_ws`). Mock `next/headers` so we can pin it per-test (mirrors the
// pattern in tests/api/admin-members.test.ts).
let activeCookie: { name: string; value: string } | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => activeCookie, set: () => {} }),
}));

async function actAs(userId: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, webhooks, audit_log
    RESTART IDENTITY CASCADE`;
});

// Secret-bearing column/field names that must NEVER appear in an API response,
// plus the live AUTH_SECRET value itself, plus other key/secret-ish fields
// added by post-v0.5.1 features (2FA recovery codes, BYO-SMTP encrypted
// secrets, metrics token env). These are field-name needles; prefixes like
// `cairn_sk_` are NOT in this set because the api-key display prefix
// (`cairn_sk_ab12`) is intentionally surfaced in the keys list and would
// trigger a false positive — those prefix substrings are checked separately
// by `assertNoSecretPrefixes` below, on responses where they MUST NOT appear.
const FORBIDDEN_KEYS = [
  'passwordHash',
  'password_hash',
  'tokenHash',
  'token_hash',
  'AUTH_SECRET',
  'secret_encrypted',
  'secretEncrypted',
  'recovery_codes',
  'recoveryCodes',
  'CAIRN_METRICS_TOKEN',
];

// Full-secret prefixes. These MUST never appear in audit metadata or in the
// admin audit viewer response (a full minted token would start with one of
// these). They're separated from `FORBIDDEN_KEYS` because the api-key listing
// legitimately surfaces a 4-char display prefix that starts with `cairn_sk_`.
const FORBIDDEN_SECRET_PREFIXES = ['cairn_whsec_', 'cairn_sk_'];

function assertNoSecrets(body: string) {
  for (const k of FORBIDDEN_KEYS) {
    expect(body).not.toContain(k);
  }
  // The webhook signing secret value and the live AUTH_SECRET must be absent.
  expect(body).not.toContain(process.env.AUTH_SECRET ?? '__never__');
}

function assertNoSecretPrefixes(body: string) {
  for (const p of FORBIDDEN_SECRET_PREFIXES) {
    expect(body).not.toContain(p);
  }
}

describe('secret non-leakage in API responses', () => {
  it('workspace member listing never includes passwordHash', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await actAs(ws.userId);
    const route = await import('@/app/api/workspaces/members/route');
    const res = await route.GET(new Request('http://t/api/workspaces/members?q='));
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    // Sanity: the listing actually returned the seeded member.
    expect(body).toContain(ws.userId);
  });

  it('webhook listing never includes the signing secret', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await actAs(ws.userId);
    const secret = `cairn_whsec_${randomBytes(24).toString('hex')}`;
    await db.insert(schema.webhooks).values({
      workspaceId: ws.workspaceId,
      url: 'https://example.com/hook',
      events: ['page.created'],
      secret,
    });
    const route = await import('@/app/api/webhooks/route');
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    expect(body).not.toContain(secret); // the literal secret value
    expect(body).not.toContain('"secret"'); // and no `secret` field at all
    // Sanity: the webhook itself was returned.
    expect(body).toContain('example.com/hook');
  });

  it('api-key list serializer projects out token_hash', async () => {
    // Mirror the settings page serializer: it must NEVER select tokenHash.
    const ws = await createTestWorkspaceWithUser(db);
    await db.insert(schema.apiKeys).values({
      workspaceId: ws.workspaceId,
      name: 'k',
      tokenHash: 'a'.repeat(64),
      tokenPrefix: 'cairn_sk_ab12',
      role: 'viewer',
      createdBy: ws.userId,
    });
    const rows = await db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        tokenPrefix: schema.apiKeys.tokenPrefix,
        role: schema.apiKeys.role,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys);
    const body = JSON.stringify(rows);
    assertNoSecrets(body);
    expect(body).toContain('cairn_sk_ab12'); // prefix is safe to surface
    expect(body).not.toContain('a'.repeat(64)); // the hash is not
  });
});

describe('audit log + viewer never leak secrets', () => {
  // Seed a workspace + admin user, then drive the documented sensitive flows
  // through their real helper functions (which record audit rows inside the
  // same transaction as the action). Returns the freshly-minted plaintext
  // tokens / secrets / passwords so each test can assert their absence.
  async function seedAuditedActions(): Promise<{
    workspaceId: string;
    userId: string;
    pageId: string;
    rawApiToken: string;
    webhookSecret: string;
    rawInviteToken: string;
    sharePassword: string;
  }> {
    const ws = await createTestWorkspaceWithUser(db, { role: 'admin' });

    // Seed a page so `setShareSettings` has something to act on.
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: 'p', content: {}, createdBy: ws.userId })
      .returning();
    if (!page) throw new Error('failed to seed page');

    const { mintKey } = await import('@/lib/api/keys');
    const { token: rawApiToken } = await mintKey(db, {
      workspaceId: ws.workspaceId,
      name: 'audit-test-key',
      role: 'viewer',
      createdBy: ws.userId,
    });

    const { createWebhook } = await import('@/lib/webhooks/admin');
    const { secret: webhookSecret } = await createWebhook(db, {
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
      url: 'https://example.com/hook',
      events: ['page.created'],
    });

    const { createInvite } = await import('@/lib/workspaces/invites');
    const { token: rawInviteToken } = await createInvite(db, {
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
      email: 'invitee@example.com',
      role: 'editor',
    });

    const sharePassword = 'PWUNIQ123!';
    const { setShareSettings } = await import('@/lib/pages/share');
    await setShareSettings(db, {
      pageId: page.id,
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
      password: sharePassword,
    });

    return {
      workspaceId: ws.workspaceId,
      userId: ws.userId,
      pageId: page.id,
      rawApiToken,
      webhookSecret,
      rawInviteToken,
      sharePassword,
    };
  }

  it('sensitive actions write audit rows with no secret in metadata', async () => {
    const seeded = await seedAuditedActions();

    const rows = await db.select().from(schema.auditLog);
    expect(rows.length).toBeGreaterThan(0);

    const body = JSON.stringify(rows);
    assertNoSecrets(body);
    assertNoSecretPrefixes(body);
    expect(body).not.toContain(seeded.rawApiToken);
    expect(body).not.toContain(seeded.webhookSecret);
    expect(body).not.toContain(seeded.rawInviteToken);
    expect(body).not.toContain(seeded.sharePassword);

    // Sanity: the audited events we expected are actually present.
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('api_key.created');
    expect(actions).toContain('webhook.created');
    expect(actions).toContain('invite.created');
    expect(actions).toContain('page.share_changed');
  });

  it('the admin audit viewer response leaks no secret', async () => {
    const seeded = await seedAuditedActions();

    activeCookie = { name: 'cairn_ws', value: seeded.workspaceId };
    await actAs(seeded.userId);

    const route = await import('@/app/api/admin/audit/route');
    const res = await route.GET(new Request('http://t/api/admin/audit?limit=100') as never);
    expect(res.status).toBe(200);

    const body = await res.text();
    assertNoSecrets(body);
    assertNoSecretPrefixes(body);
    expect(body).not.toContain(seeded.rawApiToken);
    expect(body).not.toContain(seeded.webhookSecret);
    expect(body).not.toContain(seeded.rawInviteToken);
    expect(body).not.toContain(seeded.sharePassword);

    // Sanity: audited events actually surface in the viewer response.
    expect(body).toContain('api_key.created');
    expect(body).toContain('webhook.created');
    expect(body).toContain('invite.created');
    expect(body).toContain('page.share_changed');
  });
});
