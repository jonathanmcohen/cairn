import { Node, mergeAttributes } from '@tiptap/core';

export const CairnImage = Node.create({
  name: 'cairnImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null as string | null },
      alt: { default: null as string | null },
      fileId: { default: null as string | null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-cairn-image]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-image': 'true',
        class: 'rounded-md max-w-full',
      }),
    ];
  },
  addCommands() {
    return {
      insertCairnImage:
        (attrs: { src: string; alt?: string; fileId?: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cairnImage: {
      insertCairnImage: (attrs: { src: string; alt?: string; fileId?: string }) => ReturnType;
    };
  }
}
