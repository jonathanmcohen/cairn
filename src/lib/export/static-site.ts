import { PassThrough, type Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { getStorage } from '@/lib/files/get-storage';
import type { FileStorage } from '@/lib/files/storage';
import { proseToMarkdown } from '@/lib/markdown/from-prose';
import type { AssetRef } from './assets';
import { extractAndRewriteAssets } from './assets';
import type { ExportTarget } from './frontmatter';
import { walkWorkspacePages } from './page-walk';
import {
  buildDocusaurusTree,
  type DocusaurusPageInput,
  type TranslationGroups,
} from './targets/docusaurus';
import { buildMkDocsTree, type RenderedPage } from './targets/mkdocs';

export type ExportArgs = {
  workspaceId: string;
  target: ExportTarget;
  /**
   * Test seam — inject a stub storage backend. Production callers leave this
   * empty and the orchestrator memoizes `getStorage()` (LocalDisk or S3 per
   * env).
   */
  storage?: FileStorage;
};

export class StaticExportError extends Error {
  constructor(
    message: string,
    public readonly code: 'workspace_not_found' | 'encrypted_pages_refused' | 'unknown_target',
  ) {
    super(message);
  }
}

function slugify(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base ? `${base}-${id.slice(0, 8)}` : id.slice(0, 8);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

/**
 * Build a buildable static-site project (ZIP) from a workspace's page tree.
 * Refuses workspaces containing any encrypted page (spec: static-site export
 * is public-share-equivalent → must not leak ciphertext metadata).
 */
export async function exportWorkspace(
  db: PostgresJsDatabase<typeof schema>,
  args: ExportArgs,
): Promise<Readable> {
  // 1. Workspace metadata.
  const [ws] = await db
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, args.workspaceId))
    .limit(1);
  if (!ws) {
    throw new StaticExportError(`workspace not found: ${args.workspaceId}`, 'workspace_not_found');
  }

  // 2. Refuse encrypted pages (spec §4 — public-share-equivalent action).
  const encryptedRows = (await db.execute(rawSql`
    SELECT COUNT(*)::int AS count
    FROM pages
    WHERE workspace_id = ${args.workspaceId}::uuid
      AND encrypted = true
      AND deleted_at IS NULL
  `)) as unknown as Array<{ count: number }>;
  const encryptedCount = encryptedRows[0]?.count ?? 0;
  if (encryptedCount > 0) {
    throw new StaticExportError(
      'cannot export workspace with encrypted pages',
      'encrypted_pages_refused',
    );
  }
  // Suppress unused-imports for the and/isNull narrowing helpers — kept for
  // forward-compat with non-rawSql callers.
  void and;
  void isNull;

  // 3. Walk + render every page.
  const pages = await walkWorkspacePages(db, args.workspaceId);
  const storage = args.storage ?? getStorage();
  const allAssets: Array<AssetRef & { contents: Buffer }> = [];
  const seenDest = new Set<string>();
  const rendered: RenderedPage[] = [];
  const renderedByPageId = new Map<string, RenderedPage>();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const { rewritten, assets } = await extractAndRewriteAssets(db, args.workspaceId, p.content);
    for (const a of assets) {
      if (seenDest.has(a.destFilename)) continue;
      seenDest.add(a.destFilename);
      const buf = await streamToBuffer(storage.read(a.storagePath));
      allAssets.push({ ...a, contents: buf });
    }
    const slug = slugify(p.title, p.id);
    const markdown = proseToMarkdown(rewritten);
    const entry: RenderedPage = {
      id: p.id,
      parentId: p.parentId,
      title: p.title,
      slug,
      depth: p.depth,
      // Walk order = canonical insertion order; we promote it to nav_order so
      // MkDocs renders sections top-to-bottom as authored.
      navOrder: i,
      markdown,
    };
    rendered.push(entry);
    renderedByPageId.set(p.id, entry);
  }

  // 3b. Translation grouping: P26 added `translation_of_page_id` +
  // `translation_locale`. If the columns don't exist yet at runtime
  // (release-branch ordering hiccup), fall back to an empty map.
  const translationGroups: TranslationGroups = new Map();
  try {
    const trRows = (await db.execute(rawSql`
      SELECT id, translation_of_page_id, translation_locale
      FROM pages
      WHERE workspace_id = ${args.workspaceId}::uuid
        AND deleted_at IS NULL
        AND translation_of_page_id IS NOT NULL
        AND translation_locale IS NOT NULL
    `)) as unknown as Array<{
      id: string;
      translation_of_page_id: string;
      translation_locale: string;
    }>;
    for (const tr of trRows) {
      const renderedTr = renderedByPageId.get(tr.id);
      if (!renderedTr) continue;
      const group = translationGroups.get(tr.translation_of_page_id) ?? {};
      group[tr.translation_locale] = renderedTr satisfies DocusaurusPageInput;
      translationGroups.set(tr.translation_of_page_id, group);
    }
  } catch (err) {
    // Column not present yet — proceed without translations.
    void err;
  }

  // 4. Build target tree.
  let files: Record<string, string | Buffer>;
  switch (args.target) {
    case 'mkdocs': {
      const tree = buildMkDocsTree({
        workspaceName: ws.name,
        pages: rendered,
        assets: allAssets,
      });
      files = tree.files;
      break;
    }
    case 'docusaurus': {
      // Translation pages are NOT emitted twice — exclude them from the main
      // `rendered` array and place them only under i18n/<locale>/.
      const isTranslation = new Set<string>();
      for (const group of translationGroups.values()) {
        for (const tr of Object.values(group)) isTranslation.add(tr.id);
      }
      const canonicalPages = rendered.filter((p) => !isTranslation.has(p.id));
      const tree = buildDocusaurusTree({
        workspaceName: ws.name,
        pages: canonicalPages,
        assets: allAssets,
        translationGroups,
      });
      files = tree.files;
      break;
    }
    default: {
      const _exh: never = args.target;
      throw new StaticExportError(`unknown target: ${String(_exh)}`, 'unknown_target');
    }
  }

  // 5. Stream as a zip.
  const pass = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(pass);
  for (const [path, body] of Object.entries(files)) {
    archive.append(body, { name: path });
  }
  void archive.finalize();
  return pass;
}
