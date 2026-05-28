import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pdf: {
      /** Insert a PDF block. `fileId` is the uploaded `files.id`; null means
       *  "no file chosen yet" (the node-view shows a picker). */
      setPdf: (attrs?: { fileId?: string | null; defaultPage?: number }) => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the `pdf` block node (v0.9.0 G3 P17).
 *
 * Attrs:
 *  - `fileId`      — string (uuid) | null. The uploaded `files.id`. The
 *                    renderer fetches the file blob via the existing signed-URL
 *                    pipeline (`/api/files/[id]?sig=&exp=`).
 *  - `defaultPage` — int >= 1. The page number the viewer scrolls to on first
 *                    mount. Defaults to 1.
 *
 * Block atom: ProseMirror treats the node as opaque (no editable text inside).
 * The React node-view, registered lazily via `src/components/editor/extensions/
 * pdf.tsx`, owns the canvas + SVG overlay + toolbar; this file stays React-
 * free so the server-side schema (used to parse `pages.content` outside the
 * browser) can import it without pulling in React.
 *
 * Yjs-safety: state is fully derived from attrs — annotations live in
 * Postgres, not in node attrs, so collaborators stay in sync without any
 * special handling. Multi-user shared-overlay annotation is deferred to v1.0.
 */
export const PdfNode = Node.create({
  name: 'pdf',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fileId: { default: null },
      defaultPage: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-pdf-file-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-pdf-file-id': String(HTMLAttributes.fileId ?? ''),
        'data-pdf-default-page': String(HTMLAttributes.defaultPage ?? 1),
        class: 'cairn-pdf-node',
      }),
    ];
  },

  addCommands() {
    return {
      setPdf:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              fileId: attrs?.fileId ?? null,
              defaultPage: attrs?.defaultPage ?? 1,
            },
          }),
    };
  },
});
