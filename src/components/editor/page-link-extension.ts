import { mergeAttributes, Node } from '@tiptap/core';

type PageLinkAttrs = { targetPageId: string | null; label: string | null };

const sharedAttrs = {
  targetPageId: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-page-id'),
    renderHTML: (a: PageLinkAttrs) => (a.targetPageId ? { 'data-page-id': a.targetPageId } : {}),
  },
  label: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
    renderHTML: (a: PageLinkAttrs) => (a.label ? { 'data-label': a.label } : {}),
  },
};

/** Inline `[[wiki-link]]` to another page. */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => sharedAttrs,
  parseHTML: () => [{ tag: 'a[data-page-id]' }],
  renderHTML({ HTMLAttributes, node }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'page-link',
        href: node.attrs.targetPageId ? `/pages/${node.attrs.targetPageId}` : '#',
      }),
      node.attrs.label ?? 'Untitled',
    ];
  },
  renderText: ({ node }) => `[[${node.attrs.label ?? node.attrs.targetPageId}]]`,
});

/** Inline `@@page` mention — same render as a link, distinct kind for the index. */
export const PageMention = Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => sharedAttrs,
  parseHTML: () => [{ tag: 'a[data-page-mention]' }],
  renderHTML({ HTMLAttributes, node }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'page-mention',
        'data-page-mention': '',
        href: node.attrs.targetPageId ? `/pages/${node.attrs.targetPageId}` : '#',
      }),
      `\u{1F4C4} ${node.attrs.label ?? 'Untitled'}`,
    ];
  },
  renderText: ({ node }) =>
    `@[${node.attrs.label ?? node.attrs.targetPageId}](${node.attrs.targetPageId})`,
});

/** Block `pageEmbed` — a snapshot preview card (title + link through). */
export const PageEmbed = Node.create({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => sharedAttrs,
  parseHTML: () => [{ tag: 'div[data-page-embed]' }],
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'page-embed', 'data-page-embed': '' }),
      [
        'a',
        {
          class: 'page-embed-title',
          href: node.attrs.targetPageId ? `/pages/${node.attrs.targetPageId}` : '#',
        },
        node.attrs.label ?? 'Untitled',
      ],
    ];
  },
});
