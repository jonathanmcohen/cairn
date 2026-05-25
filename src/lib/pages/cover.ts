import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HTTPS_URL_RE = /^https:\/\//;

/** The jsonb-shaped cover stored in `pages.cover`. */
export type PageCover =
  | { kind: 'color'; value: string }
  | { kind: 'unsplash'; value: string }
  | { kind: 'upload'; value: string }
  | Record<string, never>;

export const PageCoverSchema: z.ZodType<PageCover> = z.union([
  z.object({ kind: z.literal('color'), value: z.string().regex(HEX_RE) }),
  z.object({ kind: z.literal('unsplash'), value: z.string().regex(HTTPS_URL_RE) }),
  z.object({ kind: z.literal('upload'), value: z.string().regex(UUID_RE) }),
  z.object({}).strict(),
]);

/**
 * Read a page's cover. Returns `{}` for any page that has no cover set (and
 * also for any page-id/workspace pair that does not match — we don't want to
 * leak page existence via the response shape).
 */
export async function getPageCover(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
  workspaceId: string,
): Promise<PageCover> {
  const [row] = await db
    .select({ cover: schema.pages.cover })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return {};
  // Defensive parse — if jsonb in the column ever drifts (manual SQL), fall
  // back to `{}` rather than crashing the page render.
  const parsed = PageCoverSchema.safeParse(row.cover);
  return parsed.success ? parsed.data : {};
}

export type SetPageCoverInput = {
  pageId: string;
  workspaceId: string;
  cover: PageCover;
};

/**
 * Persist a page's cover. Returns `true` when a row was updated, `false` when
 * the page did not exist in `workspaceId` (cross-workspace attempt — the
 * caller should respond 404, not 403, mirroring `requirePageAccess`).
 */
export async function setPageCover(
  db: PostgresJsDatabase<typeof schema>,
  input: SetPageCoverInput,
): Promise<boolean> {
  const cover = PageCoverSchema.parse(input.cover);
  const result = await db
    .update(schema.pages)
    .set({ cover, updatedAt: new Date() })
    .where(
      and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)),
    )
    .returning({ id: schema.pages.id });
  return result.length > 0;
}
