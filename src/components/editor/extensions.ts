import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { AnyExtension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import type * as Y from 'yjs';
import { Callout } from './callout-extension';
import { DatabaseNode } from './database-extension';
import { FileAttachment } from './file-extension';
import { CairnImage } from './image-extension';
import { SlashCommand } from './slash-extension';

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
      heading: { levels: [1, 2, 3] },
      ...(undoRedo ? {} : { undoRedo: false as const }),
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    CairnImage,
    FileAttachment,
    DatabaseNode,
    SlashCommand,
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
 *  - Callout        — block, content `block+`, attr `color` only.            SAFE
 *  - CairnImage     — atom/leaf, attrs `{ src, alt, fileId }`.               SAFE
 *  - FileAttachment — atom, attrs `{ href, name, mimeType, size, fileId }`.  SAFE
 *  - DatabaseNode   — atom, attr `databaseId` only; its React NodeView
 *                     (DatabaseBlock) loads rows from Postgres tables keyed by
 *                     that id, never storing row data in the node. The node
 *                     itself carries no non-attr state.                      SAFE
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
