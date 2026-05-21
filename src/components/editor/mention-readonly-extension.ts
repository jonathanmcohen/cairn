import Mention from '@tiptap/extension-mention';

/**
 * Read-only / public render variant of the mention node. Same node name
 * (`mention`) and attrs (`{ id, label }`) so stored `@[Name](userId)` content
 * deserializes identically — but it renders as an inert `<span class="mention">`
 * (no link affordance) for anonymous viewers, and carries no suggestion/`@`
 * autocomplete behavior. `mention.css` (imported globally) styles it.
 */
export const ReadOnlyMentionExtension = Mention.extend({
  // No suggestion plugin on the read-only path.
  addProseMirrorPlugins() {
    return [];
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText({ node }) {
    return `@[${node.attrs.label ?? node.attrs.id}](${node.attrs.id})`;
  },
  renderHTML({ options, node }) {
    return [
      'span',
      {
        ...options.HTMLAttributes,
        'data-mention-id': node.attrs.id,
        title: node.attrs.label ?? node.attrs.id,
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ];
  },
});
