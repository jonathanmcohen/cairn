import { getSchema } from '@tiptap/core';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { schemaExtensions } from '@/components/editor/schema';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { createRow } from '@/lib/databases/rows';
import { createView } from '@/lib/databases/views';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';

export type SeededA11y = {
  workspaceId: string;
  workspaceSlug: string;
  pageId: string;
  databaseId: string;
  webhookId: string;
  userEmail: string;
  userPassword: string;
};

const USER_EMAIL = 'a11y@cairn.test';
const USER_PASSWORD = 'a11y-password-123';
const WORKSPACE_SLUG = 'a11y';
const WORKSPACE_NAME = 'A11y Workspace';

/** A small but real ProseMirror document so the editor page renders content. */
function sampleDocument(): unknown {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'This page is seeded for the accessibility gate.' }],
      },
    ],
  };
}

/**
 * Page document with an inline `database` node, so the editor renders the
 * database block and its `<table>` view (the a11y target for the database
 * spec). Atom node carrying the `databaseId` attribute, matching the schema
 * in `src/components/editor/database-node.ts`.
 */
function documentWithDatabase(databaseId: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Welcome' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'This page is seeded for the accessibility gate.' }],
      },
      { type: 'database', attrs: { databaseId } },
    ],
  };
}

/**
 * Build the Hocuspocus-compatible Yjs binary for a ProseMirror JSON doc using
 * the server-safe editor schema. The harness pre-seeds `page_yjs.state` with
 * this so the editor renders the inline database (and any other custom nodes)
 * even when the test app cannot reach a Hocuspocus collab server — without it
 * the editor's empty-doc seed never fires (it depends on `provider.synced`)
 * and the `<table>` block under audit never mounts.
 */
function buildYjsState(doc: Record<string, unknown>): Buffer {
  const pmSchema = getSchema(schemaExtensions());
  const ydoc = prosemirrorJSONToYDoc(pmSchema, doc, 'default');
  const update = Y.encodeStateAsUpdate(ydoc);
  return Buffer.from(update);
}

/**
 * Idempotent webhook seed for the a11y workspace. Reuses an existing webhook if
 * one already exists (we filter by the deterministic `url` we plant here), else
 * inserts one. Returns the webhook id.
 */
async function ensureSeedWebhook(
  db: PostgresJsDatabase<typeof schema>,
  args: { workspaceId: string },
): Promise<string> {
  const URL = 'https://example.invalid/a11y-hook';
  const [existing] = await db
    .select({ id: schema.webhooks.id })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.workspaceId, args.workspaceId))
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(schema.webhooks)
    .values({
      workspaceId: args.workspaceId,
      url: URL,
      events: ['page.created'],
      // The a11y harness never verifies the signature against this; any
      // 32+ byte hex string is sufficient for the server-side signBody call.
      secret: 'a11y-test-secret-0123456789abcdef0123456789abcdef',
      active: true,
    })
    .returning({ id: schema.webhooks.id });
  if (!inserted) throw new Error('failed to insert seed webhook');
  return inserted.id;
}

/**
 * Idempotent delivery row for the seeded webhook so the deliveries page has at
 * least one row to render.
 */
async function ensureSeedDelivery(
  db: PostgresJsDatabase<typeof schema>,
  args: { webhookId: string },
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.webhookId, args.webhookId))
    .limit(1);
  if (existing) return;
  await db.insert(schema.webhookDeliveries).values({
    webhookId: args.webhookId,
    event: 'page.created',
    payload: { pageId: '00000000-0000-0000-0000-000000000000' },
    status: 'success',
    attempts: 1,
    lastStatus: 200,
    deliveredAt: new Date(),
  });
}

/**
 * Seed a deterministic workspace + page + inline database into the DB the booted
 * app points at (DATABASE_URL). Idempotent: if the deterministic user already
 * exists we resolve and return the existing ids instead of re-creating. Reuses
 * the app's real creators (hashPassword, createPage, createDatabase, createView,
 * createRow) rather than raw SQL so the seed stays faithful to production writes.
 */
