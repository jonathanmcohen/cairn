import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, webhooks, webhook_deliveries, templates, page_versions RESTART IDENTITY CASCADE`;
});

describe('v0.5.0 schema (0012)', () => {
  it('api_keys round-trips with unique token_hash and nullable expiry', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [k] = await db
      .insert(schema.apiKeys)
      .values({
        workspaceId: u.workspaceId,
        name: 'CI',
        tokenHash: 'hash-a',
        tokenPrefix: 'cairn_sk_ab12',
        role: 'editor',
        createdBy: u.userId,
      })
      .returning();
    expect(k?.lastUsedAt).toBeNull();
    expect(k?.expiresAt).toBeNull();
    await expect(
      db.insert(schema.apiKeys).values({
        workspaceId: u.workspaceId,
        name: 'dup',
        tokenHash: 'hash-a',
        tokenPrefix: 'cairn_sk_xxxx',
        role: 'viewer',
        createdBy: u.userId,
      }),
    ).rejects.toThrow();
  });

  it('webhooks + webhook_deliveries cascade from webhook', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [w] = await db
      .insert(schema.webhooks)
      .values({
        workspaceId: u.workspaceId,
        url: 'https://x/y',
        events: ['page.created'],
        secret: 's',
      })
      .returning();
    if (!w) throw new Error('webhook insert failed');
    await db
      .insert(schema.webhookDeliveries)
      .values({ webhookId: w.id, event: 'page.created', payload: { a: 1 }, status: 'pending' });
    await db.delete(schema.webhooks).where(eq(schema.webhooks.id, w.id));
    const left = await db.select().from(schema.webhookDeliveries);
    expect(left).toHaveLength(0);
  });

  it('templates allow null workspace (built-in) and page_versions reference a page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [t] = await db
      .insert(schema.templates)
      .values({ name: 'Meeting notes', kind: 'page', payload: {}, builtIn: true })
      .returning();
    expect(t?.workspaceId).toBeNull();
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('page insert failed');
    const [v] = await db
      .insert(schema.pageVersions)
      .values({ pageId: p.id, content: { type: 'doc' }, authorId: u.userId })
      .returning();
    expect(v?.pageId).toBe(p.id);
  });
});
