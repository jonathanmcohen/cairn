/**
 * Seed a single published page with the fixed slug `v08-lhci-seed-slug` so
 * Lighthouse CI has a reproducible URL to scrape. Idempotent: if the page
 * already exists, only its publication state is refreshed.
 *
 * Invoked by `.github/workflows/lighthouse.yml` after migrations apply, but
 * before `lhci autorun` boots `pnpm start`. Run locally via:
 *   `source ~/.zshenv && pnpm exec tsx scripts/seed-lhci.ts`
 *
 * v0.8.0 G2 P7: relative imports (no `@/` alias) so this script runs under
 * `tsx` without a tsconfig-paths shim — the same pattern as `src/db/migrate.ts`.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema/index.js';

const PUBLIC_SLUG = 'v08-lhci-seed-slug';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to seed the LHCI page');
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });

  try {
    // Ensure at least one user + workspace exist; the LHCI page belongs to
    // the first user / first workspace we find or create. We bootstrap a
    // minimal set so the workflow can land in a fresh Postgres.
    const existingUsers = await db.select().from(schema.users).limit(1);
    let userId = existingUsers[0]?.id;
    if (!userId) {
      const [u] = await db
        .insert(schema.users)
        .values({
          email: 'lhci@cairn.test',
          // Not a real argon2 hash — this user only exists to satisfy the
          // FK on pages.created_by; LHCI scrapes the unauthenticated public
          // route `/p/<slug>`, so the user never logs in.
          passwordHash: 'argon2$lhci-only-not-real',
          name: 'LHCI Fixture',
        })
        .returning({ id: schema.users.id });
      if (!u) throw new Error('failed to create LHCI user');
      userId = u.id;
    }

    const existingWorkspaces = await db.select().from(schema.workspaces).limit(1);
    let workspaceId = existingWorkspaces[0]?.id;
    if (!workspaceId) {
      const [w] = await db
        .insert(schema.workspaces)
        .values({ name: 'LHCI', slug: 'lhci' })
        .returning({ id: schema.workspaces.id });
      if (!w) throw new Error('failed to create LHCI workspace');
      workspaceId = w.id;

      // Owner membership so the workspace is well-formed even if a human
      // ever logs into this fixture DB.
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role: 'owner' });
    }

    // Upsert the public page.
    const existing = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(eq(schema.pages.publicSlug, PUBLIC_SLUG))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.pages)
        .set({ published: true })
        .where(eq(schema.pages.id, existing[0].id));
      // biome-ignore lint/suspicious/noConsole: CLI status output
      console.log(`[seed-lhci] refreshed published state on ${existing[0].id}`);
    } else {
      const [created] = await db
        .insert(schema.pages)
        .values({
          workspaceId,
          title: 'Cairn — Lighthouse CI fixture',
          published: true,
          publicSlug: PUBLIC_SLUG,
          createdBy: userId,
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Hello LHCI' }],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'A small, deterministic published page used by Lighthouse CI.',
                  },
                ],
              },
            ],
          },
        })
        .returning({ id: schema.pages.id });
      if (!created) throw new Error('failed to create LHCI page');
      // biome-ignore lint/suspicious/noConsole: CLI status output
      console.log(`[seed-lhci] created ${created.id} with slug ${PUBLIC_SLUG}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[seed-lhci] failed', err);
  process.exit(1);
});