export async function seedA11yFixtures(databaseUrl: string): Promise<SeededA11y> {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { schema }) as unknown as PostgresJsDatabase<typeof schema>;

  try {
    // Idempotency: if the user + workspace already exist, resolve and return.
    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, USER_EMAIL))
      .limit(1);
    const [existingWs] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, WORKSPACE_SLUG))
      .limit(1);

    if (existingUser && existingWs) {
      const [page] = await db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(eq(schema.pages.workspaceId, existingWs.id))
        .limit(1);
      const [database] = await db
        .select({ id: schema.databases.id })
        .from(schema.databases)
        .where(eq(schema.databases.workspaceId, existingWs.id))
        .limit(1);
      if (page && database) {
        // Ensure the page content embeds the database node, so the editor
        // renders the inline database surface for the a11y spec. Idempotent
        // re-write: if a prior seed left the page with the legacy
        // database-less document, refresh it here. We also pre-seed the
        // `page_yjs.state` Hocuspocus-persisted binary directly from this
        // ProseMirror JSON, because the test app cannot reach a Hocuspocus
        // collab server — without a pre-seeded Yjs state the editor stays
        // in "Connecting…" and never renders the inline database block.
        const doc = documentWithDatabase(database.id);
        await updatePage(db, {
          pageId: page.id,
          workspaceId: existingWs.id,
          byUserId: existingUser.id,
          adminOverride: true,
          patch: { content: doc },
        });
        const state = buildYjsState(doc);
        await db
          .insert(schema.pageYjs)
          .values({ pageId: page.id, state })
          .onConflictDoUpdate({
            target: schema.pageYjs.pageId,
            set: { state, updatedAt: new Date() },
          });
        const webhookId = await ensureSeedWebhook(db, { workspaceId: existingWs.id });
        await ensureSeedDelivery(db, { webhookId });
        return {
          workspaceId: existingWs.id,
          workspaceSlug: existingWs.slug,
          pageId: page.id,
          databaseId: database.id,
          webhookId,
          userEmail: USER_EMAIL,
          userPassword: USER_PASSWORD,
        };
      }
    }

    // Fresh seed.
    const [ws] =
      existingWs != null
        ? [existingWs]
        : await db
            .insert(schema.workspaces)
            .values({ name: WORKSPACE_NAME, slug: WORKSPACE_SLUG })
            .returning();
    if (!ws) throw new Error('failed to create workspace');

    const passwordHash = await hashPassword(USER_PASSWORD);
    const [user] =
      existingUser != null
        ? [existingUser]
        : await db
            .insert(schema.users)
            .values({ email: USER_EMAIL, passwordHash, name: 'A11y User' })
            .returning();
    if (!user) throw new Error('failed to create user');

    // Owner membership (only if missing).
    const [membership] = await db
      .select({ userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, ws.id))
      .limit(1);
    if (!membership) {
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
    }

    // Page with simple content.
    const page = await createPage(db, {
      workspaceId: ws.id,
      createdBy: user.id,
      title: 'A11y Page',
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: ws.id,
      byUserId: user.id,
      adminOverride: true,
      patch: { content: sampleDocument() },
    });

    // Inline database with one extra property, one view, and one row.
    const database = await createDatabase(db, {
      workspaceId: ws.id,
      pageId: page.id,
      createdBy: user.id,
      name: 'A11y Database',
    });
    // Re-write the page content to include the database node so the editor
    // renders the inline `<table>` view of the database — the surface the
    // database a11y spec targets. Also pre-seed `page_yjs.state` from the
    // same JSON so the editor renders the content even though the test app
    // can't reach a Hocuspocus collab server.
    const doc = documentWithDatabase(database.id);
    await updatePage(db, {
      pageId: page.id,
      workspaceId: ws.id,
      byUserId: user.id,
      adminOverride: true,
      patch: { content: doc },
    });
    const state = buildYjsState(doc);
    await db
      .insert(schema.pageYjs)
      .values({ pageId: page.id, state })
      .onConflictDoUpdate({
        target: schema.pageYjs.pageId,
        set: { state, updatedAt: new Date() },
      });
    // One extra property beyond the default "Name" column.
    await createProperty(db, {
      databaseId: database.id,
      workspaceId: ws.id,
      name: 'Status',
      type: 'text',
    });
    // One additional view alongside the default table view createDatabase made.
    await createView(db, {
      databaseId: database.id,
      workspaceId: ws.id,
      type: 'table',
      name: 'All',
    });
    // One row.
    await createRow(db, {
      databaseId: database.id,
      workspaceId: ws.id,
      createdBy: user.id,
    });

    const webhookId = await ensureSeedWebhook(db, { workspaceId: ws.id });
    await ensureSeedDelivery(db, { webhookId });

    return {
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      pageId: page.id,
      databaseId: database.id,
      webhookId,
      userEmail: USER_EMAIL,
      userPassword: USER_PASSWORD,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
