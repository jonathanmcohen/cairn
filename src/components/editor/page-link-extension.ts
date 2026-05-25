import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

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
        // `data-page-link` marks the node for the hover popover plugin
        // (see PageLinkHover below). All three node variants share the same
        // attribute so the plugin handles each uniformly.
        'data-page-link': '',
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
        'data-page-link': '',
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
          // The embed's title link also gets the hover treatment.
          'data-page-link': '',
          'data-page-id': node.attrs.targetPageId ?? '',
          href: node.attrs.targetPageId ? `/pages/${node.attrs.targetPageId}` : '#',
        },
        node.attrs.label ?? 'Untitled',
      ],
    ];
  },
});

export const pageLinkHoverPluginKey = new PluginKey('pageLinkHover');

/**
 * ProseMirror plugin that listens at the document level for `mouseover` over
 * rendered `[data-page-link][data-page-id]` nodes and opens a small preview
 * popover via tippy.js (the same lib v0.6 P10's page-link suggestion already
 * pulls in — no new floating-UI dep).
 *
 * - 300 ms hover-intent open, instant close.
 * - `interactive: true` keeps the popover open when the mouse moves into it.
 * - Esc tears the popover down.
 * - Only ONE popover at a time — re-entering a different page-link destroys
 *   the previous instance.
 *
 * IMPLEMENTATION NOTE: The browser-only dependencies (`react-dom/client`,
 * `tippy.js`, the React popover component) are dynamically imported inside
 * `view()` so this module stays import-safe from server code paths
 * (`schema.ts` is reached by suggestion-transform, the imports route, and
 * the public-page renderer — all server contexts that must not pull in
 * `react-dom/client`).
 */
function pageLinkHoverPlugin(): Plugin {
  type CleanupCtx = {
    close: () => void;
    onMouseOver: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  };
  let ctx: CleanupCtx | null = null;

  return new Plugin({
    key: pageLinkHoverPluginKey,
    view() {
      // Skip on the server (TipTap's editor can be instantiated in tests/
      // server-render contexts where `document` is undefined).
      if (typeof document === 'undefined') return { destroy() {} };

      let activeTippy: { destroy(): void; show(): void } | null = null;
      let activeRoot: { unmount(): void } | null = null;
      let activeAnchor: HTMLElement | null = null;
      // Sentinel — flips to true once the dynamic-import chain resolves;
      // until then, hover events are noops (keeps first-hover latency in
      // line with the dynamic-import cost but avoids dangling state).
      let ready = false;
      let tippyFn: typeof import('tippy.js').default | null = null;
      let createRootFn: typeof import('react-dom/client').createRoot | null = null;
      let createElementFn: typeof import('react').createElement | null = null;
      let Popover: typeof import('./page-link-popover').PageLinkPopover | null = null;

      const close = (): void => {
        activeTippy?.destroy();
        activeRoot?.unmount();
        activeTippy = null;
        activeRoot = null;
        activeAnchor = null;
      };

      const openFor = (anchor: HTMLElement, pageId: string): void => {
        if (!ready || !tippyFn || !createRootFn || !createElementFn || !Popover) return;
        if (activeAnchor === anchor) return;
        close();
        const container = document.createElement('div');
        const root = createRootFn(container);
        root.render(createElementFn(Popover, { pageId }));
        activeAnchor = anchor;
        activeRoot = root;
        activeTippy = tippyFn(anchor, {
          appendTo: () => document.body,
          trigger: 'manual',
          placement: 'top',
          interactive: true,
          arrow: true,
          delay: [300, 0],
          content: container,
          onHidden: () => close(),
        });
        activeTippy.show();
      };

      const onMouseOver = (e: MouseEvent): void => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const node = target.closest<HTMLElement>('[data-page-link][data-page-id]');
        if (!node) return;
        const pageId = node.getAttribute('data-page-id');
        if (!pageId) return;
        openFor(node, pageId);
      };

      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') close();
      };

      // Lazily resolve browser-only deps; once loaded, hover handlers become
      // active. The first hover before resolution is a graceful no-op.
      void Promise.all([
        import('tippy.js'),
        import('react-dom/client'),
        import('react'),
        import('./page-link-popover'),
      ]).then(([tippyMod, rdcMod, reactMod, popoverMod]) => {
        tippyFn = tippyMod.default;
        createRootFn = rdcMod.createRoot;
        createElementFn = reactMod.createElement;
        Popover = popoverMod.PageLinkPopover;
        ready = true;
      });

      document.addEventListener('mouseover', onMouseOver);
      document.addEventListener('keydown', onKeyDown);
      ctx = { close, onMouseOver, onKeyDown };

      return {
        destroy() {
          if (!ctx) return;
          document.removeEventListener('mouseover', ctx.onMouseOver);
          document.removeEventListener('keydown', ctx.onKeyDown);
          ctx.close();
          ctx = null;
        },
      };
    },
  });
}

/**
 * Editor extension that registers the page-link hover popover plugin.
 * Add it to the editor's extension list alongside `PageLink` / `PageMention`
 * / `PageEmbed` to enable the v0.8 P18 inline transclusion preview.
 */
export const PageLinkHover = Extension.create({
  name: 'pageLinkHover',
  addProseMirrorPlugins() {
    return [pageLinkHoverPlugin()];
  },
});
