import { mergeAttributes, Node } from '@tiptap/core';

export type CalloutVariant = 'note' | 'tip' | 'warning' | 'error' | 'info';

const LEGACY_COLOR_TO_VARIANT: Record<string, CalloutVariant> = {
  blue: 'note',
  green: 'tip',
  amber: 'warning',
  default: 'note',
};

export const CALLOUT_VARIANTS: CalloutVariant[] = ['note', 'tip', 'warning', 'error', 'info'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'note' as CalloutVariant,
        parseHTML: (el) => {
          const v = el.getAttribute('data-variant') as CalloutVariant | null;
          if (v && CALLOUT_VARIANTS.includes(v)) return v;
          // legacy fallback: map old data-color
          const legacy = el.getAttribute('data-color') ?? 'default';
          return LEGACY_COLOR_TO_VARIANT[legacy] ?? 'note';
        },
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const variant = (HTMLAttributes['data-variant'] as string) ?? 'note';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: `callout callout-${variant}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (variant: CalloutVariant = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
      toggleCallout:
        (variant: CalloutVariant = 'note') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { variant }),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType;
      toggleCallout: (variant?: CalloutVariant) => ReturnType;
    };
  }
}
