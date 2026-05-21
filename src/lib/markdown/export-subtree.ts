import { PassThrough, type Readable } from 'node:stream';
import type * as schema from '@/db/schema';
import archiver from 'archiver';
import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { proseToMarkdown } from './from-prose';

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
  const archive = archiver('zip', { zlib: { level: 9 } });
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
