import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
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
        return {
          workspaceId: existingWs.id,
          workspaceSlug: existingWs.slug,
          pageId: page.id,
          databaseId: database.id,
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
      patch: { content: sampleDocument() },
    });

    // Inline database with one extra property, one view, and one row.
    const database = await createDatabase(db, {
      workspaceId: ws.id,
      pageId: page.id,
      createdBy: user.id,
      name: 'A11y Database',
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

    return {
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      pageId: page.id,
      databaseId: database.id,
      userEmail: USER_EMAIL,
      userPassword: USER_PASSWORD,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
