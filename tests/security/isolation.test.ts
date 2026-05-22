import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';
import { ISOLATION_CASES, type SeededIds, tableExists } from './helpers';

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function actAs(userId: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts,
    databases, db_properties, db_rows, db_cells, db_views, comments, files, notifications,
    api_keys, webhooks, templates, page_versions RESTART IDENTITY CASCADE`;
});

const SECRET = 'b-secret-marker';

/** Seed a fully-populated workspace B and return the id bag the table consumes. */
async function seedWorkspaceB(): Promise<SeededIds> {
  const db = getDb();
  const owner = await createTestWorkspaceWithUser(db, { email: 'b-owner@x.com' });

  const page = await createPage(db, {
    workspaceId: owner.workspaceId,
    createdBy: owner.userId,
    title: `B ${SECRET} page`,
  });

  const [database] = await db
    .insert(schema.databases)
    .values({
      workspaceId: owner.workspaceId,
      pageId: page.id,
      name: `B ${SECRET} db`,
      createdBy: owner.userId,
    })
    .returning();
  if (!database) throw new Error('seed database failed');

  const [property] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: `${SECRET} prop`, type: 'text', position: 0 })
    .returning();
  if (!property) throw new Error('seed property failed');

  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId: database.id, createdBy: owner.userId })
    .returning();
  if (!row) throw new Error('seed row failed');

  const [view] = await db
    .insert(schema.dbViews)
    .values({ databaseId: database.id, type: 'table', name: `${SECRET} view`, position: 0 })
    .returning();
  if (!view) throw new Error('seed view failed');

  const [comment] = await db
    .insert(schema.comments)
    .values({
      workspaceId: owner.workspaceId,
      pageId: page.id,
      authorId: owner.userId,
      body: `${SECRET} comment`,
    })
    .returning();
  if (!comment) throw new Error('seed comment failed');

  const [file] = await db
    .insert(schema.files)
    .values({
      workspaceId: owner.workspaceId,
      pageId: page.id,
      name: `${SECRET}.txt`,
      mimeType: 'text/plain',
      size: 3,
      path: `${owner.workspaceId}/secret.txt`,
      uploadedBy: owner.userId,
    })
    .returning();
  if (!file) throw new Error('seed file failed');

  const [notification] = await db
    .insert(schema.notifications)
    .values({
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      type: 'mention',
      payload: { pageId: page.id, commentId: comment.id, actorId: owner.userId },
    })
    .returning();
  if (!notification) throw new Error('seed notification failed');

  const [apiKey] = await db
    .insert(schema.apiKeys)
    .values({
      workspaceId: owner.workspaceId,
      name: `${SECRET} key`,
      tokenHash: `hash-${SECRET}`,
      tokenPrefix: 'cairn_',
      role: 'admin',
      createdBy: owner.userId,
    })
    .returning();
  if (!apiKey) throw new Error('seed api key failed');

  const [webhook] = await db
    .insert(schema.webhooks)
    .values({
      workspaceId: owner.workspaceId,
      url: 'https://example.com/hook',
      events: ['page.created'],
      secret: `${SECRET}-whsecret`,
    })
    .returning();
  if (!webhook) throw new Error('seed webhook failed');

  const [template] = await db
    .insert(schema.templates)
    .values({
      workspaceId: owner.workspaceId,
      name: `${SECRET} template`,
      kind: 'page',
      payload: { title: SECRET },
    })
    .returning();
  if (!template) throw new Error('seed template failed');

  const [pageVersion] = await db
    .insert(schema.pageVersions)
    .values({ pageId: page.id, content: { secret: SECRET }, authorId: owner.userId })
    .returning();
  if (!pageVersion) throw new Error('seed page version failed');

  return {
    workspaceId: owner.workspaceId,
    pageId: page.id,
    databaseId: database.id,
    propertyId: property.id,
    rowId: row.id,
    viewId: view.id,
    commentId: comment.id,
    fileId: file.id,
    notificationId: notification.id,
    apiKeyId: apiKey.id,
    webhookId: webhook.id,
    templateId: template.id,
    pageVersionId: pageVersion.id,
  };
}

describe('cross-workspace isolation (existence never leaked)', () => {
  for (const c of ISOLATION_CASES) {
    const allowed = c.expect ?? [404];

    it(`reads of B.${c.name} from A are denied (${allowed.join('/')}, no leak)`, async () => {
      if (c.requires && !(await tableExists(getDb(), c.requires))) return; // surface absent
      const b = await seedWorkspaceB();
      const attacker = await createTestWorkspaceWithUser(getDb(), { email: 'attacker@x.com' });
      await actAs(attacker.userId);

      const res = await c.read.run(b);
      const text = await res.text();
      // Notifications list legitimately returns 200 for the empty/own list, but
      // must never contain B's notification or any secret marker.
      if (c.name === 'notifications') {
        expect(res.status).toBe(200);
        expect(text).not.toContain(b.notificationId);
      } else {
        expect(allowed).toContain(res.status);
      }
      expect(text).not.toContain(SECRET);
    });

    if (c.mutate) {
      it(`mutations of B.${c.name} from A are denied (${allowed.join('/')}, no write)`, async () => {
        if (c.requires && !(await tableExists(getDb(), c.requires))) return;
        const b = await seedWorkspaceB();
        const attacker = await createTestWorkspaceWithUser(getDb(), { email: 'attacker@x.com' });
        await actAs(attacker.userId);

        const mutate = c.mutate;
        if (!mutate) throw new Error('unreachable');
        const res = await mutate.run(b);
        const text = await res.text();
        // Notification /read POST is scoped to (userId): a foreign id updates 0
        // rows, returning 200 with { updated: 0 } — that is the non-leak.
        if (c.name === 'notifications') {
          expect(res.status).toBe(200);
          expect(text).toContain('"updated":0');
        } else {
          expect(allowed).toContain(res.status);
        }
        expect(text).not.toContain(SECRET);
      });
    }
  }

  it('a verified self-read of B as B owner succeeds (sanity: seed is real)', async () => {
    const b = await seedWorkspaceB();
    const owner = (
      await getDb()
        .select()
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, b.workspaceId))
    )[0];
    if (!owner) throw new Error('owner missing');
    await actAs(owner.userId);
    const m = await import('@/app/api/pages/[pageId]/route');
    const res = await m.GET(new Request(`http://t/api/pages/${b.pageId}`), {
      params: Promise.resolve({ pageId: b.pageId }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(SECRET); // B sees its own data — proves the deny tests aren't trivially green
  });
});
