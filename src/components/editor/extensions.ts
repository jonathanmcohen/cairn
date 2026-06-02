import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { AnyExtension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import type * as Y from 'yjs';
import { AudioNode } from './blocks/audio-node';
import { Bookmark } from './blocks/bookmark';
import { ButtonBlock } from './blocks/button';
import { CalloutWithView } from './blocks/callout';
import { CitationNode } from './blocks/citation-node';
import { createCairnCodeBlock } from './blocks/code-block';
import { Column, ColumnList } from './blocks/columns';
import { DateTimeNode } from './blocks/datetime-node';
import { DividerNode } from './blocks/divider-node';
import { DrawioNode } from './blocks/drawio-node';
import { EmbedNode } from './blocks/embed-node';
import { FlashcardNode } from './blocks/flashcard-node';
import { FootnoteMark } from './blocks/footnote-mark';
import { GalleryNode } from './blocks/gallery-node';
import { MathBlockNode } from './blocks/math-node';
import { MermaidNode } from './blocks/mermaid-node';
import { PdfNode } from './blocks/pdf-node';
import { PlantUmlNode } from './blocks/plantuml-node';
import { SyncedBlockNode } from './blocks/synced-block-node';
import { SimpleTable } from './blocks/table';
import { Toggle } from './blocks/toggle';
import { VideoBlock } from './blocks/video';
import { DatabaseNode } from './database-extension';
import { EditorLinkShortcut } from './editor-link-shortcut';
import { FileAttachmentWithView } from './file-view-extension';
import { CairnImageWithView } from './image-view-extension';
import { MarkdownMarkInputRules } from './marks/markdown-input-rules';
import { SuggestionDelete } from './marks/suggestion-delete';
import { SuggestionInsert } from './marks/suggestion-insert';
import { MentionExtension } from './mention-extension';
import { PageEmbed, PageLink, PageLinkHover, PageMention } from './page-link-extension';
import { PageLinkSuggestion } from './page-link-suggestion';
import { SlashCommand } from './slash-extension';
import { SuggestionBlock } from './suggestion-block';
import { TableOfContents } from './toc-extension';

const lowlight = createLowlight(common);

/**
 * Shared node/mark set. Pass `undoRedo: false` to disable StarterKit's local
 * undo/redo (renamed from `history` in TipTap 3) — required under collaboration,
 * where Yjs owns the undo stack.
 */
export function baseExtensions(opts: { undoRedo?: boolean } = {}) {
  const { undoRedo = true } = opts;
  return [
    StarterKit.configure({
      codeBlock: false,
      // v0.9 P28: widen to h4 so the TOC sidebar + inline TOC block can render
      // a fourth nesting level. Keyboard shortcuts (Ctrl/Cmd-Alt-4) become
      // available automatically.
      heading: { levels: [1, 2, 3, 4] },
      // v0.9.4 P29 #116/#117: keep StarterKit's Link mark but stop the editable
      // surface from navigating on click (so a click places the caret for
      // editing) and autolink pasted URLs. The `cairn-editor-link` class styles
      // the anchor in both themes (see code-highlight.css).
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', class: 'cairn-editor-link' },
      },
      ...(undoRedo ? {} : { undoRedo: false as const }),
    }),
    // v0.9.2 P09 — extended code block: a React NodeView adds a themed language
    // selector (ui/select) bound to the `language` attr + lowlight highlighting.
    // schema.ts intentionally keeps the plain CodeBlockLowlight (no NodeView)
    // since server-side parsing never renders React views.
    createCairnCodeBlock(lowlight),
    // #260 / #261 — input rules that strip the `**`/`~~` markdown delimiters when
    // typing `**bold**` / `~~strike~~` (StarterKit's bold/strike marks stay; this
    // adds delete-the-marker input rules against them by schema name).
    MarkdownMarkInputRules,
    TaskList,
    TaskItem.configure({ nested: true }),
    CalloutWithView,
    Toggle,
    ColumnList,
    Column,
    SimpleTable,
    CairnImageWithView,
    FileAttachmentWithView,
    DatabaseNode,
    TableOfContents,
    EmbedNode,
    Bookmark,
    MathBlockNode,
    SyncedBlockNode,
    MermaidNode,
    PlantUmlNode,
    DrawioNode,
    GalleryNode,
    PdfNode,
    DividerNode,
    ButtonBlock,
    VideoBlock,
    // v0.9.0 G3 P22 — `cairnAudio` schema-only registration. The React node-
    // view loads lazily via `extensions-lazy.ts#audio` so the bundle stays
    // slim until a doc actually contains audio (or the user types `/audio`).
    AudioNode,
    // v0.9.0 G3 P18 — citation block + inline footnote mark. Both are schema-
    // pure (no React node-view in this list; the style-aware `CitationView`
    // lives in `extensions/citation.tsx` and is wired by editor.tsx when a
    // page-level `citationStyle` prop is provided).
    CitationNode,
    FootnoteMark,
    // v0.9.0 G3 P19 + P20 — schema-only static reg so server-side document
    // parsers don't silently drop these nodes when loading content. The
    // React node-views still load lazily via extensions-lazy.ts.
    FlashcardNode,
    DateTimeNode,
    SuggestionInsert,
    SuggestionDelete,
    SuggestionBlock,
    SlashCommand,
    // v0.9.4 P29 #117 — keymap-only extension: Mod+Shift+K always opens the
    // link input; Mod+K opens it only with a ranged selection (else bubbles to
    // the ⌘K palette). Present in the collab path too since collabExtensions()
    // spreads baseExtensions().
    EditorLinkShortcut,
    MentionExtension,
    PageLink,
    PageMention,
    PageEmbed,
    PageLinkSuggestion,
    // v0.8 P18: inline transclusion preview popover for [[page-link]] nodes.
    PageLinkHover,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}

export type CollabUser = { id: string; name: string; color: string; image?: string | null };

/**
 * Yjs-driven variant of baseExtensions():
 *  - StarterKit `undoRedo` is DISABLED (Yjs owns undo/redo via y-prosemirror's
 *    own undo manager; the v3 sub-extension was renamed `history` -> `undoRedo`).
 *  - Collaboration binds the shared Y.Doc (`document` option).
 *  - CollaborationCaret (v3 rename of v2 CollaborationCursor) renders remote
 *    carets; added only when `withCursor` is true (read-only viewers skip it so
 *    they make no awareness writes).
 *
 * Custom-node Yjs-safety review (y-prosemirror syncs any node whose state is
 * fully derived from ProseMirror attrs; node-local mutable state would desync):
 *  - Callout        — block, content `block+`, attr `variant` only; its React
 *                     node-view writes only `variant` via updateAttributes.   SAFE
 *  - CodeBlock      — block, content `text*`, attr `language` only; its React
 *                     NodeView (CodeBlockView) writes ONLY `language` via
 *                     updateAttributes (no node-local state) and derives the
 *                     `<code>` highlight class from that attr. v0.9.2 P09.   SAFE
 *  - CairnImage     — atom/leaf, attrs `{ src, alt, fileId }`.               SAFE
 *  - FileAttachment — atom, attrs `{ href, name, mimeType, size, fileId }`.  SAFE
 *  - DatabaseNode   — atom, attr `databaseId` only; its React NodeView
 *                     (DatabaseBlock) loads rows from Postgres tables keyed by
 *                     that id, never storing row data in the node. The node
 *                     itself carries no non-attr state.                      SAFE
 *  - Mention        — inline atom, attrs `{ id (userId), label }` only.      SAFE
 *  - Toggle         — block, content `block+`, attr `open` only; its node-view
 *                     stores open/closed in the `open` attr (never local
 *                     React state), so collaborators stay in sync.        SAFE
 *  - ColumnList     — block, content `column{2,}`; `data-columns` is derived
 *                     from childCount at render — no stored non-attr state. SAFE
 *  - Column         — content `block+`, structural only.                   SAFE
 *  - SimpleTable    — official table family; cell content + colspan/rowspan/
 *                     colwidth attrs only, no node-view-local state.        SAFE
 *  - Embed          — atom/leaf, attrs `{ provider, src }` only; the sandboxed
 *                     iframe is rendered from attrs, no node-local state.    SAFE
 *  - Bookmark       — atom/leaf, attrs `{ url, title, description, image,
 *                     favicon }`; the unfurl cache lives entirely in attrs.  SAFE
 *  - Math           — inline atom, attrs `{ latex, display }`; KaTeX renders
 *                     from `latex`, no node-local state.                      SAFE
 *  - SyncedBlock    — block, content `block+`, attr `syncedBlockId` only.
 *                     Same-page mirrors read the source node's content from the
 *                     SAME doc at render time (no stored copy, no cross-page
 *                     reach); the node carries no non-attr state.             SAFE
 *  - TableOfContents — block atom, NO attrs + NO node-local state; its node-view
 *                     derives the heading list from the shared doc at render.   SAFE
 *  - SuggestionInsert — mark (track-changes insert), attrs `{ suggestionId,
 *                     authorId, createdAt }` only; renders as <ins>, no
 *                     node-local/mark-local state.                              SAFE
 *  - SuggestionDelete — mark (track-changes delete), attrs `{ suggestionId,
 *                     authorId, createdAt }` only; renders as <del>, no
 *                     node-local/mark-local state.                              SAFE
 *  - SuggestionBlock — block, content `block+`, attrs `{ suggestionId, authorId,
 *                     createdAt, kind }` only; renders as <div>, no node-local
 *                     state.                                                     SAFE
 *  - PageLink       — inline atom, attrs `{ targetPageId, label }` only; static
 *                     renderHTML, no node-view/node-local state.                 SAFE
 *  - PageMention    — inline atom, attrs `{ targetPageId, label }` only; static
 *                     renderHTML, no node-view/node-local state.                 SAFE
 *  - PageEmbed      — block atom, attrs `{ targetPageId, label }` only; static
 *                     renderHTML, no node-view/node-local state.                 SAFE
 *  - Divider        — block atom, NO attrs + NO node-view; static renderHTML
 *                     emits a styled `<hr>`. v0.8.0 P24.                          SAFE
 *  - ButtonBlock    — block atom, attrs `{ label, href, variant }` only; the
 *                     React node-view is a label/href/variant editor that writes
 *                     EVERY edit back to attrs via `updateAttributes` (no node-
 *                     local persistence). v0.8.0 P24.                            SAFE
 *  - AudioNode     — block atom, attrs `{ fileId, mime, name, src }` only.
 *                     The React node-view fetches a session signed URL via
 *                     `/api/files/<id>/signed-url` on mount; `src` is a
 *                     transient public-render override read in the same shape
 *                     as `VideoBlock` (peers re-derive at view time, never
 *                     persisting a stale URL). No node-local mutable state.
 *                     v0.9.0 G3 P22.                                          SAFE
 *  - VideoBlock     — block atom, attrs `{ fileId, mimeType, src }` only. The
 *                     React node-view shows a file picker until `fileId` lands,
 *                     then renders `<video controls>` whose `<source src>` is
 *                     the `src` override (set by `resignDocumentImages` on the
 *                     public render path) or `/api/files/<fileId>` otherwise.
 *                     `src` is a transient post-resign attr; peer collaborators
 *                     can carry it but each re-derives a signed URL at view
 *                     time. No node-local mutable state. v0.8.0 P24.            SAFE
 *  - cairnLinkShortcut — keymap-only Extension (no node/mark, no schema, no
 *                        node-local state); dispatches a window CustomEvent. SAFE
 * No custom node holds non-attr NodeView state.
 */
export function collabExtensions(opts: {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  user: CollabUser;
  withCursor: boolean;
}) {
  const ext: AnyExtension[] = [
    ...baseExtensions({ undoRedo: false }),
    Collaboration.configure({ document: opts.ydoc }),
  ];
  if (opts.withCursor) {
    ext.push(
      CollaborationCaret.configure({
        provider: opts.provider,
        user: opts.user,
        // Custom caret: a colored vertical bar with a floating name label in
        // the user's color. CSS lives in code-highlight.css (imported by the
        // editor surface). `user` is the awareness payload we wrote above.
        render: (user) => {
          const color = typeof user.color === 'string' ? user.color : 'hsl(0, 0%, 50%)';
          const name = typeof user.name === 'string' ? user.name : 'Anonymous';
          const cursor = document.createElement('span');
          cursor.classList.add('collab-caret');
          cursor.setAttribute('style', `border-color: ${color}`);
          const label = document.createElement('div');
          label.classList.add('collab-caret-label');
          label.setAttribute('style', `background-color: ${color}`);
          label.textContent = name;
          cursor.appendChild(label);
          return cursor;
        },
      }),
    );
  }
  return ext;
}
