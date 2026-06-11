/**
 * v0.10.0 F2 — the BUILT-IN slash-menu vocabulary a workspace trigger must not
 * collide with.
 *
 * The editor's slash search (`matchesSlashQuery` in
 * `src/components/editor/slash-extension.ts`) matches the typed `/query`
 * against each built-in item's TITLE and KEYWORD aliases, so a workspace
 * trigger equal to any of those words would shadow/compete with a built-in.
 *
 * This list is a server-safe DUPLICATE of that registry's vocabulary —
 * `slash-extension.ts` drags tippy.js + ReactRenderer + lucide icons along,
 * which a server lib must not import. The duplicate is pinned by
 * `tests/components/editor/builtin-slash-triggers.test.ts`, which derives the
 * vocabulary from the live registry (slugified titles + keywords + the
 * `/command` strings of the CitationSlashEntry exports) and asserts every
 * format-valid derived trigger is present here. Add a slash item → that test
 * fails until this list learns its words.
 */
export const BUILTIN_SLASH_TRIGGERS: readonly string[] = [
  'accordion',
  'action',
  'admonition',
  'album',
  'anki',
  'aside',
  'attachment',
  'audio',
  'bibliography',
  'blockquote',
  'bookmark',
  'bullet-list',
  'bullets',
  'button',
  'callout',
  'card',
  'chart',
  'check',
  'checkbox',
  'checkbox-list',
  'checklist',
  'citation',
  'citation-doi-pubmed-lookup',
  'cite',
  'cite-doi',
  'clip',
  'code',
  'collapse',
  'collapsible',
  'collection',
  'cols',
  'columns',
  'crossref',
  'cta',
  'database',
  'date',
  'date-time',
  'datetime',
  'db',
  'details',
  'diagram',
  'diagrams-net',
  'divider',
  'document',
  'doi',
  'drawio',
  'drawio-diagram',
  'embed',
  'equation',
  'figma',
  'file',
  'flashcard',
  'flowchart',
  'fn',
  'footnote',
  'formula',
  'gallery',
  'graph',
  'grid',
  'h1',
  'h2',
  'h3',
  'header',
  'heading-1',
  'heading-2',
  'heading-3',
  'hr',
  'iframe',
  'image',
  'image-gallery',
  'img',
  'index',
  'info',
  'kanban',
  'katex',
  'latex',
  'layout',
  'line',
  'link',
  'lookup',
  'math',
  'mention',
  'mermaid-diagram',
  'mirror',
  'monospace',
  'movie',
  'mp3',
  'mp4',
  'music',
  'note',
  'now',
  'number',
  'numbered-list',
  'ol',
  'ordered',
  'outline',
  'page',
  'page-embed',
  'pdf',
  'photo',
  'photos',
  'picture',
  'plantuml-diagram',
  'podcast',
  'pre',
  'preview',
  'pubmed',
  'quote',
  'ref',
  'reference',
  'reusable',
  'rule',
  'separator',
  'sequence',
  'snippet',
  'sound',
  'spaced',
  'spreadsheet',
  'srs',
  'subheader',
  'subpage',
  'sync',
  'synced-block',
  'table',
  'table-of-contents',
  'task',
  'time',
  'timestamp',
  'title',
  'toc',
  'todo',
  'toggle',
  'ul',
  'uml',
  'unordered',
  'upload',
  'url',
  'video',
  'vimeo',
  'webm',
  'youtube',
] as const;

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_SLASH_TRIGGERS);

/** True when `trigger` (already-normalized lowercase) shadows a built-in. */
export function isBuiltinSlashTrigger(trigger: string): boolean {
  return BUILTIN_SET.has(trigger);
}

/**
 * Slugify a registry title/keyword into trigger space: lowercase, non-
 * alphanumeric runs collapse to '-', edges trimmed. Shared with the pinning
 * test so both sides derive identically ("Citation (DOI/PubMed lookup)" →
 * "citation-doi-pubmed-lookup").
 */
export function slugifySlashWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
