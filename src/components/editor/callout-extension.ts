import { mergeAttributes, Node } from '@tiptap/core';

export type CalloutColor = 'default' | 'blue' | 'green' | 'amber';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      color: {
        default: 'default' as CalloutColor,
        parseHTML: (el) => (el.getAttribute('data-color') as CalloutColor) ?? 'default',
        renderHTML: (attrs) => ({ 'data-color': attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: `callout callout-${HTMLAttributes['data-color'] ?? 'default'}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (color: CalloutColor = 'default') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { color }),
      toggleCallout:
        (color: CalloutColor = 'default') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { color }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (color?: CalloutColor) => ReturnType;
      toggleCallout: (color?: CalloutColor) => ReturnType;
    };
  }
}
