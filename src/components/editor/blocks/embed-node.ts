import { mergeAttributes, Node } from '@tiptap/core';
import { resolveEmbed } from '@/lib/editor/embed-allowlist';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Insert an embed from a pasted URL; no-op if the URL is not allowlisted. */
      setEmbed: (rawUrl: string) => ReturnType;
    };
  }
}

/**
 * Schema-only definition of the embed node, with NO React node view. Shared by
 * the client `embed.tsx` (which `.extend()`s it with a `ReactNodeView`) and the
 * server-side suggestion transform schema.
 */
export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      provider: { default: null },
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-provider]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-embed-provider': HTMLAttributes.provider }),
    ];
  },

  addCommands() {
    return {
      setEmbed:
        (rawUrl) =>
        ({ commands }) => {
          const resolved = resolveEmbed(rawUrl);
          if (!resolved) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { provider: resolved.provider, src: resolved.src },
          });
        },
    };
  },
});
