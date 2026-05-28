import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gallery: {
      /** Insert an empty gallery node (placeholder until images are dropped). */
      setGallery: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the `gallery` node — a structural container whose
 * content is restricted to one or more `cairnImage` children. The React node
 * view that renders the grid + lightbox trigger lives in
 * `src/components/editor/blocks/gallery.tsx` (extends this base with a
 * `ReactNodeViewRenderer`). Keeping the schema separate matches the pattern
 * used by mermaid/plantuml/drawio — the server-side schema (`schema.ts`)
 * imports this file directly, so accept/reject suggestion transforms running
 * on Node can parse stored `pages.content` without dragging React imports
 * into the server bundle.
 *
 * NOT atomic — children are independently editable nodes, so `atom` defaults
 * to `false`. `draggable: false` because the gallery's children carry their
 * own drag-handle UX via the existing image extension.
 *
 * v0.9.0 G3 P16.
 */
export const GalleryNode = Node.create({
  name: 'gallery',
  group: 'block',
  content: 'cairnImage+',
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-gallery]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-gallery': '' }), 0];
  },

  addCommands() {
    return {
      setGallery:
        () =>
        ({ commands }) =>
          // The slash command inserts an empty gallery, but ProseMirror schemas
          // reject `cairnImage+` content with zero children. We insert a single
          // empty `cairnImage` placeholder; GalleryView treats a child with no
          // src/fileId as the "drop here" prompt.
          commands.insertContent({
            type: this.name,
            content: [{ type: 'cairnImage', attrs: { src: null, alt: null, fileId: null } }],
          }),
    };
  },
});
