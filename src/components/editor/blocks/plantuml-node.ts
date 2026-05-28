import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    plantuml: {
      /** Insert an empty PlantUML block (the user fills the source in the node view). */
      setPlantUml: () => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the plantuml node, with NO React node view. Shared
 * by the client `plantuml.tsx` (which `.extend()`s it with a `ReactNodeView`)
 * and the server-side schema. PlantUML renders to an `<img>` whose URL is
 * built from the source via the `plantuml-encoder` package (loaded lazily by
 * the React view). No iframe — no CSP `frame-src` entry needed.
 */
export const PlantUmlNode = Node.create({
  name: 'plantuml',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-plantuml]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-plantuml': '' })];
  },

  addCommands() {
    return {
      setPlantUml:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { source: '' } }),
    };
  },
});
