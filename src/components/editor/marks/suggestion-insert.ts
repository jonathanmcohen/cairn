import { Mark, mergeAttributes } from '@tiptap/core';

export type SuggestionAttrs = {
  suggestionId: string;
  authorId: string;
  createdAt: string; // ISO; set at propose time
};

export const SuggestionInsert = Mark.create({
  name: 'suggestionInsert',
  inclusive: false,
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
  }),
  parseHTML: () => [{ tag: 'ins[data-suggestion-id]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'ins',
    mergeAttributes(HTMLAttributes, { class: 'suggestion-insert' }),
    0,
  ],
});
