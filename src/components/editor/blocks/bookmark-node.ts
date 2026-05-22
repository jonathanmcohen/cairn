import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (url: string) => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the bookmark node, with NO React node view. Shared
 * by the client `bookmark.tsx` (which `.extend()`s it with a `ReactNodeView`)
 * and the server-side suggestion transform schema (which must parse stored docs
 * without pulling client-only `useState` imports into the server bundle).
 */
export const BookmarkNode = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: null },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      favicon: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark-url]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bookmark-url': HTMLAttributes.url })];
  },

  addCommands() {
    return {
      setBookmark:
        () =>
        ({ commands }) =>
          // Insert empty; the node-view immediately unfurls once the user confirms.
          // (The URL is unfurled client-side so the cached metadata lands in attrs.)
          commands.insertContent({ type: this.name, attrs: { url: null } }),
    };
  },
});
