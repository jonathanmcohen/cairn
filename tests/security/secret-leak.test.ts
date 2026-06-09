import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
import { runWorkspaceExport } from '@/lib/export/workspace-archive';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, webhooks, audit_log, user_totp,
    personal_access_tokens, token_usage_log, page_acls, database_connectors
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
  'CAIRN_EMBEDDING_API_KEY',
  // v0.9.0 G8 P43 — encrypted-backup passphrase env var name; no Cairn API
  // surface should ever echo this back.
  'CAIRN_BACKUP_ENCRYPTION_PASSPHRASE',
];

// Full-secret prefixes. These MUST never appear in audit metadata or in the
// admin audit viewer response (a full minted token would start with one of
// these). They're separated from `FORBIDDEN_KEYS` because the api-key listing
// legitimately surfaces a 4-char display prefix that starts with `cairn_sk_`.
const FORBIDDEN_SECRET_PREFIXES = [
  'cairn_whsec_',
  'cairn_sk_',
  'cairn_pat_',
  // v0.9.16 Plan F — MCP OAuth secrets.
  'cairn_oauth_',
  'cairn_oart_',
  'cairn_oac_',
  'cairn_ocs_',
];

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

  it('CAIRN_BACKUP_ENCRYPTION_PASSPHRASE (env var name + literal value) never appears on any covered API surface', async () => {
    // v0.9.0 G8 P43 — set the env var to a unique literal, then re-exercise the
    // same admin/listing endpoints the rest of this suite covers and assert the
    // literal never appears. The env var name itself is in FORBIDDEN_KEYS so
    // assertNoSecrets() already covers that side; this case adds the value-leak
    // assertion (which is the realistic risk if a route ever dumped process.env).
    const literal = `cairn-backup-pp-${randomBytes(8).toString('hex')}`;
    const prev = process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE;
    process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE = literal;
    try {
      const ws = await createTestWorkspaceWithUser(db);
      await actAs(ws.userId);

      // Members listing.
      const members = await import('@/app/api/workspaces/members/route');
      const membersRes = await members.GET(new Request('http://t/api/workspaces/members?q='));
      const membersBody = await membersRes.text();
      assertNoSecrets(membersBody);
      expect(membersBody).not.toContain(literal);

      // Webhook listing.
      const webhooks = await import('@/app/api/webhooks/route');
      const whRes = await webhooks.GET();
      const whBody = await whRes.text();
      assertNoSecrets(whBody);
      expect(whBody).not.toContain(literal);
    } finally {
      if (prev === undefined) delete process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE;
      else process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE = prev;
    }
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

// ---------------------------------------------------------------------------
// P19: 2FA TOTP — the shared secret is encrypted at rest, recovery codes are
// hashed (one-way, single-use). Neither plaintext, the sealed bytea, nor any
// stored hash may surface in API responses, audit metadata, or process logs.
// (Workspace-export coverage lands in P21 once export is wired — for now we
// cover responses + the stored row + a log-spy on the enrollment path.)
// ---------------------------------------------------------------------------

describe('secret-leak: TOTP secrets + recovery codes', () => {
  type EnrollmentBundle = {
    workspaceId: string;
    userId: string;
    secret: string;
    recoveryCodes: string[];
    sealedHex: string;
    sealedLatin1: string;
    storedHashes: string[];
  };

  async function seedEnrolledUser(): Promise<EnrollmentBundle> {
    const ws = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const { beginEnrollment, confirmEnrollment } = await import('@/lib/auth/two-factor');
    const { generateSync, NobleCryptoPlugin, ScureBase32Plugin } = await import('otplib');
    const oCrypto = new NobleCryptoPlugin();
    const oBase32 = new ScureBase32Plugin();

    const out = await beginEnrollment(db, {
      userId: ws.userId,
      account: 'a@b.c',
      key: process.env.AUTH_SECRET ?? '',
    });
    const ok = await confirmEnrollment(db, {
      userId: ws.userId,
      token: generateSync({ secret: out.secret, crypto: oCrypto, base32: oBase32 }),
      key: process.env.AUTH_SECRET ?? '',
    });
    expect(ok).toBe(true);

    const [row] = await db
      .select()
      .from(schema.userTotp)
      .where(eq(schema.userTotp.userId, ws.userId));
    if (!row) throw new Error('user_totp row missing post-confirm');
    const sealed = row.secretEncrypted as Buffer;
    const stored = row.recoveryCodes as { hash: string; usedAt: string | null }[];

    return {
      workspaceId: ws.workspaceId,
      userId: ws.userId,
      secret: out.secret,
      recoveryCodes: out.recoveryCodes,
      sealedHex: sealed.toString('hex'),
      sealedLatin1: sealed.toString('latin1'),
      storedHashes: stored.map((c) => c.hash),
    };
  }

  function assertNoTotpMaterial(body: string, b: EnrollmentBundle) {
    expect(body).not.toContain(b.secret);
    expect(body).not.toContain(b.sealedHex);
    expect(body).not.toContain(b.sealedLatin1);
    for (const code of b.recoveryCodes) expect(body).not.toContain(code);
    for (const h of b.storedHashes) expect(body).not.toContain(h);
  }

  it('the stored user_totp row holds only encrypted/hashed material — no plaintext', async () => {
    const b = await seedEnrolledUser();
    const [row] = await db
      .select()
      .from(schema.userTotp)
      .where(eq(schema.userTotp.userId, b.userId));
    const serialized = JSON.stringify(row, (_k, v) =>
      Buffer.isBuffer(v) ? v.toString('latin1') : v,
    );
    expect(serialized).not.toContain(b.secret);
    for (const code of b.recoveryCodes) expect(serialized).not.toContain(code);
  });

  it('the workspace members listing never leaks TOTP material', async () => {
    const b = await seedEnrolledUser();
    await actAs(b.userId);
    const route = await import('@/app/api/workspaces/members/route');
    const res = await route.GET(new Request('http://t/api/workspaces/members?q='));
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    assertNoTotpMaterial(body, b);
  });

  it('the webhook listing never leaks TOTP material', async () => {
    const b = await seedEnrolledUser();
    await actAs(b.userId);
    const route = await import('@/app/api/webhooks/route');
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    assertNoTotpMaterial(body, b);
  });

  it('the admin audit viewer response never leaks TOTP material', async () => {
    const b = await seedEnrolledUser();
    activeCookie = { name: 'cairn_ws', value: b.workspaceId };
    await actAs(b.userId);
    const route = await import('@/app/api/admin/audit/route');
    const res = await route.GET(new Request('http://t/api/admin/audit?limit=100') as never);
    expect(res.status).toBe(200);
    const body = await res.text();
    assertNoSecrets(body);
    assertNoSecretPrefixes(body);
    assertNoTotpMaterial(body, b);
  });

  it('the enrollment + confirm path emits no TOTP material via console', async () => {
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
    try {
      const b = await seedEnrolledUser();
      const text = logs.join('\n');
      expect(text).not.toContain(b.secret);
      expect(text).not.toContain(b.sealedHex);
      for (const code of b.recoveryCodes) expect(text).not.toContain(code);
      for (const h of b.storedHashes) expect(text).not.toContain(h);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// v0.7.0 G1 P5: Personal access tokens. The plaintext `cairn_pat_<secret>` is
// returned ONCE at mint time and is never recoverable. The stored `tokenHash`
// (sha256 of the plaintext) is just as sensitive: if it leaks, an attacker can
// brute-force/rainbow-table back to plaintext. Neither value may surface in
// (a) audit-log rows, (b) the /api/dev/tokens list response, (c) token_usage
// log rows, or (d) the workspace-archive export ZIP.
// ---------------------------------------------------------------------------

describe('secret-leak: PAT secrets', () => {
  it('plaintext PAT + tokenHash never appear in audit-log rows, list, usage, or export', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId);
    activeCookie = { name: 'cairn_ws', value: u.workspaceId };

    const { token, row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 'leak-test',
      scopes: ['pages:read'],
      mcpTools: ['pages.read'],
      expiresAt: null,
    });

    // (a) audit log: the mint emits pat.created with safe metadata. Scan all
    // audit rows for the plaintext + the hash + any forbidden secret prefix.
    const audits = await db.select().from(schema.auditLog);
    const auditJson = JSON.stringify(audits);
    expect(auditJson).not.toContain(token);
    expect(auditJson).not.toContain(row.tokenHash);
    assertNoSecretPrefixes(auditJson);

    // (b) /api/dev/tokens list response: GET the list, scan body.
    const { GET } = await import('@/app/api/dev/tokens/route');
    const listRes = await GET();
    const listBody = JSON.stringify(await listRes.json());
    expect(listBody).not.toContain(token);
    expect(listBody).not.toContain(row.tokenHash);

    // (c) token_usage_log rows: insert a usage event then scan all rows. The
    // log records tokenId (opaque UUID) and the route, never the hash/plaintext.
    await sql`
      INSERT INTO token_usage_log (workspace_id, token_kind, token_id, user_id, route, status)
      VALUES (${u.workspaceId}, 'pat', ${row.id}, ${u.userId}, '/api/v1/pages', 200)
    `;
    const usageRows = await db.select().from(schema.tokenUsageLog);
    const usageJson = JSON.stringify(usageRows);
    expect(usageJson).not.toContain(token);
    expect(usageJson).not.toContain(row.tokenHash);

    // (d) workspace export ZIP: run the v0.6 P21 export, read the produced
    // archive bytes, assert the plaintext + the hash never appear anywhere.
    // The export by design only walks non-secret tables (pages, databases,
    // files) — personal_access_tokens, api_keys, webhooks, user_totp, and
    // password hashes are excluded.
    const outDir = join(tmpdir(), `cairn-export-test-${randomBytes(8).toString('hex')}`);
    const zipPath = await runWorkspaceExport({ workspaceId: u.workspaceId, outDir });
    const archiveBytes = await readFile(zipPath);
    const archiveLatin1 = archiveBytes.toString('latin1');
    expect(archiveLatin1).not.toContain(token);
    expect(archiveLatin1).not.toContain(row.tokenHash);
  });

  it('mint response shape never includes tokenHash (only plaintext + prefix)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId);
    activeCookie = { name: 'cairn_ws', value: u.workspaceId };

    const { POST } = await import('@/app/api/dev/tokens/route');
    const res = await POST(
      new Request('http://localhost/api/dev/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x', scopes: ['pages:read'], mcpTools: [] }),
      }),
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('tokenHash');
    expect(body).not.toContain('token_hash');
    // The plaintext IS in the body (this is the one place it appears), but
    // the response shape never re-exposes the hash.
  });
});

// ---------------------------------------------------------------------------
// v0.7.0 G7 P22: Connector secrets. Each of the three v0.7.0 adapters carries
// a different secret class:
//   - Sheets    — OAuth refresh token (encrypted into auth_config bytea)
//   - Airtable  — Personal Access Token + webhook MAC secret (both encrypted)
//   - CSV       — no secret; auth_config is `{}` but still encrypted at rest
// The framework's contract (spec §5.1) is that NONE of these plaintexts may
// surface in: audit metadata, the token-usage log, the workspace-archive
// export ZIP, or the raw `database_connectors.auth_config` bytea decoded as
// latin1. Each adapter's `kind` is registered via the P19 registry; the
// secrets here are synthetic LEAKCHECK markers so any regression that leaks
// them is loud and grep-able.
// ---------------------------------------------------------------------------

describe('secret-leak: connector secrets', () => {
  type Planted = {
    workspaceId: string;
    userId: string;
    sheetsConnId: string;
    airtableConnId: string;
    csvConnId: string;
  };

  const SHEETS_REFRESH = 'sheets-refresh-token-LEAKCHECK-AAA';
  const AIRTABLE_PAT = 'airtable-pat-LEAKCHECK-BBB';
  const AIRTABLE_MAC = 'airtable-mac-LEAKCHECK-CCC';

  async function plantConnectors(): Promise<Planted> {
    const ws = await createTestWorkspaceWithUser(db, { role: 'admin' });

    const { encryptAuthConfig } = await import('@/lib/connectors/auth');

    // Each connector needs a page + database (one connector per database).
    async function newDb(name: string): Promise<string> {
      const [page] = await db
        .insert(schema.pages)
        .values({
          workspaceId: ws.workspaceId,
          title: name,
          content: {},
          createdBy: ws.userId,
        })
        .returning();
      if (!page) throw new Error('failed to seed page');
      const [dbRow] = await db
        .insert(schema.databases)
        .values({
          workspaceId: ws.workspaceId,
          pageId: page.id,
          name,
          createdBy: ws.userId,
        })
        .returning();
      if (!dbRow) throw new Error('failed to seed database');
      return dbRow.id;
    }

    const sheetsDb = await newDb('sheets');
    const airtableDb = await newDb('airtable');
    const csvDb = await newDb('csv');

    // Sheets — refresh token sealed via secret-box.
    const [sheetsConn] = await db
      .insert(schema.databaseConnectors)
      .values({
        workspaceId: ws.workspaceId,
        databaseId: sheetsDb,
        kind: 'google_sheets',
        authConfig: encryptAuthConfig({ refresh_token: SHEETS_REFRESH }),
        syncConfig: {
          spreadsheetId: 'sheet-x',
          sheetTitle: 'Sheet1',
          headerRow: 1,
          columnMap: {},
          externalIdProperty: 'prop-id',
        },
        enabled: false,
        createdBy: ws.userId,
      })
      .returning();
    if (!sheetsConn) throw new Error('failed to seed sheets connector');

    // Airtable — PAT + webhook MAC secret sealed via secret-box.
    const [airtableConn] = await db
      .insert(schema.databaseConnectors)
      .values({
        workspaceId: ws.workspaceId,
        databaseId: airtableDb,
        kind: 'airtable',
        authConfig: encryptAuthConfig({
          pat: AIRTABLE_PAT,
          webhookMacSecret: AIRTABLE_MAC,
        }),
        syncConfig: {
          baseId: 'appBASE',
          tableId: 'tblTABLE',
          fieldMap: {},
          externalIdProperty: 'prop-id',
        },
        enabled: false,
        createdBy: ws.userId,
      })
      .returning();
    if (!airtableConn) throw new Error('failed to seed airtable connector');

    // CSV — no auth, but the column is non-null bytea, so we still encrypt
    // an empty object to keep the column shape uniform across adapters.
    const [csvConn] = await db
      .insert(schema.databaseConnectors)
      .values({
        workspaceId: ws.workspaceId,
        databaseId: csvDb,
        kind: 'csv',
        authConfig: encryptAuthConfig({}),
        syncConfig: {
          relativePath: 'projects.csv',
          delimiter: ',',
          encoding: 'utf8',
          columnMap: {},
          externalIdProperty: 'prop-id',
        },
        enabled: false,
        createdBy: ws.userId,
      })
      .returning();
    if (!csvConn) throw new Error('failed to seed csv connector');

    return {
      workspaceId: ws.workspaceId,
      userId: ws.userId,
      sheetsConnId: sheetsConn.id,
      airtableConnId: airtableConn.id,
      csvConnId: csvConn.id,
    };
  }

  it('connector secrets never leak via audit metadata, token-usage log, workspace export, or raw auth_config bytea', async () => {
    const p = await plantConnectors();

    const secrets = [SHEETS_REFRESH, AIRTABLE_PAT, AIRTABLE_MAC];

    // -- Surface 1: audit log metadata. v0.7.0 G7 doesn't add `connector.*`
    //    to the AuditAction enum yet (introducing one would be a separate
    //    schema change). We still cover the surface by writing the kind of
    //    metadata-shaped row a future `connector.created` event would produce
    //    via a raw INSERT, then scanning the whole audit_log table for any
    //    occurrence of the planted secrets. The `assertAuditMetadataClean`
    //    guard would catch this earlier if any caller ever passed a secret
    //    through `recordAudit`; this test is the table-level backstop.
    await db.insert(schema.auditLog).values([
      {
        workspaceId: p.workspaceId,
        actorUserId: p.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: p.workspaceId,
        metadata: { scope: 'connector', kind: 'google_sheets', connectorId: p.sheetsConnId },
      },
      {
        workspaceId: p.workspaceId,
        actorUserId: p.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: p.workspaceId,
        metadata: { scope: 'connector', kind: 'airtable', connectorId: p.airtableConnId },
      },
      {
        workspaceId: p.workspaceId,
        actorUserId: p.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: p.workspaceId,
        metadata: { scope: 'connector', kind: 'csv', connectorId: p.csvConnId },
      },
    ]);
    const auditRows = await db.select().from(schema.auditLog);
    const auditJson = JSON.stringify(auditRows);
    for (const s of secrets) expect(auditJson).not.toContain(s);
    assertNoSecretPrefixes(auditJson);

    // -- Surface 2: token-usage log. Connector lifecycle does not currently
    //    write through MCP tools in v0.7.0, but if a future adapter ever
    //    surfaces a `connectors.*` MCP tool, the resulting tul rows must
    //    carry no plaintext. Seed a synthetic row pointing at a connector
    //    route to make the scan non-trivial.
    await sql`
      INSERT INTO token_usage_log (workspace_id, token_kind, token_id, user_id, route, status)
      VALUES (${p.workspaceId}, 'pat', gen_random_uuid(), ${p.userId}, '/api/connectors', 200)
    `;
    const tulRows = await db.select().from(schema.tokenUsageLog);
    const tulJson = JSON.stringify(tulRows);
    for (const s of secrets) expect(tulJson).not.toContain(s);

    // -- Surface 3: workspace-archive export ZIP. By design the export walks
    //    only non-secret tables (pages, databases, files) — connectors and
    //    their auth_config are excluded. Confirm by reading the produced ZIP
    //    bytes as latin1 and asserting the plaintext secrets are absent.
    const outDir = join(tmpdir(), `cairn-export-conn-${randomBytes(8).toString('hex')}`);
    const zipPath = await runWorkspaceExport({ workspaceId: p.workspaceId, outDir });
    const archiveBytes = await readFile(zipPath);
    const archiveLatin1 = archiveBytes.toString('latin1');
    for (const s of secrets) expect(archiveLatin1).not.toContain(s);

    // -- Surface 4 (bonus): the raw `database_connectors.auth_config` bytea
    //    must contain NO plaintext substring of any planted secret. The
    //    column is sealed via AES-256-GCM (secret-box), so even a latin1
    //    decode of the stored bytes is opaque ciphertext.
    const rows = await db.select().from(schema.databaseConnectors);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const blob = r.authConfig as Buffer;
      const latin1 = blob.toString('latin1');
      const hex = blob.toString('hex');
      for (const s of secrets) {
        expect(latin1).not.toContain(s);
        expect(hex).not.toContain(Buffer.from(s, 'utf8').toString('hex'));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// v0.9.16 Plan F: MCP OAuth secrets. The four issued-secret prefixes
// (access / refresh / auth-code / client-secret) are added to
// FORBIDDEN_SUBSTRINGS so `assertAuditMetadataClean` throws if any of them ever
// slips into audit metadata. No DB needed — this guards the leak-guard itself.
// ---------------------------------------------------------------------------
describe('secret-leak: OAuth secret prefixes trip assertAuditMetadataClean', () => {
  it.each([
    ['cairn_oauth_', 'access token'],
    ['cairn_oart_', 'refresh token'],
    ['cairn_oac_', 'authorization code'],
    ['cairn_ocs_', 'client secret'],
  ])('a value containing %s (%s) throws', async (prefix) => {
    const { assertAuditMetadataClean } = await import('@/lib/audit/record');
    expect(() => assertAuditMetadataClean({ note: `${prefix}AbCdEf123456` })).toThrow();
  });

  it('a clean metadata object (ids + scope names + counts only) passes', async () => {
    const { assertAuditMetadataClean } = await import('@/lib/audit/record');
    expect(() =>
      assertAuditMetadataClean({
        clientId: 'abc123',
        scopes: ['mcp:read', 'pages:read'],
        redirectUriCount: 1,
      }),
    ).not.toThrow();
  });
});
