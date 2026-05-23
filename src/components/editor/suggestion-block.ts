import { mergeAttributes, Node } from '@tiptap/core';

export const SuggestionBlock = Node.create({
  name: 'suggestionBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    suggestionId: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-suggestion-id'),
      renderHTML: (a: Record<string, unknown>) =>
        a.suggestionId ? { 'data-suggestion-id': a.suggestionId } : {},
    },
    authorId: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-author-id'),
      renderHTML: (a: Record<string, unknown>) =>
        a.authorId ? { 'data-author-id': a.authorId } : {},
    },
    createdAt: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-created-at'),
      renderHTML: (a: Record<string, unknown>) =>
        a.createdAt ? { 'data-created-at': a.createdAt } : {},
    },
    kind: {
      default: 'insert',
      parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'insert',
      renderHTML: (a: Record<string, unknown>) => ({ 'data-kind': a.kind ?? 'insert' }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-suggestion-block]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-suggestion-block': '', class: 'suggestion-block' }),
    0,
  ],
});
