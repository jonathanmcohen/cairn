import { basename, dirname } from 'node:path';
import { markdownToProse } from '@/lib/markdown/to-prose';
import type { TemplatePayload } from '@/lib/templates/payload';
import { buildRemap, type IdRemap, rewriteRefs } from '@/lib/templates/rewrite';
import { emptyReport, type ImportReport } from './report';

export type NotionImportInput = {
  files: Array<{ path: string; content: string }>;
};

export type NotionImportResult = {
  payload: TemplatePayload;
  report: ImportReport;
};

// biome-ignore lint/suspicious/noExplicitAny: walking ProseMirror JSON
type ProseNode = any;

/** Trailing hex/digit-id token Notion appends to page filenames + folder names. */
const NOTION_ID_RE = /\s+([a-f0-9]{6,})$/i;

function parseNotionFilename(path: string): { id: string; title: string } {
  const file = basename(path, '.md');
  const m = file.match(NOTION_ID_RE);
  if (m?.[1]) {
    return { id: m[1], title: file.slice(0, file.length - m[0].length).trim() };
  }
  // Fallback: no trailing id token — use the full filename as both id+title.
  return { id: file, title: file };
}

function parentIdFromPath(path: string): string | null {
  const dir = dirname(path);
  if (dir === '.' || dir === '/' || dir === '') return null;
  // The folder name itself has a trailing notion id token, same shape as files.
  const folder = basename(dir);
  const m = folder.match(NOTION_ID_RE);
  return m?.[1] ?? null;
}

/** Walk parsed prose and replace `[[<id>]]` text spans with pageLink nodes. */
function injectPageLinks(node: ProseNode): ProseNode {
  if (Array.isArray(node)) return node.map(injectPageLinks);
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'text' && typeof node.text === 'string' && /\[\[[^\]]+\]\]/.test(node.text)) {
    // Split the text node into a sequence of text + pageLink nodes.
    const parts: ProseNode[] = [];
    let last = 0;
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: classic regex iterator
    while ((m = re.exec(node.text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', text: node.text.slice(last, m.index) });
      parts.push({
        type: 'pageLink',
        attrs: { targetPageId: m[1], label: m[1] },
      });
      last = re.lastIndex;
    }
    if (last < node.text.length) parts.push({ type: 'text', text: node.text.slice(last) });
    return parts;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'content' && Array.isArray(v)) {
      // Flatten: a text-node may have expanded into multiple replacement nodes.
      const next: ProseNode[] = [];
      for (const child of v) {
        const replaced = injectPageLinks(child);
        if (Array.isArray(replaced)) next.push(...replaced);
        else next.push(replaced);
      }
      out[k] = next;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Walk content and remap pageLink targetPageId via the remap (only id-bearing field). */
function rewritePageLinks(node: ProseNode, remap: IdRemap): ProseNode {
  if (Array.isArray(node)) return node.map((n) => rewritePageLinks(n, remap));
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'attrs' && v && typeof v === 'object') {
      const attrs = v as Record<string, unknown>;
      const nextAttrs: Record<string, unknown> = { ...attrs };
      if (
        (node.type === 'pageLink' || node.type === 'pageMention' || node.type === 'pageEmbed') &&
        typeof attrs.targetPageId === 'string'
      ) {
        const mapped = remap.get(attrs.targetPageId);
        if (mapped) nextAttrs.targetPageId = mapped;
      }
      out[k] = nextAttrs;
    } else if (k === 'content') {
      out[k] = rewritePageLinks(v, remap);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Detect synced-block fidelity warnings in raw markdown. */
function detectSyncedBlocks(rawMd: string): boolean {
  return /synced block/i.test(rawMd);
}

/**
 * Import a Notion .md export tree. Filenames carry the Notion page id as a
 * trailing hex token; folder nesting maps to parentId. Intra-export
 * `[[<notion-id>]]` references become pageLink nodes targeting freshly-minted
 * Cairn uuids; references to ids not present in this export are left
 * unchanged. The returned payload has every id already remapped — the caller
 * persists it directly.
 */
export function importNotion(input: NotionImportInput): NotionImportResult {
  const report = emptyReport('notion');

  // 1. Parse each file → page record.
  const sourcePages = input.files
    .filter((f) => f.path.endsWith('.md'))
    .map((f) => {
      const { id, title } = parseNotionFilename(f.path);
      const parentId = parentIdFromPath(f.path);
      const prose = markdownToProse(f.content);
      const withLinks = injectPageLinks(prose);
      if (detectSyncedBlocks(f.content)) {
        report.warnings.push({
          item: f.path,
          message:
            'synced block — Notion synced-block content is rendered as a static placeholder; live syncing is not preserved',
        });
      }
      return { id, parentId, title, icon: null, content: withLinks };
    });

  // 2. Drop intra-export parentIds whose target isn't actually present
  //    (e.g. a child whose parent file wasn't included). These become roots.
  const ids = new Set(sourcePages.map((p) => p.id));
  const normalized = sourcePages.map((p) => ({
    ...p,
    parentId: p.parentId && ids.has(p.parentId) ? p.parentId : null,
  }));

  // 3. Build TemplatePayload, remap, rewrite refs.
  const rootPageId = normalized[0]?.id;
  const payload: TemplatePayload = {
    kind: 'page',
    rootPageId,
    pages: normalized,
    databases: [],
  };
  const remap = buildRemap(payload);
  const rewritten = rewriteRefs(payload, remap);

  // 4. rewriteRefs doesn't touch pageLink nodes — patch them ourselves.
  const finalPayload: TemplatePayload = {
    ...rewritten,
    pages: rewritten.pages.map((p) => ({ ...p, content: rewritePageLinks(p.content, remap) })),
  };

  report.counts.pages = finalPayload.pages.length;
  return { payload: finalPayload, report };
}
