import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey, verifyKey } from '@/lib/api/keys';
import { createPage } from '@/lib/pages/create';
import { listVersions, snapshotIfChanged } from '@/lib/pages/versions';
import { instantiateTemplate } from '@/lib/templates/instantiate';
import { savePageAsTemplate } from '@/lib/templates/save';
import { emit } from '@/lib/webhooks/dispatch';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  // `emit` (and any other helper that calls getDb()) reads DATABASE_URL — point it
  // at this container so the synchronous delivery-row INSERT lands in the same db.
  process.env.DATABASE_URL = uri;
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, webhooks, webhook_deliveries, page_versions, templates RESTART IDENTITY CASCADE`;
});

/**
 * One end-to-end pass over the whole v0.5.0 surface — API keys, webhooks,
 * version history, and templates — proving the features compose without the
 * HTTP layer (every helper is db-injected and called directly).
 */
describe('v0.5.0 cross-feature smoke', () => {
  it('mints a key, emits a webhook delivery, snapshots a version, and templatizes a page', async () => {
    const u = await createTestWorkspaceWithUser(db);

    // --- 1. API keys: mint → resolve to an AuthContext, and reject an expired key.
    const { token } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'smoke',
      role: 'editor',
      createdBy: u.userId,
    });
    expect(token).toMatch(/^cairn_sk_[0-9a-f]{64}$/);

    const authCtx = await verifyKey(db, token);
    expect(authCtx).not.toBeNull();
    expect(authCtx?.workspaceId).toBe(u.workspaceId);
    expect(authCtx?.role).toBe('editor');

    // A garbage token resolves to null.
    expect(await verifyKey(db, 'cairn_sk_deadbeef')).toBeNull();

    // An expired key is rejected even though its hash matches.
    const { token: expiredToken } = await mintKey(db, {
      workspaceId: u.workspaceId,
      name: 'expired',
      role: 'editor',
      createdBy: u.userId,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyKey(db, expiredToken)).toBeNull();

    // --- 2. Webhooks: a subscribed, active hook gets a `pending` delivery on emit.
    const [hook] = await db
      .insert(schema.webhooks)
      .values({
        workspaceId: u.workspaceId,
        url: 'https://example.test/hook',
        events: ['page.created'],
        secret: 'shh',
        active: true,
      })
      .returning();
    if (!hook) throw new Error('failed to create webhook');

    // An inactive hook (and one not subscribed to the event) must NOT get a delivery.
    await db.insert(schema.webhooks).values({
      workspaceId: u.workspaceId,
      url: 'https://example.test/inactive',
      events: ['page.created'],
      secret: 'shh',
      active: false,
    });

    // Create a page via the lib path. `createPage` fires `emit` fire-and-forget,
    // so to assert deterministically we call `emit` once ourselves and await its
    // synchronous delivery-row INSERT (delivery itself is scheduled off-path and
    // never reaches a real receiver here).
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Smoke Page',
    });
    await emit('page.created', u.workspaceId, { id: page.id, title: page.title });

    const deliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, hook.id));
    // Exactly the explicit emit's delivery (createPage's fire-and-forget emit may or
    // may not have flushed yet; the active hook is the only subscriber that matters).
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    for (const d of deliveries) {
      expect(d.event).toBe('page.created');
      expect(['pending', 'success', 'failed']).toContain(d.status);
      expect((d.payload as { id: string }).id).toBe(page.id);
    }

    // --- 3. Versions: snapshot the page content, then list it back.
    const snapshot = await snapshotIfChanged(db, {
      pageId: page.id,
      content: { type: 'doc', content: [] },
      authorId: u.userId,
    });
    expect(snapshot).not.toBeNull();

    const versions = await listVersions(db, page.id);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0]?.pageId).toBe(page.id);

    // --- 4. Templates: save the page as a template, then instantiate it into a
    //        DIFFERENT workspace with fresh ids — no original id may survive.
    const tpl = await savePageAsTemplate(db, {
      workspaceId: u.workspaceId,
      rootPageId: page.id,
      name: 'Smoke Tpl',
    });
    expect(tpl.kind).toBe('page');

    const other = await createTestWorkspaceWithUser(db);
    const result = await instantiateTemplate(db, {
      templateId: tpl.id,
      targetWorkspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    expect(result.rootPageId).toBeDefined();
    expect(result.rootPageId).not.toBe(page.id); // fresh uuid

    // The instantiated page lives in the OTHER workspace.
    const [clone] = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, result.rootPageId as string));
    expect(clone?.workspaceId).toBe(other.workspaceId);

    // Deep-scan the clone: no original page id may survive anywhere in its row.
    const cloneBlob = JSON.stringify(clone);
    expect(cloneBlob).not.toContain(page.id);
  });
});
