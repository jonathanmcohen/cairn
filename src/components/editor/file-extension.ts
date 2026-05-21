import { mergeAttributes, Node } from '@tiptap/core';

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null as string | null },
      name: { default: 'file' },
      mimeType: { default: 'application/octet-stream' },
      size: { default: 0 },
      fileId: { default: null as string | null },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-cairn-file]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-cairn-file': 'true',
        href: HTMLAttributes.href,
        class: 'file-attachment',
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
      HTMLAttributes.name as string,
    ];
  },
  addCommands() {
    return {
      insertFile:
        (attrs: { href: string; name: string; mimeType: string; size: number; fileId: string }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      insertFile: (attrs: {
        href: string;
        name: string;
        mimeType: string;
        size: number;
        fileId: string;
      }) => ReturnType;
    };
  }
}
