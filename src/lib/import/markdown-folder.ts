import { basename, dirname } from 'node:path';
import { markdownToProse } from '@/lib/markdown/to-prose';
import type { TemplatePayload } from '@/lib/templates/payload';
import { buildRemap, rewriteRefs } from '@/lib/templates/rewrite';
import { emptyReport, type ImportReport } from './report';

export type MarkdownFolderInput = {
  files: Array<{ path: string; content: string }>;
};

export type MarkdownFolderResult = {
  payload: TemplatePayload;
  report: ImportReport;
};

/**
 * Generic markdown folder import — no Notion ID conventions, no wikilink
 * rewriting. Each `.md` file becomes a page; nesting reflects the folder
 * structure (a child file's parent is the file (if any) named after its
 * containing folder, otherwise null).
 */
export function importMarkdownFolder(input: MarkdownFolderInput): MarkdownFolderResult {
  const report = emptyReport('markdown-folder');

  // Each file's logical id is its full path (without extension). Parent is
  // the file at <dir>.md if present, else null.
  const mdFiles = input.files.filter((f) => f.path.endsWith('.md'));
  const pathKey = (p: string) => p.replace(/\.md$/, '');
  const ids = new Set(mdFiles.map((f) => pathKey(f.path)));

  const pages = mdFiles.map((f) => {
    const id = pathKey(f.path);
    const title = basename(f.path, '.md');
    const dir = dirname(f.path);
    const parentCandidate = dir === '.' || dir === '/' || dir === '' ? null : dir;
    const parentId = parentCandidate && ids.has(parentCandidate) ? parentCandidate : null;
    return { id, parentId, title, icon: null, content: markdownToProse(f.content) };
  });

  const rootPageId = pages[0]?.id;
  const payload: TemplatePayload = {
    kind: 'page',
    rootPageId,
    pages,
    databases: [],
  };
  const remap = buildRemap(payload);
  const rewritten = rewriteRefs(payload, remap);
  report.counts.pages = rewritten.pages.length;
  return { payload: rewritten, report };
}
