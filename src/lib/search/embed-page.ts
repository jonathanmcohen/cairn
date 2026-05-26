import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { getEmbeddingProvider } from '@/lib/search/embed';

type Db = PostgresJsDatabase<typeof schema>;

export type EmbedPageResult =
  | { status: 'embedded'; pageId: string }
  | { status: 'skipped'; pageId: string }
  // v0.9.0 G1 P6 — page is E2E-encrypted, plaintext is unavailable
  // server-side so we cannot embed. Fail-closed: never write a row.
  | { status: 'skipped-encrypted'; pageId: string }
  | { status: 'missing'; pageId: string };

/**
 * Compute and persist a single page's embedding. Idempotent: when the
 * SHA-256 of content_text matches the stored row's content_hash, no
 * provider call is made and the function returns status='skipped'. When
 * the page itself does not exist (deleted between enqueue and execution),
 * returns status='missing' — the on-write hook in update.ts swallows it.
 *
 * The provider is loaded via `getEmbeddingProvider()`; in tests the
 * factory's singleton can be reset via __resetEmbeddingProviderForTests
 * exported from the provider module.
 *
 * v0.7.0 G4 P12.
 */
export async function embedPage(db: Db, pageId: string): Promise<EmbedPageResult> {
  const [page] = await db
    .select({
      id: schema.pages.id,
      workspaceId: schema.pages.workspaceId,
      contentText: schema.pages.contentText,
      encrypted: schema.pages.encrypted,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId));
  if (!page) return { status: 'missing', pageId };
  // Fail-closed: any truthy `encrypted` value short-circuits before reading
  // contentText (which is blanked on encrypt anyway).
  if (page.encrypted) return { status: 'skipped-encrypted', pageId };

  const text = page.contentText ?? '';
  const hash = createHash('sha256').update(text).digest('hex');

  const [existing] = await db
    .select({ contentHash: schema.pageEmbeddings.contentHash })
    .from(schema.pageEmbeddings)
    .where(eq(schema.pageEmbeddings.pageId, pageId));
  if (existing && existing.contentHash === hash) {
    return { status: 'skipped', pageId };
  }

  const provider = getEmbeddingProvider();
  const vec = await provider.embed(text);
  // Drizzle's vector customType (P11) accepts number[] on input; convert
  // the Float32Array via Array.from to land on the JS-array contract.
  const embedding = Array.from(vec);

  await db
    .insert(schema.pageEmbeddings)
    .values({
      pageId,
      workspaceId: page.workspaceId,
      embedding,
      contentHash: hash,
    })
    .onConflictDoUpdate({
      target: schema.pageEmbeddings.pageId,
      set: {
        embedding,
        contentHash: hash,
        updatedAt: new Date(),
      },
    });

  return { status: 'embedded', pageId };
}
