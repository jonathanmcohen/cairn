import { InputRule, mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      setMath: (attrs: { latex: string; display?: boolean }) => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the math node, with NO React node view and no KaTeX
 * CSS import. Shared by the client `math.tsx` (which `.extend()`s it with a
 * `ReactNodeView`) and the server-side suggestion transform schema.
 *
 * Named `MathBlockNode` (not `Math`) to avoid shadowing the JS global `Math`
 * (Biome `noShadowRestrictedNames`). The TipTap node `name` is still `math`.
 */
export const MathBlockNode = Node.create({
  name: 'math',
  inline: true, // a single node serves inline; block uses display:true + group below
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: '' },
      display: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math]' }, { tag: 'div[data-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const tag = HTMLAttributes.display ? 'div' : 'span';
    return [tag, mergeAttributes(HTMLAttributes, { 'data-math': '' })];
  },

  addInputRules() {
    const name = this.name;
    return [
      new InputRule({
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ range, match, commands }) => {
          commands.insertContentAt(range, {
            type: name,
            attrs: { latex: match[1] ?? '', display: true },
          });
        },
      }),
      new InputRule({
        find: /\$([^$]+)\$$/,
        handler: ({ range, match, commands }) => {
          commands.insertContentAt(range, {
            type: name,
            attrs: { latex: match[1] ?? '', display: false },
          });
        },
      }),
    ];
  },

  addCommands() {
    return {
      setMath:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex: attrs.latex, display: attrs.display ?? false },
          }),
    };
  },
});
