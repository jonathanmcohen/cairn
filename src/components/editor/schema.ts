import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { BookmarkNode } from './blocks/bookmark-node';
import { Column, ColumnList } from './blocks/columns';
import { EmbedNode } from './blocks/embed-node';
import { MathBlockNode } from './blocks/math-node';
import { MermaidNode } from './blocks/mermaid-node';
import { PlantUmlNode } from './blocks/plantuml-node';
import { SyncedBlockNode } from './blocks/synced-block-node';
import { SimpleTable } from './blocks/table';
import { ToggleNode } from './blocks/toggle-node';
import { Callout } from './callout-extension';
import { DatabaseNodeSchema } from './database-node';
import { FileAttachment } from './file-extension';
import { CairnImage } from './image-extension';
import { SuggestionDelete } from './marks/suggestion-delete';
import { SuggestionInsert } from './marks/suggestion-insert';
import { PageEmbed, PageLink, PageMention } from './page-link-extension';
import { SuggestionBlock } from './suggestion-block';
import { TableOfContentsNode } from './toc-node';

const lowlight = createLowlight(common);

/**
 * SERVER-SAFE node/mark set that mirrors the schema produced by
 * `baseExtensions()`, but built ONLY from schema-only modules — no React node
 * views, no `useState`/`useMemo` imports, no `katex` CSS.
 *
 * The suggestion accept/reject transform (`./suggestions/transform`) runs
 * server-side inside API routes; it must parse stored `pages.content` against
 * the same node/mark types the editor uses, without dragging client-only
 * editor chrome into the server bundle (Turbopack rejects top-level React-hook
 * imports in server modules). Interactive-only pieces (SlashCommand, the
 * Mention suggestion popup) are omitted because they add no schema node/mark.
 */
export function schemaExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    ToggleNode,
    ColumnList,
    Column,
    SimpleTable,
    CairnImage,
    FileAttachment,
    DatabaseNodeSchema,
    TableOfContentsNode,
    EmbedNode,
    BookmarkNode,
    MathBlockNode,
    SyncedBlockNode,
    MermaidNode,
    PlantUmlNode,
    SuggestionInsert,
    SuggestionDelete,
    SuggestionBlock,
    // The `mention` node, schema-only: keep its HTML/text serialization but drop
    // the `suggestion` popup (which would pull the React mention list).
    Mention.configure({ HTMLAttributes: { class: 'mention' } }),
    // Page-link nodes are schema-pure (static renderHTML, no React view), so the
    // server-side `getSchema` for previewAccepted recognizes stored content.
    PageLink,
    PageMention,
    PageEmbed,
  ];
}
