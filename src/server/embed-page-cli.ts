import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { getEmbeddingProvider } from '@/lib/search/embed';
import { type EmbedPageResult, embedPage } from '@/lib/search/embed-page';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.9.6 G4 (#136) — invoked by the embeddings CI smoke job inside the booted
 * runtime image. Resolves a page id from argv, runs embedPage, and returns the
 * structured result. embedPage resolves its own provider via
 * getEmbeddingProvider(); the smoke job exercises the real WASM-backed local
 * provider, while unit tests inject a deterministic provider through the
 * factory's env seam (CAIRN_EMBEDDING_URL + __resetEmbeddingProviderForTests)
 * so they never download a model.
 */
export async function runEmbedPageCli(db: Db, argv: string[]): Promise<EmbedPageResult> {
  const pageId = argv[0];
  if (!pageId) throw new Error('usage: embed-page-cli <pageId>');
  return embedPage(db, pageId);
}

async function main(): Promise<void> {
  // Lazy server import so unit tests (which build their own db) don't open a
  // real connection by importing this module.
  const { getDb } = await import('@/db/client');
  const db = getDb() as unknown as Db;
  // Touch the provider factory so a misconfigured backend fails loudly here.
  getEmbeddingProvider();
  const result = await runEmbedPageCli(db, process.argv.slice(2));
  // biome-ignore lint/suspicious/noConsole: CLI output consumed by the CI smoke job
  console.log(JSON.stringify(result));
  if (result.status === 'missing') process.exit(2);
  process.exit(0);
}

// Run main() only when executed directly (node dist/server/embed-page-cli.js).
if (process.argv[1]?.includes('embed-page-cli')) {
  void main();
}
