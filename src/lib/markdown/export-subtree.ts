import { PassThrough, type Readable } from 'node:stream';
import type * as schema from '@/db/schema';
import { ZipArchive } from 'archiver';
import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { proseToMarkdown } from './from-prose';

// archiver v8 is pure ESM and exposes format classes (e.g. `ZipArchive`) instead of the
// old `archiver('zip', opts)` factory. @types/archiver still ships the v7 shape, so declare
// the v8 export here against the existing `Archiver` instance interface.
declare module 'archiver' {
  export class ZipArchive {
    constructor(options?: ArchiverOptions);
  }
  export interface ZipArchive extends Archiver {}
}

export async function streamSubtreeZip(
  db: PostgresJsDatabase<typeof schema>,
  args: { workspaceId: string; rootPageId: string },
): Promise<Readable> {
  const rows = (await db.execute(rawSql`
    WITH RECURSIVE tree AS (
      SELECT id, title, content FROM pages
      WHERE workspace_id = ${args.workspaceId}::uuid
        AND id = ${args.rootPageId}::uuid
        AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.title, p.content FROM pages p
      INNER JOIN tree t ON p.parent_id = t.id
      WHERE p.workspace_id = ${args.workspaceId}::uuid
        AND p.deleted_at IS NULL
    )
    SELECT id, title, content FROM tree;
  `)) as unknown as { id: string; title: string; content: unknown }[];

  const pass = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(pass);
  for (const p of rows) {
    const md = proseToMarkdown(p.content);
    const filename = `${slug(p.title)}-${p.id.slice(0, 8)}.md`;
    archive.append(md, { name: filename });
  }
  void archive.finalize();
  return pass;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'untitled'
  );
}
